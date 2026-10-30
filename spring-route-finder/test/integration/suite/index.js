const assert = require('node:assert/strict');

/**
 * Runs inside a real VS Code extension host: activates the extension, indexes the
 * workspace Java files, and checks that prefixes, paths and positions are correct.
 */
async function run() {
  const vscode = require('vscode');
  const path = require('node:path');
  // The extension ID is publisher + name; read it from the manifest so a publisher
  // change does not silently break the test.
  const manifest = require(path.join(__dirname, '..', '..', '..', 'package.json'));
  const extensionId = `${manifest.publisher}.${manifest.name}`;
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `extension not found: ${extensionId}`);

  const api = await extension.activate();
  console.log(`workspace trust: isTrusted=${vscode.workspace.isTrusted}`);
  const routes = await api.rebuildIndex();
  const paths = routes.map((route) => route.fullPath);

  const loginRoute = routes.find((route) => route.fullPath === '/api/v1/auth/login');
  assert.ok(loginRoute, `/api/v1/auth/login was not indexed; got: ${paths.join(', ')}`);
  assert.equal(loginRoute.httpMethod, 'POST');
  assert.equal(loginRoute.handler, 'login');
  assert.ok(
    loginRoute.uri.fsPath.endsWith('src/main/java/com/demo/AuthController.java'),
    `wrong file resolved: ${loginRoute.uri.fsPath}`
  );

  const document = await vscode.workspace.openTextDocument(loginRoute.uri);
  const lineText = document.lineAt(loginRoute.line - 1).text;
  assert.ok(
    lineText.includes('public LoginResponse login'),
    `wrong line number (line ${loginRoute.line}): ${lineText}`
  );

  assert.ok(
    paths.includes('/api/v1/auth/logout'),
    `cross-file constant was not resolved; got: ${paths.join(', ')}`
  );
  assert.ok(
    paths.includes('/api/v1/users/{id}'),
    `multi-module folder was not indexed; got: ${paths.join(', ')}`
  );
  assert.ok(
    !paths.some((path) => path.startsWith('/ghost')),
    'the target directory should be excluded but was indexed'
  );

  const stats = api.getLastStats();
  assert.ok(stats.indexedFiles >= 3, `unexpected indexed file count: ${stats.indexedFiles}`);
  assert.equal(stats.skippedLargeFiles, 0);

  await assertLargeFileSkipped(vscode, api);

  console.log(`end-to-end checks passed, indexed ${routes.length} routes: ${paths.sort().join(' | ')}`);
}

/** Files above maxFileSizeKb must be skipped before reading, to bound memory use. */
async function assertLargeFileSkipped(vscode, api) {
  const fs = require('node:fs');
  const path = require('node:path');
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const bigFile = path.join(
    workspaceRoot,
    'src',
    'main',
    'java',
    'com',
    'demo',
    'GeneratedBigController.java'
  );
  const padding = '    // generated filler line\n'.repeat(60000);
  const source = `package com.demo;

@RestController
@RequestMapping("/generated")
public class GeneratedBigController {
${padding}
    @PostMapping("/big")
    public void big() {
    }
}
`;

  fs.writeFileSync(bigFile, source);
  try {
    const routes = await api.rebuildIndex();
    const stats = api.getLastStats();
    assert.ok(
      !routes.some((route) => route.fullPath === '/generated/big'),
      `a ${(source.length / 1024 / 1024).toFixed(1)}MB file should be skipped but was indexed`
    );
    assert.equal(stats.skippedLargeFiles, 1, 'wrong count of skipped large files');
  } finally {
    fs.rmSync(bigFile, { force: true });
  }
}

module.exports = { run };
