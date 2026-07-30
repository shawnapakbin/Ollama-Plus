import { ipcService } from './ipcService';

export const LLM_ENDPOINTS = {
  tags: '/api/tags',
  show: '/api/show',
  chat: '/api/chat',
  ps: '/api/ps'
} as const;

export const OLLAMA_ENDPOINTS = LLM_ENDPOINTS;

export interface LlmStreamHandlers {
  onData: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

export const llmService = {
  listModels(hostUrl: string) {
    return ipcService.invokeOllama(hostUrl, LLM_ENDPOINTS.tags);
  },

  showModel(hostUrl: string, model: string, timeoutMs?: number) {
    return ipcService.invokeOllama(hostUrl, LLM_ENDPOINTS.show, { model }, timeoutMs);
  },

  chat(hostUrl: string, payload: unknown, timeoutMs?: number) {
    return ipcService.invokeOllama(hostUrl, LLM_ENDPOINTS.chat, payload, timeoutMs);
  },

  listRunningModels(hostUrl: string, timeoutMs?: number) {
    return ipcService.invokeOllama(hostUrl, LLM_ENDPOINTS.ps, undefined, timeoutMs);
  },

  streamChat(hostUrl: string, payload: unknown, handlers: LlmStreamHandlers) {
    return ipcService.invokeOllamaStream(hostUrl, LLM_ENDPOINTS.chat, payload, handlers);
  },

  stopStream(streamId: string) {
    return ipcService.stopOllamaStream(streamId);
  },

  unloadModels(hostUrl: string) {
    return ipcService.unloadModels(hostUrl);
  }
};
