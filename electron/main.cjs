const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const resources = path.join(__dirname, '../resources');
const pageURL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const smoke = process.argv.includes('--smoke-test');
let mainWindow;
let cities;
let byId;

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame?.url !== pageURL) {
    throw new Error('无效的页面请求');
  }
}
function registerHandlers() {
  ipcMain.handle('atlas:cities', event => { trusted(event); return cities; });
  ipcMain.handle('atlas:map', async (event, id, variant) => {
    trusted(event);
    const city = typeof id === 'string' && byId.get(id);
    if (!city || !['districts', 'outline'].includes(variant)) throw new Error('未找到对应地图');
    return JSON.parse(await fs.readFile(path.join(resources, 'maps', city.variants[variant]), 'utf8'));
  });
  ipcMain.handle('atlas:save-image', async (event, payload) => {
    trusted(event);
    if (!payload || typeof payload.dataURL !== 'string' || payload.dataURL.length > 100 * 1024 * 1024 ||
        !payload.dataURL.startsWith('data:image/png;base64,') || !/^[A-Za-z0-9+/=]+$/.test(payload.dataURL.slice(22))) throw new Error('无效的 PNG 图片');
    const image = nativeImage.createFromDataURL(payload.dataURL);
    if (image.isEmpty()) throw new Error('图片内容为空');
    const filename = String(payload.filename || '城市地图').replace(/[<>:"/\|?*\x00-\x1f]/g, '_').slice(0, 90) + '.png';
    let filePath;
    if (smoke) {
      filePath = path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'), 'artifacts', filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } else {
      const result = await dialog.showSaveDialog(mainWindow, { title: '导出地图', defaultPath: path.join(app.getPath('pictures'), filename), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = result.filePath;
      if (!filePath.toLowerCase().endsWith('.png')) filePath += '.png';
    }
    await fs.writeFile(filePath, image.toPNG());
    return { canceled: false, filePath, size: image.getSize() };
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1080, minHeight: 720,
    title: '城市图志', backgroundColor: '#f4f3ee', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, ...(smoke ? { partition: 'atlas-smoke' } : {}) }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => { if (!smoke) mainWindow.show(); });
  mainWindow.loadURL(pageURL);
  if (smoke) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await require('./smoke.cjs').run(mainWindow, app);
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}
app.whenReady().then(async () => {
  cities = JSON.parse(await fs.readFile(path.join(resources, 'catalog.json'), 'utf8'));
  byId = new Map(cities.map(city => [city.id, city]));
  Menu.setApplicationMenu(null);
  registerHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { console.error(error); if (!smoke) dialog.showErrorBox('城市图志启动失败', error.message); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
