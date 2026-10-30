const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createMapRepository } = require('./map-repository.cjs');
const { createImageExporter } = require('./image-export.cjs');
const { registerAtlasIpc } = require('./ipc.cjs');

const smoke = process.argv.includes('--smoke-test');
const pageURL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const output = path.join(
  app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
  'artifacts',
);
let mainWindow;
let testProfile;

// Configure Chromium before yielding to the event loop (app readiness can happen during awaits).
if (smoke) {
  testProfile =
    process.env.ATLAS_TEST_PROFILE ||
    fsSync.mkdtempSync(path.join(os.tmpdir(), 'city-atlas-smoke-'));
  app.setPath('userData', testProfile);
  app.setPath('sessionData', testProfile);
} else {
  // Keep the existing profile when the display name changes.
  app.setPath('userData', path.join(app.getPath('appData'), '城市图志'));
}

async function finishSmoke(code) {
  mainWindow?.destroy();
  app.exit(code);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: '江城子',
    backgroundColor: '#f3f3f3',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.once('ready-to-show', () => {
    if (!smoke) window.show();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('Page load failed', code, description);
    if (smoke) void finishSmoke(1);
    else dialog.showErrorBox('界面加载失败', description);
  });
  if (smoke) {
    const checks = require('./smoke.cjs');
    const observation = checks.observe(window);
    window.webContents.once('did-finish-load', async () => {
      try {
        await checks.run(window, output, observation);
        await finishSmoke(0);
      } catch (error) {
        console.error(error);
        await finishSmoke(1);
      }
    });
  }
  void window.loadURL(pageURL).catch(console.error);
}

async function start() {
  if (smoke) {
    setTimeout(() => {
      console.error('Smoke test timed out');
      void finishSmoke(1);
    }, 60000).unref();
  } else if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  const repository = await createMapRepository(path.join(__dirname, '../resources'));
  const savePng = createImageExporter({
    nativeImage,
    choosePath: async (filename) => {
      if (smoke) {
        await fs.mkdir(output, { recursive: true });
        return path.join(output, filename);
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出地图',
        defaultPath: path.join(app.getPath('pictures'), filename),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      return result.canceled ? null : result.filePath;
    },
  });
  registerAtlasIpc({ ipcMain, getWindow: () => mainWindow, pageURL, repository, savePng });
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
}

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
});
app.on('window-all-closed', () => {
  if (!smoke && process.platform !== 'darwin') app.quit();
});
start().catch(async (error) => {
  console.error(error);
  if (smoke) await finishSmoke(1);
  else {
    dialog.showErrorBox('江城子启动失败', error.message);
    app.exit(1);
  }
});
