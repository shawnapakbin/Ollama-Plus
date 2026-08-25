/**
 * AgentComposer — Chat-style input bar for the Agent page.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Multi-line textarea with auto-expand, Enter-to-send, file attachments,
 * model indicator, and streaming/approval status display.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.7, 10.6, 11.7
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import type { AttachmentFile } from '../../types/agentChat';
import { isValidMessage, shouldSubmitOnKeyDown } from '../../utils/agent/agentComposerLogic';
import { calculateComposerHeight } from '../../utils/agent/composerHeightCalc';
import { validateAttachments } from '../../utils/agent/attachmentValidator';
import './AgentComposer.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentComposerProps {
  modelId: string | undefined;
  endpoint: string | undefined;
  isConnected: boolean;
  isStreaming: boolean;
  isPendingApproval: boolean;
  onSend: (content: string, attachments: AttachmentFile[]) => void;
  onStop: () => void;
}

interface LocalAttachment {
  id: string;
  file: File;
  filename: string;
  mimeType: string;
  size: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ─── Line height constant for height calculation ────────────────────────────

const LINE_HEIGHT = 22;

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentComposer({
  modelId,
  endpoint,
  isConnected,
  isStreaming,
  isPendingApproval,
  onSend,
  onStop
}: AgentComposerProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(LINE_HEIGHT);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasModel = Boolean(modelId);
  const canSend = hasModel && isValidMessage(content);
  const isDisabled = !hasModel;

  const totalAttachmentSize = useMemo(
    () => attachments.reduce((sum, a) => sum + a.size, 0),
    [attachments]
  );

  // ── Auto-expand textarea height ───────────────────────────────────────────
  useEffect(() => {
    const height = calculateComposerHeight(
      content,
      LINE_HEIGHT,
      window.innerHeight
    );
    setTextareaHeight(height);
  }, [content]);

  // ── Handle content change ─────────────────────────────────────────────────
  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
    },
    []
  );

  // ── Keyboard handling ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (shouldSubmitOnKeyDown(e)) {
        e.preventDefault();
        if (canSend && !isStreaming) {
          handleSendMessage();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSend, isStreaming, content, attachments]
  );

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async () => {
    if (!isValidMessage(content)) return;

    // Convert local attachments to AttachmentFile format
    const formattedAttachments: AttachmentFile[] = await Promise.all(
      attachments.map(async (a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        content: await fileToBase64(a.file)
      }))
    );

    onSend(content, formattedAttachments);

    // Reset state
    setContent('');
    setAttachments([]);
    setAttachmentError(null);
    setTextareaHeight(LINE_HEIGHT);

    // Focus textarea after send
    textareaRef.current?.focus();
  }, [content, attachments, onSend]);

  // ── Attachment handling ────────────────────────────────────────────────────
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      setAttachmentError(null);

      // Build candidate list
      const candidateFiles = [
        ...attachments.map((a) => ({ size: a.size })),
        ...fileArray.map((f) => ({ size: f.size }))
      ];

      const validation = validateAttachments(candidateFiles);
      if (!validation.valid) {
        setAttachmentError(validation.error);
        return;
      }

      const newAttachments: LocalAttachment[] = fileArray.map((file) => ({
        id: generateId(),
        file,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size
      }));

      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [attachments]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setAttachmentError(null);
  }, []);

  // ── Drag-and-drop handlers ────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      // Reset so the same file can be re-added if removed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addFiles]
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`agent-composer${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="agent-composer-attachments">
          {attachments.map((a) => (
            <div className="agent-composer-attachment-chip" key={a.id}>
              <Paperclip size={12} className="agent-composer-attachment-icon" />
              <span className="agent-composer-attachment-name" title={a.filename}>
                {a.filename}
              </span>
              <span className="agent-composer-attachment-size">
                {formatFileSize(a.size)}
              </span>
              <button
                className="agent-composer-attachment-remove"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.filename}`}
                type="button"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attachment error */}
      {attachmentError && (
        <div className="agent-composer-error" role="alert">
          {attachmentError}
        </div>
      )}

      {/* Main input row */}
      <div className="agent-composer-input-row">
        {/* Paperclip attach button */}
        <button
          className="agent-composer-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled}
          aria-label="Attach files"
          type="button"
        >
          <Paperclip size={18} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="agent-composer-file-input"
          onChange={handleFileInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="agent-composer-textarea"
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isDisabled
              ? 'Configure a model in Settings to start chatting'
              : 'Message the agent...'
          }
          disabled={isDisabled}
          style={{ height: `${textareaHeight}px` }}
          aria-label="Chat message input"
          aria-disabled={isDisabled}
          rows={1}
        />

        {/* Send or Stop button */}
        {isStreaming ? (
          <button
            className="agent-composer-stop-btn"
            onClick={onStop}
            aria-label="Stop generation"
            type="button"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            className="agent-composer-send-btn"
            onClick={handleSendMessage}
            disabled={!canSend}
            aria-label="Send message"
            type="button"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>

      {/* Status bar: model indicator + approval status */}
      <div className="agent-composer-status-bar">
        <div className="agent-composer-model-indicator">
          {hasModel ? (
            <>
              <span
                className={`agent-composer-connection-dot ${
                  isConnected ? 'connected' : 'disconnected'
                }`}
                aria-label={isConnected ? 'Connected' : 'Disconnected'}
              />
              <span className="agent-composer-model-name">{modelId}</span>
            </>
          ) : (
            <span className="agent-composer-no-model">No model configured</span>
          )}
        </div>

        {isPendingApproval && (
          <span className="agent-composer-approval-status">
            Waiting for approval...
          </span>
        )}

        {attachments.length > 0 && (
          <span className="agent-composer-attachment-info">
            {attachments.length} file{attachments.length !== 1 ? 's' : ''} ({formatFileSize(totalAttachmentSize)})
          </span>
        )}
      </div>
    </div>
  );
}
