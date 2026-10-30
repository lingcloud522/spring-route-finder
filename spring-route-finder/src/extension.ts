import * as vscode from 'vscode';
import { IndexStats, RouteEntry, RouteIndex } from './indexer';

const FIND_ROUTE = 'springRouteFinder.findRoute';
const FIND_ROUTE_FROM_SELECTION = 'springRouteFinder.findRouteFromSelection';
const REBUILD_INDEX = 'springRouteFinder.rebuildIndex';

interface RouteQuickPickItem extends vscode.QuickPickItem {
  entry: RouteEntry;
}

/** API surface exposed for tests and automation. */
export interface SpringRouteFinderApi {
  rebuildIndex(): Promise<RouteEntry[]>;
  getRoutes(): RouteEntry[];
  getLastStats(): IndexStats;
}

export function activate(context: vscode.ExtensionContext): SpringRouteFinderApi {
  const index = new RouteIndex();
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = FIND_ROUTE;
  statusBar.text = '$(list-unordered) Routes';
  statusBar.tooltip = 'Spring Route Finder: find the handler for an API path (Cmd/Ctrl+Alt+J)';
  statusBar.show();

  const refreshStatusBar = () => {
    const count = index.count;
    statusBar.text = count > 0 ? `$(list-unordered) ${count} routes` : '$(list-unordered) Routes';
  };

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand(FIND_ROUTE, () => findRoute(index, refreshStatusBar)),
    vscode.commands.registerCommand(FIND_ROUTE_FROM_SELECTION, () =>
      findRouteFromSelection(index, refreshStatusBar)
    ),
    vscode.commands.registerCommand(REBUILD_INDEX, async () => {
      await index.rebuild();
      refreshStatusBar();
      vscode.window.setStatusBarMessage(
        `Spring Route Finder: indexed ${index.count} routes${describeStats(index.getLastStats())}`,
        4000
      );
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      // Java sources changed, so drop the cached index; it rebuilds on next use.
      if (document.languageId === 'java') {
        index.markDirty();
      }
    }),
    vscode.workspace.onDidCreateFiles(() => index.markDirty()),
    vscode.workspace.onDidDeleteFiles(() => index.markDirty()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('springRouteFinder')) {
        index.markDirty();
      }
    })
  );

  return {
    rebuildIndex: () => index.rebuild(),
    getRoutes: () => index.getRoutes(),
    getLastStats: () => index.getLastStats(),
  };
}

export function deactivate(): void {
  // Nothing to clean up: every subscription is owned by context.subscriptions.
}

async function findRoute(index: RouteIndex, onIndexed: () => void) {
  await openRoutePicker(index, undefined, onIndexed);
}

async function findRouteFromSelection(index: RouteIndex, onIndexed: () => void) {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.document.getText(editor.selection).trim();
  if (selection) {
    // A selection may be a full URL or a path with parameters, so use it as-is.
    await openRoutePicker(index, selection, onIndexed);
    return;
  }
  const input = await vscode.window.showInputBox({
    prompt: 'Enter an API path fragment, e.g. api/v1/auth/login',
    placeHolder: 'api/v1/auth/login',
  });
  if (input) {
    await openRoutePicker(index, input, onIndexed);
  }
}

async function openRoutePicker(
  index: RouteIndex,
  initialQuery: string | undefined,
  onIndexed: () => void
) {
  let routes: RouteEntry[];
  try {
    await index.ensureReady();
    routes = index.getRoutes();
  } catch (error) {
    if (error instanceof vscode.CancellationError) {
      return;
    }
    vscode.window.showErrorMessage(`Spring Route Finder: indexing failed ${String(error)}`);
    return;
  }
  onIndexed();

  const stats = index.getLastStats();
  if (stats.truncated || stats.skippedLargeFiles > 0) {
    vscode.window.showWarningMessage(
      `Spring Route Finder: index is incomplete${describeStats(stats)}. Adjust springRouteFinder.maxFileSizeKb or maxTotalSizeMb and rebuild the index.`
    );
  }

  if (routes.length === 0) {
    vscode.window.showWarningMessage(
      'Spring Route Finder: no request mappings found. Check that springRouteFinder.sourceRoots covers your source folders.'
    );
    return;
  }

  const picked = await showRoutePicker(routes, bestInitialQuery(routes, initialQuery));
  if (picked) {
    await revealRoute(picked.entry);
  }
}

function describeStats(stats: IndexStats): string {
  const parts = [`${stats.indexedFiles} files`];
  if (stats.skippedLargeFiles > 0) {
    parts.push(`skipped ${stats.skippedLargeFiles} large files`);
  }
  if (stats.truncated) {
    parts.push('scan size limit reached');
  }
  return ` (${parts.join(', ')})`;
}

/**
 * showQuickPick cannot pre-fill the input box, so build the picker by hand and
 * seed it with the current selection: pressing Enter then jumps straight away.
 */
function showRoutePicker(
  routes: RouteEntry[],
  initialValue: string | undefined
): Promise<RouteQuickPickItem | undefined> {
  const items = toQuickPickItems(routes);
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<RouteQuickPickItem>();
    quickPick.items = items;
    quickPick.placeholder = 'Type an API path fragment, e.g. api/v1/auth/login (Enter to jump, Esc to cancel)';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    if (initialValue) {
      quickPick.value = initialValue;
    }

    let accepted: RouteQuickPickItem | undefined;
    quickPick.onDidAccept(() => {
      accepted =
        quickPick.selectedItems[0] ?? quickPick.activeItems[0] ?? firstMatching(items, quickPick.value);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(accepted);
    });
    quickPick.show();
  });
}

function firstMatching(
  items: RouteQuickPickItem[],
  value: string
): RouteQuickPickItem | undefined {
  const query = value.trim().toLowerCase();
  if (!query) {
    return undefined;
  }
  return items.find((item) => item.entry.fullPath.toLowerCase().includes(query));
}

function toQuickPickItems(routes: RouteEntry[]): RouteQuickPickItem[] {
  return routes.map((entry) => ({
    label: `$(symbol-method) ${entry.fullPath}`,
    description: `${entry.httpMethod} · ${entry.handler}`,
    detail: `${entry.relativePath}:${entry.line}`,
    entry,
  }));
}

async function revealRoute(entry: RouteEntry): Promise<void> {
  const document = await vscode.workspace.openTextDocument(entry.uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(0, entry.line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/**
 * Selections are often full URLs or paths with parameters. Normalize them and
 * trim trailing segments until a prefix still matches a route, then use that as
 * the initial query so the picker is not empty.
 */
function bestInitialQuery(routes: RouteEntry[], raw: string | undefined): string | undefined {
  const normalized = normalizeQuery(raw);
  if (!normalized) {
    return undefined;
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  for (let length = segments.length; length >= 1; length--) {
    const candidate = segments.slice(0, length).join('/');
    const matched = routes.some((route) =>
      route.fullPath.toLowerCase().includes(candidate.toLowerCase())
    );
    if (matched) {
      return candidate;
    }
  }
  return normalized;
}

function normalizeQuery(raw: string | undefined): string {
  if (!raw) {
    return '';
  }
  let text = raw.trim().replace(/^["'`]|["'`]$/g, '');
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const cutAt = ['?', '#'].reduce((shortest, marker) => {
    const position = text.indexOf(marker);
    return position >= 0 && position < shortest ? position : shortest;
  }, text.length);
  text = text.slice(0, cutAt).replace(/\s+/g, '');
  return text.replace(/^\/+|\/+$/g, '');
}
