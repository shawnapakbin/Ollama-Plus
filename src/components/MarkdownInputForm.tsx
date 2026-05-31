import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownUrl } from '../services/markdownSafety';
import './MarkdownInputForm.css';

type Props = {
  title: string;
  markdown: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  maxLength?: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export default function MarkdownInputForm({
  title,
  markdown,
  defaultValue = '',
  placeholder = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  maxLength = 120,
  onSubmit,
  onCancel
}: Props) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="input-form-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="input-form-title">
      <div className="input-form-header">
        <h3 id="input-form-title">{title}</h3>
      </div>

      <div className="input-form-markdown scrollable">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{markdown}</ReactMarkdown>
      </div>

      <div className="input-form-controls">
        <input
          aria-label={title}
          className="input-form-field"
          type="text"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit(value);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          autoFocus
        />
        <div className="input-form-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="primary" onClick={() => onSubmit(value)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
