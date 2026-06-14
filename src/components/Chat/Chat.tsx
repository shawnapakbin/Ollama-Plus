import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, FileText, Square, Zap } from 'lucide-react';
import { ipcService } from '../../services/ipcService';
import { taskRuntime } from '../../services/taskRuntime';
import { MessageList } from './MessageList';
import { buildSteerPayload } from './pipeline/buildSteerPayload';
import { useChatSession } from './hooks/useChatSession';
import { useOllamaStream } from './hooks/useOllamaStream';
import { useProcessorStatus } from './hooks/useProcessorStatus';
import { useSteerQueue } from './hooks/useSteerQueue';
import { useChatPipeline } from './hooks/useChatPipeline';
import type { ChatMessage } from './types';
import '../Chat.css';

type ChatMode = 'auto' | 'tools' | 'standard';

interface AttachedFile {
  name: string;
  content: string | null;
  parsing?: boolean;
}

interface ChatProps {
  selectedModel: string;
  selectedModelContextWindow?: number | null;
  hostUrl: string;
  keepAlive: boolean;
  sessionId: string | null;
  sessionTitle?: string;
  onSessionUpdate: () => void;
  effectiveSystemMessage: string;
  autoInjectDateTime: boolean;
  researchTurnLimit: number;
  onResearchTurnLimitHit: (message: string) => void;
}

