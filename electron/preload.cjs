const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getRuntimeStatus: () => ipcRenderer.invoke('lang-runtime:get-status'),
  getRuntimeBootstrapPlan: () => ipcRenderer.invoke('lang-runtime:get-bootstrap-plan'),
  getGraphCatalog: () => ipcRenderer.invoke('lang-runtime:get-graph-catalog'),
  listRuntimeSessions: () => ipcRenderer.invoke('lang-runtime:list-sessions'),
  createRuntimeSession: (title) => ipcRenderer.invoke('lang-runtime:create-session', title),
  getRuntimeChatConfig: () => ipcRenderer.invoke('lang-runtime:get-chat-config'),
  saveRuntimeChatConfig: (input) => ipcRenderer.invoke('lang-runtime:save-chat-config', input),
  listRuntimeOllamaModels: (endpoint) => ipcRenderer.invoke('lang-runtime:list-ollama-models', endpoint),
  listRuntimeMessages: (sessionId) => ipcRenderer.invoke('lang-runtime:list-messages', sessionId),
  sendRuntimeChatMessage: (input) => ipcRenderer.invoke('lang-runtime:send-chat-message', input),
  sendRuntimeChatMessageStream: (input) => ipcRenderer.invoke('lang-runtime:send-chat-message-stream', input),
  onRuntimeChatStream: (listener) => {
    const subscription = (_event, payload) => listener(payload);
    ipcRenderer.on('lang-runtime:chat-stream', subscription);
    return () => ipcRenderer.removeListener('lang-runtime:chat-stream', subscription);
  },
  listRuntimeRuns: (sessionId) => ipcRenderer.invoke('lang-runtime:list-runs', sessionId),
  startRuntimeRun: (graphId, sessionId) => ipcRenderer.invoke('lang-runtime:start-run', graphId, sessionId),
  executeRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:execute-run', runId),
  resumeRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:resume-run', runId),
  stepRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:step-run', runId),
  cancelRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:cancel-run', runId),
  approveRuntimeRun: (runId, decision) => ipcRenderer.invoke('lang-runtime:approve-run', runId, decision),
  denyRuntimeRun: (runId, decision) => ipcRenderer.invoke('lang-runtime:deny-run', runId, decision)
});