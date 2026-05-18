const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invokeOllama: (hostUrl, endpoint, data) => ipcRenderer.invoke('ollama-request', hostUrl, endpoint, data),
  invokeOllamaStream: (hostUrl, endpoint, data, onData, onEnd, onError) => {
    const streamId = Math.random().toString(36).substring(7);
    ipcRenderer.on(`ollama-data-${streamId}`, (_e, chunk) => onData(chunk));
    ipcRenderer.on(`ollama-end-${streamId}`, () => {
      onEnd();
      ipcRenderer.removeAllListeners(`ollama-data-${streamId}`);
      ipcRenderer.removeAllListeners(`ollama-end-${streamId}`);
      ipcRenderer.removeAllListeners(`ollama-error-${streamId}`);
    });
    ipcRenderer.on(`ollama-error-${streamId}`, (_e, err) => {
      onError(err);
      ipcRenderer.removeAllListeners(`ollama-data-${streamId}`);
      ipcRenderer.removeAllListeners(`ollama-end-${streamId}`);
      ipcRenderer.removeAllListeners(`ollama-error-${streamId}`);
    });
    ipcRenderer.send('ollama-stream', streamId, hostUrl, endpoint, data);
    return streamId;
  },
  stopOllamaStream: (streamId) => ipcRenderer.send('abort-stream', streamId),
  unloadModels: (hostUrl) => ipcRenderer.invoke('unload-models', hostUrl),
  spawnTerminal: (type) => ipcRenderer.invoke('spawn-terminal', type),
  runShellCommand: (command) => ipcRenderer.invoke('run-shell-command', command),
  terminalInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  onTerminalOutput: (callback) => {
    const listener = (_event, id, data) => callback(id, data);
    ipcRenderer.on('terminal-output', listener);
    return () => ipcRenderer.removeListener('terminal-output', listener);
  },
  runPlaywright: (url, action) => ipcRenderer.invoke('run-playwright', url, action),
  browserAction: (options) => ipcRenderer.invoke('browser-action', options),
  readWiki: (path) => ipcRenderer.invoke('read-wiki', path),
  webSearch: (query) => ipcRenderer.invoke('web-search', query),
  writeWiki: (path, content) => ipcRenderer.invoke('write-wiki', path, content),
  listWiki: () => ipcRenderer.invoke('list-wiki'),
  saveChat: (id, messages) => ipcRenderer.invoke('save-chat', id, messages),
  loadChat: (id) => ipcRenderer.invoke('load-chat', id),
  listChats: () => ipcRenderer.invoke('list-chats'),
  deleteChat: (id) => ipcRenderer.invoke('delete-chat', id),
  renameChat: (id, title) => ipcRenderer.invoke('rename-chat', id, title),
  parseFile: (filePath) => ipcRenderer.invoke('parse-file', filePath),
  parseFileBuffer: (ext, byteArray) => ipcRenderer.invoke('parse-file-buffer', ext, byteArray),
  getClock: (opts) => ipcRenderer.invoke('get-clock', opts ?? {}),
  engineeringCalculator: (payload) => ipcRenderer.invoke('engineering-calculator', payload ?? {}),
  onPolicyDecisionRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('policy-decision-request', listener);
    return () => ipcRenderer.removeListener('policy-decision-request', listener);
  },
  respondPolicyDecision: (requestId, selectionId) => ipcRenderer.invoke('policy-decision-response', requestId, selectionId),
});
