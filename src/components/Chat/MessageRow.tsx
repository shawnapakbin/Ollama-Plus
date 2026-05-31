import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, FileText, Copy, Check, Pencil, RotateCcw } from 'lucide-react';
import { safeMarkdownUrl } from '../../services/markdownSafety';
import { CollapsibleBlock } from './CollapsibleBlock';
import { MarkdownComponents } from './MarkdownComponents';
import { MessageRenderer } from './MessageRenderer';
import type { ChatMessage } from './types';

interface MessageRowProps {
  message: ChatMessage;
  index: number;
  isCopied: boolean;
  isGenerating: boolean;
  selectedModel: string;
  processor: 'GPU' | 'CPU' | null;
  onCopy: (content: string, index: number) => void;
  onEdit: (index: number) => void;
  onRegenerate: (index: number) => void;
}

const MessageRowImpl: React.FC<MessageRowProps> = ({
  message: m,
  index: i,
  isCopied,
  isGenerating,
  selectedModel,
  processor,
  onCopy,
  onEdit,
  onRegenerate
}) => {
  if (m.role === 'tool') {
    return (
      <div className={`message-row ${m.role}`}>
        <div className="tool-result-container">
          <CollapsibleBlock title={`Tool Output: ${m.name}`} icon={Terminal} type="tool">
            <div className="tool-output">
              {m.content.length > 500 ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={MarkdownComponents}>
                  {m.content.substring(0, 500) + '...'}
                </ReactMarkdown>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={MarkdownComponents}>
                  {m.content}
                </ReactMarkdown>
              )}
            </div>
          </CollapsibleBlock>
        </div>
      </div>
    );
  }

  return (
    <div className={`message-row ${m.role}`}>
      <div className={`message-bubble ${m.role} glass-panel`}>
        <div className="message-header">
          <div className="message-role">{m.role === 'assistant' ? (m.model || selectedModel) : 'User'}</div>
        </div>
        <MessageRenderer content={m.content} toolCalls={m.tool_calls} />
        {m.attachments && m.attachments.length > 0 && (
          <div className="message-attachments">
            {m.attachments.map((name, idx) => (
              <span key={idx} className="attachment-tag">
                <FileText size={11} /> {name}
              </span>
            ))}
          </div>
        )}
        <div className="message-actions">
          <button className="copy-btn" onClick={() => onCopy(m.content, i)} title="Copy to clipboard">
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          {m.role === 'user' && (
            <button className="copy-btn" onClick={() => onEdit(i)} title="Edit message" disabled={isGenerating}>
              <Pencil size={14} />
            </button>
          )}
          {m.role === 'assistant' && (
            <button
              className="copy-btn"
              onClick={() => onRegenerate(i)}
              title="Regenerate response"
              disabled={isGenerating}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
        {m.metrics && (
          <div className="message-metrics-grid">
            <div className="metric-item" title="Total Duration">
              <span className="label">⏱ Total</span>
              <span className="value">{m.metrics.totalDuration}</span>
            </div>
            <div className="metric-item" title="Load Duration">
              <span className="label">📂 Load</span>
              <span className="value">{m.metrics.loadDuration}</span>
            </div>
            <div className="metric-item" title="Prompt Tokens">
              <span className="label">📥 Prompt</span>
              <span className="value">{m.metrics.promptEvalCount} tok</span>
            </div>
            <div className="metric-item" title="Prompt Duration">
              <span className="label">⏱ P-Eval</span>
              <span className="value">{m.metrics.promptEvalDuration}</span>
            </div>
            <div className="metric-item" title="Prompt Rate">
              <span className="label">🚀 P-Rate</span>
              <span className="value">{m.metrics.promptEvalRate}</span>
            </div>
            <div className="metric-item" title="Response Tokens">
              <span className="label">🔤 Response</span>
              <span className="value">{m.metrics.evalCount} tok</span>
            </div>
            <div className="metric-item" title="Response Duration">
              <span className="label">⏱ R-Eval</span>
              <span className="value">{m.metrics.evalDuration}</span>
            </div>
            <div className="metric-item" title="Response Rate">
              <span className="label">⚡ R-Rate</span>
              <span className="value">{m.metrics.evalRate}</span>
            </div>
            {processor && (
              <div className="metric-item">
                <span className="label">💻 Device</span>
                <span className={`processor-badge ${processor.toLowerCase()}`}>{processor}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageRow = React.memo(MessageRowImpl);
