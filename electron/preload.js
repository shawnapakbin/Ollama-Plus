import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  invokeOllama: (hostUrl, endpoint, data) => ipcRenderer.invoke('ollama-request', hostUrl, endpoint, data),
  spawnTerminal: (type) => ipcRenderer.invoke('spawn-terminal', type),
  terminalInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  onTerminalOutput: (callback) => ipcRenderer.on('terminal-output', (_event, id, data) => callback(id, data)),
  runPlaywright: (url, action) => ipcRenderer.invoke('run-playwright', url, action),
  readWiki: (path) => ipcRenderer.invoke('read-wiki', path),
  writeWiki: (path, content) => ipcRenderer.invoke('write-wiki', path, content),
  listWiki: () => ipcRenderer.invoke('list-wiki'),
  parseFile: (filePath) => ipcRenderer.invoke('parse-file', filePath),
});
