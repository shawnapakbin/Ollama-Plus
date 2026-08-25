/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getRuntimeStatus: () => ipcRenderer.invoke('lang-runtime:get-status'),
  getRuntimeBootstrapPlan: () => ipcRenderer.invoke('lang-runtime:get-bootstrap-plan'),
  getGraphCatalog: () => ipcRenderer.invoke('lang-runtime:get-graph-catalog'),
  listRuntimeSessions: () => ipcRenderer.invoke('lang-runtime:list-sessions'),
  createRuntimeSession: (title) => ipcRenderer.invoke('lang-runtime:create-session', title),
  renameRuntimeSession: (sessionId, title) => ipcRenderer.invoke('lang-runtime:rename-session', sessionId, title),
  renameRuntimeSessionWithAi: (sessionId, input) => ipcRenderer.invoke('lang-runtime:rename-session-ai', sessionId, input),
  deleteRuntimeSession: (sessionId) => ipcRenderer.invoke('lang-runtime:delete-session', sessionId),
  getRuntimeChatConfig: () => ipcRenderer.invoke('lang-runtime:get-chat-config'),
  saveRuntimeChatConfig: (input) => ipcRenderer.invoke('lang-runtime:save-chat-config', input),
  listRuntimeOllamaModels: (endpoint) => ipcRenderer.invoke('lang-runtime:list-ollama-models', endpoint),
  listRuntimeOllamaServers: () => ipcRenderer.invoke('lang-runtime:list-ollama-servers'),
  saveRuntimeOllamaServer: (input) => ipcRenderer.invoke('lang-runtime:save-ollama-server', input),
  removeRuntimeOllamaServer: (serverId) => ipcRenderer.invoke('lang-runtime:remove-ollama-server', serverId),
  checkRuntimeOllamaServer: (serverId) => ipcRenderer.invoke('lang-runtime:check-ollama-server', serverId),
  listRuntimeMessages: (sessionId) => ipcRenderer.invoke('lang-runtime:list-messages', sessionId),
  updateRuntimeMessage: (messageId, input) => ipcRenderer.invoke('lang-runtime:update-message', messageId, input),
  deleteRuntimeMessage: (messageId) => ipcRenderer.invoke('lang-runtime:delete-message', messageId),
  sendRuntimeChatMessage: (input) => ipcRenderer.invoke('lang-runtime:send-chat-message', input),
  sendRuntimeChatMessageStream: (input) => ipcRenderer.invoke('lang-runtime:send-chat-message-stream', input),
  onRuntimeChatStream: (listener) => {
    const subscription = (_event, payload) => listener(payload);
    ipcRenderer.on('lang-runtime:chat-stream', subscription);
    return () => ipcRenderer.removeListener('lang-runtime:chat-stream', subscription);
  },
  listRuntimeRuns: (sessionId) => ipcRenderer.invoke('lang-runtime:list-runs', sessionId),
  listRuntimeMemoryRecords: (sessionId) => ipcRenderer.invoke('lang-runtime:list-memory-records', sessionId),
  startRuntimeRun: (graphId, sessionId) => ipcRenderer.invoke('lang-runtime:start-run', graphId, sessionId),
  executeRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:execute-run', runId),
  resumeRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:resume-run', runId),
  stepRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:step-run', runId),
  cancelRuntimeRun: (runId) => ipcRenderer.invoke('lang-runtime:cancel-run', runId),
  approveRuntimeRun: (runId, decision) => ipcRenderer.invoke('lang-runtime:approve-run', runId, decision),
  denyRuntimeRun: (runId, decision) => ipcRenderer.invoke('lang-runtime:deny-run', runId, decision),
  mcpGatewayCall: (request) => ipcRenderer.invoke('mcp-gateway-call', request),
  mcpGatewayStatus: () => ipcRenderer.invoke('mcp-gateway-status'),
  // Agent client IPC methods (renderer → main)
  submitAgentTask: (submission) => ipcRenderer.invoke('agent:submit-task', submission),
  pauseAgentTask: (sessionId) => ipcRenderer.invoke('agent:pause-task', sessionId),
  resumeAgentTask: (sessionId) => ipcRenderer.invoke('agent:resume-task', sessionId),
  cancelAgentTask: (sessionId) => ipcRenderer.invoke('agent:cancel-task', sessionId),
  submitAgentFollowUp: (sessionId, instruction) => ipcRenderer.invoke('agent:submit-follow-up', sessionId, instruction),
  submitAgentFeedback: (sessionId, stepId, feedback) => ipcRenderer.invoke('agent:submit-feedback', sessionId, stepId, feedback),
  approveAgentGate: (sessionId, gateId) => ipcRenderer.invoke('agent:approve-gate', sessionId, gateId),
  denyAgentGate: (sessionId, gateId, reason) => ipcRenderer.invoke('agent:deny-gate', sessionId, gateId, reason),
  getAgentConfig: () => ipcRenderer.invoke('agent:get-config'),
  saveAgentConfig: (config) => ipcRenderer.invoke('agent:save-config', config),
  listAgentSessions: (options) => ipcRenderer.invoke('agent:list-sessions', options),
  getAgentSession: (sessionId) => ipcRenderer.invoke('agent:get-session', sessionId),
  rerunAgentTask: (sessionId) => ipcRenderer.invoke('agent:rerun-task', sessionId),
  // Agent activity stream event listener (main → renderer)
  onAgentStream: (listener) => {
    const subscription = (_event, payload) => listener(payload);
    ipcRenderer.on('agent:activity-stream', subscription);
    return () => ipcRenderer.removeListener('agent:activity-stream', subscription);
  },
  // Agent chat IPC methods (agent-page-redesign)
  sendAgentChatMessage: (input) => ipcRenderer.invoke('agent-chat:send-message', input),
  onAgentChatStream: (listener) => {
    const subscription = (_event, payload) => listener(payload);
    ipcRenderer.on('agent-chat:stream', subscription);
    return () => ipcRenderer.removeListener('agent-chat:stream', subscription);
  },
  stopAgentGeneration: (sessionId) => ipcRenderer.invoke('agent-chat:stop', sessionId),
  getLastActiveAgentSession: () => ipcRenderer.invoke('agent-chat:get-last-active-session'),
  deleteAgentSession: (sessionId) => ipcRenderer.invoke('agent-chat:delete-session', sessionId),
  // Auto-updater event listeners (main → renderer)
  onUpdateAvailable: (listener) => {
    const sub = (_event, payload) => listener(payload);
    ipcRenderer.on('updater:update-available', sub);
    return () => ipcRenderer.removeListener('updater:update-available', sub);
  },
  onUpdateProgress: (listener) => {
    const sub = (_event, payload) => listener(payload);
    ipcRenderer.on('updater:download-progress', sub);
    return () => ipcRenderer.removeListener('updater:download-progress', sub);
  },
  onUpdateDownloaded: (listener) => {
    const sub = (_event, payload) => listener(payload);
    ipcRenderer.on('updater:update-downloaded', sub);
    return () => ipcRenderer.removeListener('updater:update-downloaded', sub);
  },
  onUpdateError: (listener) => {
    const sub = (_event, payload) => listener(payload);
    ipcRenderer.on('updater:error', sub);
    return () => ipcRenderer.removeListener('updater:error', sub);
  },
  // Auto-updater commands (renderer → main)
  downloadUpdate: () => ipcRenderer.invoke('updater:download-update'),
  installUpdate: () => ipcRenderer.invoke('updater:install-update'),
  dismissUpdate: () => ipcRenderer.invoke('updater:dismiss')
});