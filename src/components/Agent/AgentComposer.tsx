/**
 * AgentComposer — Task submission and follow-up input for the Agent client.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Paperclip, Send, X, FolderOpen } from 'lucide-react';
import type { TaskSession, Attachment } from '../../types/agent';
import './AgentComposer.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_INSTRUCTION_LENGTH = 50_000;
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentComposerProps = {
  modelId?: string;
  endpoint?: string;
  isActive?: boolean;
  activeSessionId?: string;
  onTaskSubmitted?: (session: TaskSession) => void;
};

type LocalAttachment = {
  id: string;
  file: File;
  filename: string;
  mimeType: string;
  size: number;
};

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
      // Strip the data URL prefix to get raw base64
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentComposer({
  modelId,
  endpoint,
  isActive = false,
  activeSessionId,
  onTaskSubmitted
}: AgentComposerProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [instruction, setInstruction] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  const hasModel = Boolean(modelId);
  const instructionTrimmed = instruction.trim();
  const isInstructionValid = instructionTrimmed.length > 0 && instructionTrimmed.length <= MAX_INSTRUCTION_LENGTH;
  const canSubmit = hasModel && isInstructionValid && !submitting;
  const totalAttachmentSize = useMemo(
    () => attachments.reduce((sum, a) => sum + a.size, 0),
    [attachments]
  );
  const charPercentage = (instruction.length / MAX_INSTRUCTION_LENGTH) * 100;

  // ── Validation ─────────────────────────────────────────────────────────────
  const validateInstruction = useCallback((): boolean => {
    if (!instructionTrimmed) {
      setError('Task instruction cannot be empty.');
      return false;
    }
    if (instruction.length > MAX_INSTRUCTION_LENGTH) {
      setError(`Task instruction exceeds the maximum length of ${MAX_INSTRUCTION_LENGTH.toLocaleString()} characters.`);
      return false;
    }
    setError(null);
    return true;
  }, [instruction, instructionTrimmed]);

  // ── Attachment handling ────────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    setAttachmentError(null);

    const newCount = attachments.length + fileArray.length;
    if (newCount > MAX_ATTACHMENTS) {
      setAttachmentError(`Maximum ${MAX_ATTACHMENTS} attachments allowed. You have ${attachments.length} and tried to add ${fileArray.length}.`);
      return;
    }

    const newTotalSize = totalAttachmentSize + fileArray.reduce((s, f) => s + f.size, 0);
    if (newTotalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
      setAttachmentError(`Total attachment size exceeds 50 MB limit.`);
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
  }, [attachments.length, totalAttachmentSize]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    setAttachmentError(null);
  }, []);

  // ── Drop handlers ──────────────────────────────────────────────────────────
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset so the same file can be re-added if removed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addFiles]);

  // ── Submit task ────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!validateInstruction()) return;
    if (!hasModel || !modelId || !endpoint) return;

    setSubmitting(true);
    setError(null);

    try {
      // Convert local attachments to the expected format
      const formattedAttachments: Attachment[] = await Promise.all(
        attachments.map(async (a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          content: await fileToBase64(a.file)
        }))
      );

      const result = await window.electronAPI!.submitAgentTask({
        instruction: instructionTrimmed,
        workingDirectory,
        modelId,
        endpoint,
        attachments: formattedAttachments
      });

      if (result.success) {
        setInstruction('');
        setAttachments([]);
        setWorkingDirectory('');
        setError(null);
        setAttachmentError(null);
        onTaskSubmitted?.(result.session);
      } else {
        setError(result.errors?.join('; ') || 'Task submission failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }, [validateInstruction, hasModel, modelId, endpoint, attachments, instructionTrimmed, workingDirectory, onTaskSubmitted]);

  // ── Follow-up submission ───────────────────────────────────────────────────
  const handleFollowUp = useCallback(async () => {
    const trimmed = followUp.trim();
    if (!trimmed || !activeSessionId) return;

    setFollowUpSubmitting(true);
    try {
      const result = await window.electronAPI!.submitAgentFollowUp(activeSessionId, trimmed);
      if (result.success) {
        setFollowUp('');
      }
    } catch {
      // Silently handle — the Activity Stream will show errors
    } finally {
      setFollowUpSubmitting(false);
    }
  }, [followUp, activeSessionId]);

  const handleFollowUpKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFollowUp();
    }
  }, [handleFollowUp]);

  // ── Follow-up mode ─────────────────────────────────────────────────────────
  if (isActive && activeSessionId) {
    return (
      <div className="agent-composer-followup">
        <span className="agent-composer-followup-label">
          Task session active — send follow-up instructions
        </span>
        <div className="agent-composer-followup-row">
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={handleFollowUpKeyDown}
            placeholder="Provide additional instructions or corrections..."
            disabled={followUpSubmitting}
            aria-label="Follow-up instruction"
          />
          <button
            className="agent-composer-followup-send"
            onClick={handleFollowUp}
            disabled={!followUp.trim() || followUpSubmitting}
            aria-label="Send follow-up"
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Full composer mode ─────────────────────────────────────────────────────
  return (
    <div className="agent-composer">
      {/* Task instruction textarea */}
      <div className="agent-composer-input">
        <textarea
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Describe your task in natural language..."
          maxLength={MAX_INSTRUCTION_LENGTH}
          aria-label="Task instruction"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'agent-composer-error' : undefined}
        />
        <span
          className={`agent-composer-char-count${charPercentage > 90 ? ' near-limit' : ''}`}
          aria-live="polite"
        >
          {instruction.length.toLocaleString()} / {MAX_INSTRUCTION_LENGTH.toLocaleString()}
        </span>
      </div>

      {/* Inline validation error */}
      {error && (
        <div className="agent-composer-error" id="agent-composer-error" role="alert">
          {error}
        </div>
      )}

      {/* File attachments */}
      <div className="agent-composer-attachments">
        <div
          className={`agent-composer-dropzone${dragOver ? ' drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Attach files by dropping or clicking"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
        >
          <Paperclip size={14} />
          <span>Drop files here or click to attach (max {MAX_ATTACHMENTS} files, 50 MB total)</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="agent-composer-dropzone-input"
          onChange={handleFileInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />
        {attachmentError && (
          <div className="agent-composer-error" role="alert">
            {attachmentError}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="agent-composer-file-list">
            {attachments.map((a) => (
              <div className="agent-composer-file-chip" key={a.id}>
                <span title={a.filename}>{a.filename}</span>
                <small>{formatFileSize(a.size)}</small>
                <button
                  className="agent-composer-file-remove"
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
      </div>

      {/* Working directory */}
      <div className="agent-composer-workdir">
        <label htmlFor="agent-workdir-input">
          <FolderOpen size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Working Directory
        </label>
        <input
          id="agent-workdir-input"
          type="text"
          value={workingDirectory}
          onChange={(e) => setWorkingDirectory(e.target.value)}
          placeholder="/path/to/project"
          aria-label="Working directory path"
          autoComplete="off"
        />
      </div>

      {/* Model display */}
      {hasModel ? (
        <div className="agent-composer-model-bar">
          <span className="model-label">Model:</span>
          <span className="model-value">{modelId}</span>
          {endpoint && <span className="model-endpoint">{endpoint}</span>}
        </div>
      ) : (
        <div className="agent-composer-no-model">
          No model configured. Go to the <strong>Models</strong> page to select a model before submitting tasks.
        </div>
      )}

      {/* Actions */}
      <div className="agent-composer-actions">
        <small>
          {attachments.length > 0 &&
            `${attachments.length} file${attachments.length !== 1 ? 's' : ''} (${formatFileSize(totalAttachmentSize)})`}
        </small>
        <button
          className="agent-composer-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
          type="button"
        >
          <Send size={14} />
          {submitting ? 'Submitting...' : 'Submit Task'}
        </button>
      </div>
    </div>
  );
}
