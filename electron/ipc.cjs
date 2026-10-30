const { AtlasError } = require('./errors.cjs');

function registerAtlasIpc({ ipcMain, getWindow, pageURL, repository, savePng }) {
  const handlers = {
    'atlas:regions': () => repository.listRegions(),
    'atlas:map': (request) => repository.getMap(request),
    'atlas:save-image': (payload) => savePng(payload),
  };
  for (const [channel, handle] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        if (event.sender !== getWindow()?.webContents || event.senderFrame?.url !== pageURL) {
          throw new AtlasError('UNTRUSTED_CALLER', '无效的页面请求');
        }
        return { ok: true, value: await handle(payload) };
      } catch (error) {
        if (!(error instanceof AtlasError)) console.error(channel, error);
        return {
          ok: false,
          error: {
            code: error instanceof AtlasError ? error.code : 'INTERNAL_ERROR',
            message: error instanceof AtlasError ? error.message : '操作失败，请重试',
          },
        };
      }
    });
  }
}

module.exports = { registerAtlasIpc };
