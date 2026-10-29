const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atlas', {
  getCities: () => ipcRenderer.invoke('atlas:cities'),
  getMap: (id, variant) => ipcRenderer.invoke('atlas:map', id, variant),
  saveImage: (payload) => ipcRenderer.invoke('atlas:save-image', payload)
});
