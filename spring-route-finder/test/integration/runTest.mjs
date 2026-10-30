import { runTests } from '@vscode/test-electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const userDataDir = process.env.SRF_E2E_USER_DIR ?? '/tmp/spring-route-finder-e2e-user';

try {
  await runTests({
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: path.join(projectRoot, 'test', 'integration', 'suite', 'index.js'),
    launchArgs: [
      path.join(projectRoot, 'test', 'fixtures', 'demo-workspace'),
      '--disable-telemetry',
      '--skip-welcome',
      // macOS limits unix socket paths to 103 characters, so keep user-data short.
      `--user-data-dir=${userDataDir}`,
      '--extensions-dir=/tmp/spring-route-finder-e2e-ext',
    ],
  });
} catch (error) {
  console.error('end-to-end test failed:', error);
  process.exit(1);
}
