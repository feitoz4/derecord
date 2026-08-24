const { contextBridge, ipcRenderer } = require('electron')

// As únicas pontes expostas, e só para as janelas internas do app.
// A página do derecord em si não usa nenhuma delas.
contextBridge.exposeInMainWorld('picker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: (id) => ipcRenderer.send('picker:choose', id),
})

contextBridge.exposeInMainWorld('settings', {
  current: () => ipcRenderer.invoke('settings:current'),
  save: (url) => ipcRenderer.send('settings:save', url),
})
