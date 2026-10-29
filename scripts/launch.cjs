const { spawn } = require('node:child_process');
const path = require('node:path');
// Editors may set this for their own helpers; a desktop launch must use Electron's browser process.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