export default function Chat({
  selectedModel,
  selectedModelContextWindow = null,
  hostUrl,
  keepAlive,
  sessionId,
  sessionTitle,
  onSessionUpdate,
  effectiveSystemMessage,
  autoInjectDateTime,
  researchTurnLimit,
  onResearchTurnLimitHit
}: ChatProps) {
  const { messages, setMessages, save: saveSession, rename: renameSession } = useChatSession({ sessionId, onSessionUpdate });
  const [input, setInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('auto');
  const { runStream, stop: stopStream, activeStreamId } = useOllamaStream();
  const { processor, refresh: refreshProcessor } = useProcessorStatus(hostUrl, selectedModel);
  const {
    isGenerating,
    steerQueue,
    setSteerQueue,
    steerQueueRef,
    enterGeneration,
    exitGeneration,
    clear: clearSteerQueue,
    setAbortIntent,
    getAbortIntent
  } = useSteerQueue();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const { commitUserTurn, regenerate } = useChatPipeline({
    hostUrl,
    selectedModel,
    modelContextWindow: selectedModelContextWindow,
    keepAlive,
    chatMode,
    customSystemMessage: effectiveSystemMessage,
    injectDateTime: autoInjectDateTime,
    sessionTitle: sessionTitle ?? 'New Chat',
    messagesRef,
    setMessages,
    saveSession,
    renameSession,
    runStream,
    refreshProcessor,
    enterGeneration,
    exitGeneration,
    getAbortIntent,
    turnLimit: researchTurnLimit,
    onTurnLimitReached: onResearchTurnLimitHit
  });

  const clearChat = () => {
    setMessages([]);
    clearSteerQueue();
  };

  const copyToClipboard = useCallback((text: string, id: number) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleStop = () => {
    setAbortIntent('stop-only');
    stopStream();
    void ipcService.unloadModels(hostUrl).catch((err) => {
      console.warn('Failed to unload models after stop', err);
    });
  };

  const handleInterruptSteer = () => {
    if (!steerQueueRef.current) return;
    setAbortIntent('interrupt-send');
    stopStream();
  };

  const handleSendQueuedSteer = async () => {
    const pending = steerQueueRef.current;
    if (!pending || isGenerating) return;
    setSteerQueue(null);
    await commitUserTurn(pending);
  };

  const handleEdit = useCallback((index: number) => {
    const msg = messagesRef.current[index];
    if (!msg) return;
    setInput(msg.content);
    setMessages(messagesRef.current.slice(0, index));
  }, [setMessages]);

  const handleRegenerate = useCallback(async (index: number) => {
    if (isGenerating) return;
    await regenerate(index);
  }, [isGenerating, regenerate]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  // External components (e.g. the 3D annotation overlay) can request that a
  // prompt be sent through the chat pipeline by dispatching this event.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ text?: string }>).detail;
      const text = (detail?.text || '').trim();
      if (!text || !selectedModel) return;
      const payload = buildSteerPayload(text, []);
      if (isGenerating) {
        steerQueueRef.current = payload;
        setSteerQueue(payload);
        return;
      }
      const taskId = taskRuntime.createTask(payload.preview || 'Annotation request', 'chat');
      taskRuntime.setState(taskId, 'queued', 'Request captured from 3D annotations.');
      void commitUserTurn(payload, taskId);
    };
    window.addEventListener('ollama-plus:inject-prompt', handler as EventListener);
    return () => window.removeEventListener('ollama-plus:inject-prompt', handler as EventListener);
  }, [selectedModel, isGenerating, commitUserTurn, setSteerQueue, steerQueueRef]);

  // Reset the steer queue whenever the session id changes; loading is owned by useChatSession.
  useEffect(() => {
    clearSteerQueue();
  }, [sessionId, clearSteerQueue]);

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || !selectedModel) return;

    const textTrim = input.trim();
    const filesSnapshot = attachedFiles.map(f => ({ ...f }));
    const payload = buildSteerPayload(textTrim, filesSnapshot);

    if (isGenerating) {
      steerQueueRef.current = payload;
      setSteerQueue(payload);
      setInput('');
      setAttachedFiles([]);
      return;
    }

    const taskTitle = payload.preview || textTrim || 'User request';
    const taskId = taskRuntime.createTask(taskTitle, 'chat');
    taskRuntime.setState(taskId, 'queued', 'Request captured from chat input.');

    setInput('');
    setAttachedFiles([]);
    await commitUserTurn(payload, taskId);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const tempEntry: AttachedFile = { name: file.name, content: null, parsing: true };
    setAttachedFiles(prev => [...prev, tempEntry]);

    try {
      let parsedText = '';

      if (ext === 'pdf' || ext === 'csv') {
        const arrayBuffer = await file.arrayBuffer();
        parsedText = await ipcService.parseFileBuffer(ext, Array.from(new Uint8Array(arrayBuffer)));
      } else {
        parsedText = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = ev => resolve(String(ev.target?.result ?? ''));
          reader.onerror = reject;
          reader.readAsText(file);
        });
      }

      setAttachedFiles(prev => prev.map(f =>
        f.name === file.name && f.parsing ? { name: file.name, content: parsedText, parsing: false } : f
      ));
    } catch {
      setAttachedFiles(prev => prev.filter(f => !(f.name === file.name && f.parsing)));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div className="chat-container" onDrop={handleDrop} onDragOver={handleDragOver}>
      <MessageList
        messages={messages}
        isGenerating={isGenerating}
        selectedModel={selectedModel}
        processor={processor}
        copiedId={copiedId}
        onCopy={copyToClipboard}
        onEdit={handleEdit}
        onRegenerate={handleRegenerate}
        endRef={messagesEndRef}
      />

      <div className="chat-footer">
        <div className="chat-controls">
          <button 
            className="nav-item" 
            onClick={clearChat} 
            disabled={isGenerating || messages.length === 0}
            id="clear-chat-btn"
            title="Clear Chat History"
          >
            🗑️ Clear Chat
          </button>
          
          <select 
            aria-label="Select chat mode"
            value={chatMode} 
            onChange={(e) => setChatMode(e.target.value)}
            className="chat-mode-select"
            disabled={isGenerating}
          >
            <option value="auto">🤖 Auto (Smart Routing)</option>
            <option value="standard">🧠 Reasoning Mode (No Tools)</option>
            <option value="tools">🛠️ Agent Mode (Force Tools)</option>
          </select>
        </div>
        {steerQueue && (
          <div className="steer-queue glass-panel">
            <div className="steer-queue-body">
              <span className="steer-queue-label">Queued steer</span>
              <p className="steer-queue-preview">{steerQueue.preview}</p>
            </div>
            {isGenerating ? (
              <button
                type="button"
                className="steer-queue-interrupt"
                onClick={handleInterruptSteer}
                disabled={!activeStreamId}
                title={!activeStreamId ? 'Wait until the model starts streaming' : 'Stop the current reply and send this message now'}
              >
                <Zap size={16} />
                Interrupt
              </button>
            ) : (
              <button
                type="button"
                className="steer-queue-send"
                onClick={() => void handleSendQueuedSteer()}
                title="Send the queued message now"
              >
                <Send size={16} />
                Send now
              </button>
            )}
          </div>
        )}
        <div className="input-box glass-panel">
          {attachedFiles.length > 0 && (
            <div className="attached-files">
              {attachedFiles.map((f, i) => (
                <div key={i} className={`file-chip ${f.parsing ? 'parsing' : ''}`}>
                  <FileText size={12} />
                  <span>{f.name}</span>
                  {f.parsing
                    ? <Loader2 size={12} className="spin" />
                    : <button onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                  }
                </div>
              ))}
            </div>
          )}
          <textarea 
            value={input}
            spellCheck={true}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isGenerating ? 'Queue a steer message… (Enter to queue)' : 'Send a message to Ollama... (Drag and drop files here)'}
            rows={2}
          />
          <div className="input-send-actions">
            {isGenerating && (
              <button className="stop-btn" onClick={handleStop} type="button" title="Stop generation (keeps queued steer for later)">
                <Square size={18} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="primary send-btn"
              onClick={handleSend}
              disabled={!input.trim() && attachedFiles.length === 0}
              title={isGenerating ? 'Queue steer message' : 'Send'}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
