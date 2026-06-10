import React from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { MessageRow } from './MessageRow';
import type { ChatMessage } from './types';

interface MessageListProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  selectedModel: string;
  processor: 'GPU' | 'CPU' | null;
  copiedId: number | null;
  onCopy: (content: string, index: number) => void;
  onEdit: (index: number) => void;
  onRegenerate: (index: number) => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isGenerating,
  selectedModel,
  processor,
  copiedId,
  onCopy,
  onEdit,
  onRegenerate,
  endRef
}) => {
  return (
    <div className="messages scrollable">
      {messages.length === 0 && (
        <div className="empty-state">
          <Bot size={48} className="empty-icon" />
          <h3>Ask anything</h3>
          <p>
            Your local Ollama model is ready. Drag and drop CSV, MD, PDF, or TXT files here to analyze them. Use tools
            to execute shell commands, fetch web pages, or read your wiki.
          </p>
        </div>
      )}

      {messages.map((m, i) => (
        <MessageRow
          key={i}
          message={m}
          index={i}
          isCopied={copiedId === i}
          isGenerating={isGenerating}
          selectedModel={selectedModel}
          processor={processor}
          onCopy={onCopy}
          onEdit={onEdit}
          onRegenerate={onRegenerate}
        />
      ))}

      {isGenerating && (
        <div className="message-row assistant">
          <div className="message-bubble assistant glass-panel generating">
            <Loader2 size={18} className="spin" /> Generating...
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
};
