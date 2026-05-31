const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invokeOllama: (hostUrl, endpoint, data) => ipcRenderer.invoke('ollama-request', hostUrl, endpoint, data),
  invokeOllamaStream: (hostUrl, endpoint, data, onData, onEnd, onError) => {
    const streamId = Math.random().toString(36).substring(7);
    const dataChannel = `ollama-data-${streamId}`;
    const endChannel = `ollama-end-${streamId}`;
    const errChannel = `ollama-error-${streamId}`;

    const dataHandler = (_e, chunk) => { try { onData(chunk); } catch { /* ignore */ } };
    const cleanup = () => {
      ipcRenderer.removeListener(dataChannel, dataHandler);
      ipcRenderer.removeListener(endChannel, endHandler);
      ipcRenderer.removeListener(errChannel, errHandler);
    };
    const endHandler = () => { cleanup(); try { onEnd(); } catch { /* ignore */ } };
    const errHandler = (_e, err) => { cleanup(); try { onError(err); } catch { /* ignore */ } };

    ipcRenderer.on(dataChannel, dataHandler);
    ipcRenderer.once(endChannel, endHandler);
    ipcRenderer.once(errChannel, errHandler);
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
