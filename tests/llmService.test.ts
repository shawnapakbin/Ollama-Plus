import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcServiceMock = vi.hoisted(() => ({
  invokeOllama: vi.fn(),
  invokeOllamaStream: vi.fn(),
  stopOllamaStream: vi.fn(),
  unloadModels: vi.fn()
}));

vi.mock('../src/services/ipcService', () => ({
  ipcService: ipcServiceMock
}));

import { llmService, OLLAMA_ENDPOINTS } from '../src/services/llmService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('llmService', () => {
  it('uses the Ollama tags endpoint for model listing', () => {
    llmService.listModels('http://127.0.0.1:11434');
    expect(ipcServiceMock.invokeOllama).toHaveBeenCalledWith('http://127.0.0.1:11434', OLLAMA_ENDPOINTS.tags);
  });

  it('uses the Ollama show endpoint for model capability checks', () => {
    llmService.showModel('http://127.0.0.1:11434', 'qwen2.5');
    expect(ipcServiceMock.invokeOllama).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      OLLAMA_ENDPOINTS.show,
      { model: 'qwen2.5' },
      undefined
    );
  });

  it('uses the Ollama chat endpoint for chat requests', () => {
    const payload = { model: 'qwen2.5', messages: [] };
    llmService.chat('http://127.0.0.1:11434', payload, 1234);
    expect(ipcServiceMock.invokeOllama).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      OLLAMA_ENDPOINTS.chat,
      payload,
      1234
    );
  });

  it('uses the Ollama ps endpoint for processor status', () => {
    llmService.listRunningModels('http://127.0.0.1:11434', 4000);
    expect(ipcServiceMock.invokeOllama).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      OLLAMA_ENDPOINTS.ps,
      undefined,
      4000
    );
  });

  it('routes chat streaming through the chat endpoint', () => {
    const handlers = { onData: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    llmService.streamChat('http://127.0.0.1:11434', { model: 'qwen2.5' }, handlers);
    expect(ipcServiceMock.invokeOllamaStream).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      OLLAMA_ENDPOINTS.chat,
      { model: 'qwen2.5' },
      handlers
    );
  });

  it('forwards stop and unload operations to ipcService', () => {
    llmService.stopStream('stream-1');
    llmService.unloadModels('http://127.0.0.1:11434');

    expect(ipcServiceMock.stopOllamaStream).toHaveBeenCalledWith('stream-1');
    expect(ipcServiceMock.unloadModels).toHaveBeenCalledWith('http://127.0.0.1:11434');
  });
});
