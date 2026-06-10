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
  scanLanOllama: () => ipcRenderer.invoke('scan-lan-ollama'),
  spawnTerminal: (type) => ipcRenderer.invoke('spawn-terminal', type),
  runShellCommand: (command) => ipcRenderer.invoke('run-shell-command', command),
  mcpGatewayCall: (request) => ipcRenderer.invoke('mcp-gateway-call', request ?? {}),
  mcpGatewayStatus: () => ipcRenderer.invoke('mcp-gateway-status'),
  terminalInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  onTerminalOutput: (callback) => {
    const listener = (_event, id, data) => callback(id, data);
    ipcRenderer.on('terminal-output', listener);
    return () => ipcRenderer.removeListener('terminal-output', listener);
  },
  createMcpTerminalSession: async (options) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'terminal',
      action: 'create',
      payload: options ?? {}
    });
    if (!res?.ok) throw new Error(res?.error || 'Terminal create failed.');
    return res.data;
  },
  listMcpTerminalSessions: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'terminal', action: 'list', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Terminal list failed.');
    return res.data;
  },
  readMcpTerminalOutput: async (sessionId, maxChars, clear) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'terminal',
      action: 'read',
      payload: { sessionId, maxChars, clear }
    });
    if (!res?.ok) throw new Error(res?.error || 'Terminal read failed.');
    return res.data;
  },
  writeMcpTerminalInput: async (sessionId, input) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'terminal',
      action: 'write',
      payload: { sessionId, input }
    });
    if (!res?.ok) throw new Error(res?.error || 'Terminal write failed.');
    return res.data;
  },
  executeMcpTerminalCommand: async (sessionId, command, options) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'terminal',
      action: 'execute',
      payload: { sessionId, command, options: options ?? {} }
    });
    if (!res?.ok) throw new Error(res?.error || 'Terminal execute failed.');
    return res.data;
  },
  closeMcpTerminalSession: async (sessionId) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'terminal',
      action: 'close',
      payload: { sessionId }
    });
    if (!res?.ok) throw new Error(res?.error || 'Terminal close failed.');
    return res.data;
  },
  checkMcpPythonSandbox: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'python', action: 'health', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Python health check failed.');
    return res.data;
  },
  runMcpPythonSandbox: async (payload) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'python', action: 'run', payload: payload ?? {} });
    if (!res?.ok) throw new Error(res?.error || 'Python run failed.');
    return res.data;
  },
  listMcpPythonSandboxRuns: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'python', action: 'list_runs', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Python list runs failed.');
    return res.data;
  },
  readMcpPythonSandboxArtifact: async (runId) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'python',
      action: 'read_artifact',
      payload: { runId }
    });
    if (!res?.ok) throw new Error(res?.error || 'Python artifact read failed.');
    return res.data;
  },
  getMcpFolderRoot: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'folder', action: 'root', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Folder root lookup failed.');
    return res.data;
  },
  selectMcpFolderRoot: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'folder', action: 'select_root', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Folder root selection failed.');
    return res.data;
  },
  clearMcpFolderRoot: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'folder', action: 'clear_root', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Folder root clear failed.');
    return res.data;
  },
  listMcpFolder: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'list',
      payload: { relativePath: relativePath ?? '.' }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder list failed.');
    return res.data;
  },
  readMcpFolderText: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'read',
      payload: { relativePath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder read failed.');
    return res.data;
  },
  writeMcpFolderText: async (relativePath, content) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'write',
      payload: { relativePath, content }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder write failed.');
    return res.data;
  },
  deleteMcpFolderPath: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'delete',
      payload: { relativePath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder delete failed.');
    return res.data;
  },
  renameMcpFolderPath: async (fromPath, toPath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'rename',
      payload: { fromPath, toPath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder rename failed.');
    return res.data;
  },
  createMcpFolderDir: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'mkdir',
      payload: { relativePath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder mkdir failed.');
    return res.data;
  },
  listMcpFolderModels: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'list_models',
      payload: { relativePath: relativePath ?? '.' }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder list models failed.');
    return res.data;
  },
  readMcpFolderModel: async (relativePath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'folder',
      action: 'read_model',
      payload: { relativePath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Folder read model failed.');
    return res.data;
  },
  getMcpWikiConfig: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'wiki', action: 'root', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Wiki root lookup failed.');
    return res.data;
  },
  setMcpWikiRoot: async (pathValue) => {
    const payload = typeof pathValue === 'string' && pathValue.trim() ? { path: pathValue } : {};
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'wiki', action: 'set_root', payload });
    if (!res?.ok) throw new Error(res?.error || 'Wiki root selection failed.');
    return res.data;
  },
  clearMcpWikiRoot: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'wiki', action: 'clear_root', payload: {} });
    if (!res?.ok) throw new Error(res?.error || 'Wiki root clear failed.');
    return res.data;
  },
  setMcpWikiAutonomyMode: async (mode) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'wiki', action: 'set_autonomy', payload: { mode } });
    if (!res?.ok) throw new Error(res?.error || 'Wiki autonomy update failed.');
    return res.data;
  },
  setMcpWikiKnowledgePolicy: async (level) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', { server: 'wiki', action: 'set_policy', payload: { level } });
    if (!res?.ok) throw new Error(res?.error || 'Wiki policy update failed.');
    return res.data;
  },
  listMcpWiki: async (pathValue) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'list',
      payload: { path: pathValue ?? '.' }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki list failed.');
    return res.data;
  },
  readMcpWiki: async (pathValue) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'read',
      payload: { path: pathValue }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki read failed.');
    return res.data;
  },
  upsertMcpWikiNote: async (pathValue, content, overwrite, explicit, category) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'upsert_note',
      payload: { path: pathValue, content, overwrite: Boolean(overwrite), explicit: Boolean(explicit), category }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki upsert failed.');
    return res.data;
  },
  appendMcpWikiEntry: async (entry, pathValue, heading, explicit, category) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'append_entry',
      payload: { entry, path: pathValue, heading, explicit: Boolean(explicit), category }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki append failed.');
    return res.data;
  },
  searchMcpWiki: async (query, maxResults) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'search',
      payload: { query, maxResults }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki search failed.');
    return res.data;
  },
  deleteMcpWikiPath: async (pathValue) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'delete',
      payload: { path: pathValue }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki delete failed.');
    return res.data;
  },
  renameMcpWikiPath: async (fromPath, toPath) => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'rename',
      payload: { fromPath, toPath }
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki rename failed.');
    return res.data;
  },
  reindexMcpWiki: async () => {
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'wiki',
      action: 'reindex',
      payload: {}
    });
    if (!res?.ok) throw new Error(res?.error || 'Wiki reindex failed.');
    return res.data;
  },
  runPlaywright: (url, action) => ipcRenderer.invoke('run-playwright', url, action),
  browserAction: async (options) => {
    const browserAction = String(options?.action || '').toLowerCase();
    const passthroughActions = new Set([
      'create_session',
      'list_sessions',
      'close_session',
      'create_page',
      'list_pages',
      'close_page',
      'activate_page',
      'status',
      'reset'
    ]);
    const gatewayAction = passthroughActions.has(browserAction) ? browserAction : 'action';
    const res = await ipcRenderer.invoke('mcp-gateway-call', {
      server: 'browser',
      action: gatewayAction,
      payload: options ?? {}
    });
    if (!res?.ok) throw new Error(res?.error || 'Browser action failed.');
    return res.data;
  },
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
