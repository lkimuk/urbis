const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
// Editors may set this for their own helpers; a desktop launch must use Electron's browser process.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const smoke = process.argv.includes('--smoke-test');
const profile = smoke ? fs.mkdtempSync(path.join(os.tmpdir(), 'city-atlas-smoke-')) : null;
if (profile) env.ATLAS_TEST_PROFILE = profile;
const child = spawn(
  require('electron'),
  [path.resolve(__dirname, '..'), ...process.argv.slice(2)],
  { stdio: 'inherit', env, windowsHide: true },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (profile) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error('Unable to remove test profile:', error.message);
    }
  }
  process.exitCode = code ?? 1;
});
