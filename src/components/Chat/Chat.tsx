import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, FileText, Square, Zap, Bold, Italic, Underline, List, ListOrdered, Image as ImageIcon } from 'lucide-react';
import { ipcService } from '../../services/ipcService';
import { taskRuntime } from '../../services/taskRuntime';
import { MessageList } from './MessageList';
import { buildSteerPayload } from './pipeline/buildSteerPayload';
import { normalizeImageAttachmentMode } from './pipeline/imageTransport';
import { useChatSession } from './hooks/useChatSession';
import { useOllamaStream } from './hooks/useOllamaStream';
import { useProcessorStatus } from './hooks/useProcessorStatus';
import { useSteerQueue } from './hooks/useSteerQueue';
import { useChatPipeline } from './hooks/useChatPipeline';
import { isToolingEnabledInProfile } from './tools/toolPolicy';
import type { ChatMessage } from './types';
import '../Chat.css';

type ChatMode = 'auto' | 'tools' | 'standard';

interface AttachedFile {
  id: string;
  name: string;
  content: string | null;
  kind?: 'text' | 'image';
  imageBase64?: string | null;
  imagePath?: string | null;
  meta?: string;
  parsing?: boolean;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_RENDER_DIMENSION = 2048;
const IMAGE_RECOMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(String(ev.target?.result ?? ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface PreprocessedImagePayload {
  base64: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  optimized: boolean;
}

function decodeImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function computeScaledSize(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function estimateBase64Bytes(base64: string): number {
  const padding = (base64.match(/=*$/)?.[0].length || 0);
  return Math.floor((base64.length * 3) / 4) - padding;
}

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1).trim() : '';
}

async function preprocessImageFile(file: File): Promise<PreprocessedImagePayload> {
  const originalDataUrl = await readAsDataUrl(file);
  const originalBase64 = stripDataUrlPrefix(originalDataUrl);
  const originalBytes = estimateBase64Bytes(originalBase64);
  const image = await decodeImageFromDataUrl(originalDataUrl);

  const scaled = computeScaledSize(image.naturalWidth, image.naturalHeight, IMAGE_MAX_RENDER_DIMENSION);
  const needsResize = scaled.width !== image.naturalWidth || scaled.height !== image.naturalHeight;
  const shouldRecompress = needsResize || originalBytes > IMAGE_RECOMPRESS_THRESHOLD_BYTES;

  if (!shouldRecompress) {
    return {
      base64: originalBase64,
      mimeType: file.type || 'image/png',
      bytes: originalBytes,
      width: image.naturalWidth,
      height: image.naturalHeight,
      optimized: false
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      base64: originalBase64,
      mimeType: file.type || 'image/png',
      bytes: originalBytes,
      width: image.naturalWidth,
      height: image.naturalHeight,
      optimized: false
    };
  }

  ctx.drawImage(image, 0, 0, scaled.width, scaled.height);

  // Prefer webp for strong compression while preserving acceptable quality.
  const candidates: Array<{ mimeType: string; quality?: number }> = [
    { mimeType: 'image/webp', quality: 0.9 },
    { mimeType: 'image/webp', quality: 0.82 },
    { mimeType: 'image/jpeg', quality: 0.85 },
    { mimeType: 'image/jpeg', quality: 0.75 }
  ];

  let bestBase64 = originalBase64;
  let bestMimeType = file.type || 'image/png';
  let bestBytes = originalBytes;

  for (const candidate of candidates) {
    const url = canvas.toDataURL(candidate.mimeType, candidate.quality);
    const b64 = stripDataUrlPrefix(url);
    if (!b64) continue;
    const bytes = estimateBase64Bytes(b64);
    if (bytes < bestBytes) {
      bestBase64 = b64;
      bestMimeType = candidate.mimeType;
      bestBytes = bytes;
    }
  }

  return {
    base64: bestBase64,
    mimeType: bestMimeType,
    bytes: bestBytes,
    width: scaled.width,
    height: scaled.height,
    optimized: bestBytes < originalBytes || needsResize
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeComposerText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function markdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  return escapeHtml(markdown)
    .replace(/\n/g, '<br>');
}

function editorHtmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  const container = document.createElement('div');
  container.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').replace(/\u00a0/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(walk).join('');

    switch (tag) {
      case 'strong':
      case 'b':
        return children ? `**${children}**` : '';
      case 'em':
      case 'i':
        return children ? `*${children}*` : '';
      case 'u':
        return children ? `<u>${children}</u>` : '';
      case 's':
      case 'strike':
        return children ? `~~${children}~~` : '';
      case 'br':
        return '\n';
      case 'code':
        return children ? `\`${children}\`` : '';
      case 'p':
      case 'div':
        return children ? `${children}\n` : '\n';
      case 'li':
        return `${children}\n`;
      case 'ul': {
        const lines = Array.from(element.children).map((child) => `- ${walk(child).trim()}`).filter(Boolean);
        return lines.length ? `${lines.join('\n')}\n` : '';
      }
      case 'ol': {
        const lines = Array.from(element.children)
          .map((child, idx) => `${idx + 1}. ${walk(child).trim()}`)
          .filter(Boolean);
        return lines.length ? `${lines.join('\n')}\n` : '';
      }
      default:
        return children;
    }
  };

  const raw = Array.from(container.childNodes).map(walk).join('');
  return raw
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
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
  const toolingEnabled = isToolingEnabledInProfile();
  const imageAttachmentMode = normalizeImageAttachmentMode(import.meta.env.VITE_IMAGE_ATTACHMENT_MODE as string | undefined);
  const { messages, setMessages, save: saveSession, rename: renameSession } = useChatSession({ sessionId, onSessionUpdate });
  const [composerHtml, setComposerHtml] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>(toolingEnabled ? 'auto' : 'standard');
  const effectiveChatMode: ChatMode = toolingEnabled ? chatMode : 'standard';
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
  const editorRef = useRef<HTMLDivElement | null>(null);
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
    chatMode: effectiveChatMode,
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

  const clearComposer = useCallback(() => {
    setComposerHtml('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  }, []);

  const hasComposerContent = normalizeComposerText(
    editorHtmlToMarkdown(composerHtml)
  ).length > 0;

  const applyEditorCommand = useCallback((command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    if (editorRef.current) setComposerHtml(editorRef.current.innerHTML);
  }, []);

  const handleEdit = useCallback((index: number) => {
    const msg = messagesRef.current[index];
    if (!msg) return;
    const html = markdownToEditorHtml(msg.content);
    setComposerHtml(html);
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
      editorRef.current.focus();
    }
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
    const html = (editorRef.current?.innerHTML || composerHtml || '').trim();
    const textTrim = editorHtmlToMarkdown(html);
    if ((!textTrim.trim() && attachedFiles.length === 0) || !selectedModel) return;

    const filesSnapshot = attachedFiles.map(f => ({ ...f }));
    const payload = buildSteerPayload(textTrim, filesSnapshot);

    if (isGenerating) {
      steerQueueRef.current = payload;
      setSteerQueue(payload);
      clearComposer();
      setAttachedFiles([]);
      return;
    }

    const taskTitle = payload.preview || textTrim || 'User request';
    const taskId = taskRuntime.createTask(taskTitle, 'chat');
    taskRuntime.setState(taskId, 'queued', 'Request captured from chat input.');

    clearComposer();
    setAttachedFiles([]);
    await commitUserTurn(payload, taskId);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length === 0) return;

    for (const file of dropped) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isImage = (file.type || '').toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.has(ext);
      const tempEntry: AttachedFile = {
        name: file.name,
        content: null,
        kind: isImage ? 'image' : 'text',
        mimeType: file.type || undefined,
        parsing: true
      };
      setAttachedFiles(prev => [...prev, tempEntry]);

      try {
        if (isImage) {
          if (file.size > MAX_IMAGE_BYTES) {
            throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
          }
          const processed = await preprocessImageFile(file);
          const imagePath = (file as File & { path?: string }).path || null;
          const kib = Math.max(1, Math.round(processed.bytes / 1024));
          const meta = `${processed.width}x${processed.height} • ${kib} KB${processed.optimized ? ' • optimized' : ''}`;
          setAttachedFiles(prev => prev.map(f =>
            f.name === file.name && f.parsing
              ? {
                  name: file.name,
                  content: null,
                  kind: 'image',
                  mimeType: processed.mimeType,
                  imageBase64: imageAttachmentMode === 'path' ? null : processed.base64,
                  imagePath: imageAttachmentMode === 'base64' ? null : imagePath,
                  meta,
                  parsing: false
                }
              : f
          ));
          continue;
        }

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
          f.name === file.name && f.parsing
            ? { name: file.name, content: parsedText, kind: 'text', parsing: false }
            : f
        ));
      } catch {
        setAttachedFiles(prev => prev.filter(f => !(f.name === file.name && f.parsing)));
      }
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
            value={effectiveChatMode} 
            onChange={(e) => setChatMode(e.target.value as ChatMode)}
            className="chat-mode-select"
            disabled={isGenerating || !toolingEnabled}
            title={toolingEnabled ? 'Select chat mode' : 'Agent tools are disabled in this build profile'}
          >
            <option value="standard">🧠 Reasoning Mode (No Tools)</option>
            {toolingEnabled && <option value="auto">🤖 Auto (Smart Routing)</option>}
            {toolingEnabled && <option value="tools">🛠️ Agent Mode (Force Tools)</option>}
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
                  {f.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                  <span>{f.name}{f.meta ? ` (${f.meta})` : ''}</span>
                  {f.parsing
                    ? <Loader2 size={12} className="spin" />
                    : <button onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                  }
                </div>
              ))}
            </div>
          )}
          <div className="composer-column">
            <div className="composer-toolbar" aria-label="Rich text formatting toolbar">
              <button type="button" className="composer-tool-btn" onClick={() => applyEditorCommand('bold')} title="Bold">
                <Bold size={14} />
              </button>
              <button type="button" className="composer-tool-btn" onClick={() => applyEditorCommand('italic')} title="Italic">
                <Italic size={14} />
              </button>
              <button type="button" className="composer-tool-btn" onClick={() => applyEditorCommand('underline')} title="Underline">
                <Underline size={14} />
              </button>
              <button type="button" className="composer-tool-btn" onClick={() => applyEditorCommand('insertUnorderedList')} title="Bullet list">
                <List size={14} />
              </button>
              <button type="button" className="composer-tool-btn" onClick={() => applyEditorCommand('insertOrderedList')} title="Numbered list">
                <ListOrdered size={14} />
              </button>
            </div>
            <div
              ref={editorRef}
              className="wysiwyg-editor"
              contentEditable
              role="textbox"
              aria-label="Chat message"
              aria-multiline="true"
              data-placeholder={isGenerating ? 'Queue a steer message... (Enter to queue)' : 'Send a message to Ollama... (Drag and drop images or files here)'}
              onInput={(e) => setComposerHtml((e.target as HTMLDivElement).innerHTML)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
          </div>
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
              disabled={!hasComposerContent && attachedFiles.length === 0}
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
