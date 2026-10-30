import * as vscode from 'vscode';
import {
  collectConstantTable,
  FileScan,
  makeResolver,
  resolveRoutes,
  scanJavaFile,
} from './routeParser';

export interface RouteEntry {
  httpMethod: string;
  fullPath: string;
  handler: string;
  line: number;
  controller: string;
  uri: vscode.Uri;
  relativePath: string;
}

export interface IndexStats {
  indexedFiles: number;
  skippedLargeFiles: number;
  truncated: boolean;
}

interface ScannedFile {
  uri: vscode.Uri;
  scan: FileScan;
}

const DEFAULT_SOURCE_ROOTS = ['**/src/main/java'];
const DEFAULT_EXCLUDES = [
  '**/target/**',
  '**/build/**',
  '**/out/**',
  '**/node_modules/**',
  '**/generated/**',
];
const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_FILE_SIZE_KB = 1024;
const DEFAULT_MAX_TOTAL_SIZE_MB = 256;
const READ_BATCH_SIZE = 40;

/**
 * Workspace route index: scans Java sources and joins the class level prefix
 * with each method level mapping to build full paths. Built on demand and
 * invalidated when Java files are saved.
 */
export class RouteIndex {
  private entries: RouteEntry[] = [];
  private stats: IndexStats = { indexedFiles: 0, skippedLargeFiles: 0, truncated: false };
  private ready = false;
  private dirty = false;
  private building: Promise<RouteEntry[]> | undefined;

  get count(): number {
    return this.entries.length;
  }

  getRoutes(): RouteEntry[] {
    return this.entries;
  }

  getLastStats(): IndexStats {
    return this.stats;
  }

  markDirty(): void {
    this.dirty = true;
  }

  async ensureReady(): Promise<void> {
    if (this.ready && !this.dirty) {
      return;
    }
    await this.rebuild();
  }

  async rebuild(): Promise<RouteEntry[]> {
    if (this.building) {
      return this.building;
    }
    this.building = this.runRebuild().finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private async runRebuild(): Promise<RouteEntry[]> {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Spring Route Finder: building route index',
        cancellable: true,
      },
      async (progress, token) => {
        const config = vscode.workspace.getConfiguration('springRouteFinder');
        const sourceRoots = config.get<string[]>('sourceRoots', DEFAULT_SOURCE_ROOTS);
        const excludes = config.get<string[]>('exclude', DEFAULT_EXCLUDES);
        const maxFiles = config.get<number>('maxFiles', DEFAULT_MAX_FILES);
        const maxFileSizeKb = config.get<number>('maxFileSizeKb', DEFAULT_MAX_FILE_SIZE_KB);
        const maxTotalSizeMb = config.get<number>('maxTotalSizeMb', DEFAULT_MAX_TOTAL_SIZE_MB);

        const uris = await collectJavaFiles(sourceRoots, excludes, maxFiles, progress);
        const scanned = await scanFiles(uris, token, progress, {
          // A value of 0 means "no limit".
          maxFileBytes: maxFileSizeKb > 0 ? maxFileSizeKb * 1024 : Number.POSITIVE_INFINITY,
          maxTotalBytes:
            maxTotalSizeMb > 0 ? maxTotalSizeMb * 1024 * 1024 : Number.POSITIVE_INFINITY,
        });
        return { entries: buildEntries(scanned.files), stats: scanned.stats };
      }
    );
    this.entries = result.entries;
    this.stats = result.stats;
    this.ready = true;
    this.dirty = false;
    return this.entries;
  }
}

async function collectJavaFiles(
  sourceRoots: string[],
  excludes: string[],
  maxFiles: number,
  progress: vscode.Progress<{ message?: string }>
): Promise<vscode.Uri[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const excludeGlob = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];

  for (const folder of folders) {
    for (const root of sourceRoots) {
      const include = new vscode.RelativePattern(folder, `${trimSlashes(root)}/**/*.java`);
      progress.report({ message: `Searching ${folder.name}/${root}` });
      const found = await vscode.workspace.findFiles(include, excludeGlob, maxFiles);
      for (const uri of found) {
        if (!seen.has(uri.toString())) {
          seen.add(uri.toString());
          uris.push(uri);
        }
      }
    }
  }
  return uris;
}

async function scanFiles(
  uris: vscode.Uri[],
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string }>,
  limits: { maxFileBytes: number; maxTotalBytes: number }
): Promise<{ files: ScannedFile[]; stats: IndexStats }> {
  const files: ScannedFile[] = [];
  const stats: IndexStats = { indexedFiles: 0, skippedLargeFiles: 0, truncated: false };
  const decoder = new TextDecoder('utf-8');
  let totalBytes = 0;
  for (let start = 0; start < uris.length; start += READ_BATCH_SIZE) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    if (stats.truncated) {
      break;
    }
    const batch = uris.slice(start, start + READ_BATCH_SIZE);
    const parsed = await Promise.all(
      batch.map(async (uri) => {
        // Check the size before reading so huge files never enter memory.
        const size = (await vscode.workspace.fs.stat(uri)).size;
        if (size > limits.maxFileBytes) {
          stats.skippedLargeFiles++;
          return undefined;
        }
        if (totalBytes + size > limits.maxTotalBytes) {
          stats.truncated = true;
          return undefined;
        }
        totalBytes += size;
        const bytes = await vscode.workspace.fs.readFile(uri);
        return { uri, scan: scanJavaFile(decoder.decode(bytes)) };
      })
    );
    for (const item of parsed) {
      if (item) {
        files.push(item);
        stats.indexedFiles++;
      }
    }
    progress.report({ message: `${Math.min(start + batch.length, uris.length)}/${uris.length} files` });
  }
  return { files, stats };
}

function buildEntries(scannedFiles: ScannedFile[]): RouteEntry[] {
  const constants = collectConstantTable(scannedFiles.map((item) => item.scan));
  const entries: RouteEntry[] = [];
  for (const { uri, scan } of scannedFiles) {
    const resolve = makeResolver(constants, scan.constants);
    for (const route of resolveRoutes(scan, resolve)) {
      entries.push({
        httpMethod: route.httpMethod,
        fullPath: route.fullPath,
        handler: route.handler,
        line: route.line,
        controller: scan.className,
        uri,
        relativePath: vscode.workspace.asRelativePath(uri, false),
      });
    }
  }
  entries.sort((left, right) => left.fullPath.localeCompare(right.fullPath));
  return entries;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
