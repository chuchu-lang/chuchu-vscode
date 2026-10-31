const path = require('node:path');
const fs = require('node:fs');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');
async function main() {
  let executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || '1.96.0');
  // Recent macOS releases renamed the Electron executable to Code.
  const renamed = path.join(path.dirname(executable), 'Code');
  if (!fs.existsSync(executable) && process.platform === 'darwin' && fs.existsSync(renamed)) { executable = renamed; }
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsEnv: { CHUCHU_COMPILER: process.env.CHUCHU_COMPILER || '' },
    extensionTestsPath: path.resolve(__dirname, 'integration.cjs'),
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust']
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
