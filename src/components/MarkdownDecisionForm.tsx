import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownDecisionForm.css';

type DecisionOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

type DecisionRequest = {
  requestId: string;
  title: string;
  markdown: string;
  options: DecisionOption[];
  createdAt: string;
};

type Props = {
  request: DecisionRequest;
  onSelect: (selectionId: string) => void;
};

export default function MarkdownDecisionForm({ request, onSelect }: Props) {
  return (
    <div className="decision-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <div className="decision-header">
        <h3 id="decision-title">{request.title}</h3>
        <span className="decision-subtitle">Action requires your decision</span>
      </div>

      <div className="decision-markdown scrollable">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{request.markdown}</ReactMarkdown>
      </div>

      <div className="decision-options">
        {request.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`decision-option-btn ${option.recommended ? 'recommended' : ''}`}
            onClick={() => onSelect(option.id)}
            title={option.description || option.label}
          >
            <span className="decision-option-label">{option.label}</span>
            {option.description && <span className="decision-option-description">{option.description}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
