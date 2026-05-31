import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CollapsibleBlockProps {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  type?: string;
  isOpen?: boolean;
  isStreaming?: boolean;
}

export const CollapsibleBlock: React.FC<CollapsibleBlockProps> = ({
  title,
  icon: Icon,
  children,
  type = 'thought',
  isOpen = false,
  isStreaming = false
}) => {
  const [open, setOpen] = useState(isOpen);

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  return (
    <div className={`collapsible-block ${type}`}>
      <div
        className={`block-summary ${isStreaming ? 'streaming' : ''}`}
        onClick={() => setOpen(o => !o)}
        role="button"
      >
        <Icon size={16} className="icon" />
        <span>{title}</span>
        <ChevronDown
          size={16}
          className="chevron"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        />
      </div>
      {open && <div className="block-content">{children}</div>}
    </div>
  );
};
