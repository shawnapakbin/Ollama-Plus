/**
 * MessageCard Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Renders a single chat message (user or assistant) with:
 * - Role indicator icon and display label
 * - Timestamp
 * - Markdown-rendered content body (via MessageContent)
 * - Collapsible thinking block (collapsed by default)
 * - Streaming cursor when actively generating
 * - File attachment chips
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 9.2
 */
import { Bot, ChevronRight, FileText, User } from 'lucide-react';
import { useState } from 'react';
import type { ChatMessage } from '../../types/agentChat';
import { MessageContent } from '../Chat/MessageContent';
import './MessageCard.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MessageCardProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ─── ThinkingBlock Sub-Component ─────────────────────────────────────────────

interface ThinkingBlockProps {
  content: string;
}

function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="message-card__thinking">
      <button
        className="message-card__thinking-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Hide thinking' : 'Show thinking'}
      >
        <span
          className={`message-card__thinking-toggle-icon${
            isExpanded ? ' message-card__thinking-toggle-icon--expanded' : ''
          }`}
        >
          <ChevronRight size={12} />
        </span>
        {isExpanded ? 'Hide thinking' : 'Show thinking'}
      </button>
      {isExpanded && (
        <div className="message-card__thinking-content">{content}</div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function MessageCard({ message, isStreaming = false }: MessageCardProps) {
  const isUser = message.role === 'user';
  const roleClass = isUser ? 'message-card--user' : 'message-card--assistant';

  return (
    <div className={`message-card ${roleClass}`} data-message-id={message.id}>
      {/* Header: role icon, label, timestamp */}
      <div className="message-card__header">
        <span className="message-card__role-icon">
          {isUser ? <User size={13} /> : <Bot size={13} />}
        </span>
        <span className="message-card__display-label">
          {message.displayLabel}
        </span>
        <span className="message-card__timestamp">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>

      {/* Body: markdown-rendered content */}
      <div className="message-card__body">
        <MessageContent content={message.content} />
        {isStreaming && (
          <span
            className="message-card__streaming-cursor"
            aria-label="Generating response"
          />
        )}
      </div>

      {/* Thinking block (collapsible, collapsed by default) */}
      {message.thinkingContent && (
        <ThinkingBlock content={message.thinkingContent} />
      )}

      {/* Attachments */}
      {message.attachments.length > 0 && (
        <div className="message-card__attachments">
          {message.attachments.map((file) => (
            <span key={file.id} className="message-card__attachment-chip">
              <FileText size={11} className="message-card__attachment-chip-icon" />
              {file.filename}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
