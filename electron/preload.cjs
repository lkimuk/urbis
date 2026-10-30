const { contextBridge, ipcRenderer } = require('electron');
// Transfer plain data: contextBridge does not preserve custom properties on Error objects.
contextBridge.exposeInMainWorld('atlas', {
  getCities: () => ipcRenderer.invoke('atlas:cities'),
  getMap: (request) => ipcRenderer.invoke('atlas:map', request),
  saveImage: (payload) => ipcRenderer.invoke('atlas:save-image', payload),
});
