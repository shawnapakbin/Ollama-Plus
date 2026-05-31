import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Cpu, Loader2 } from 'lucide-react';
import { safeMarkdownUrl } from '../../services/markdownSafety';
import { CollapsibleBlock } from './CollapsibleBlock';
import { MarkdownComponents } from './MarkdownComponents';
import { parseThinkBlocks } from './pipeline/thinkBlockParser';
import type { ToolCall } from './types';

interface MessageRendererProps {
  content: string;
  toolCalls?: ToolCall[] | null;
}

export const MessageRenderer: React.FC<MessageRendererProps> = React.memo(function MessageRenderer({ content, toolCalls }) {
  const elements: React.ReactNode[] = [];

  if (toolCalls && toolCalls.length > 0) {
    toolCalls.forEach((call, idx) => {
      elements.push(
        <CollapsibleBlock
          key={`call-${idx}`}
          title={`Tool Call: ${call.function.name}`}
          icon={Cpu}
          type="tool"
        >
          <pre className="tool-args">
            <code>{JSON.stringify(call.function.arguments, null, 2)}</code>
          </pre>
        </CollapsibleBlock>
      );
    });
  }

  const segments = parseThinkBlocks(content || '');
  if (segments.length === 0) {
    return elements.length > 0 ? <>{elements}</> : null;
  }

  segments.forEach((seg, idx) => {
    if (seg.kind === 'text') {
      elements.push(
        <div key={`text-${idx}`} className="final-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={MarkdownComponents}>
            {seg.value}
          </ReactMarkdown>
        </div>
      );
    } else if (seg.streaming) {
      elements.push(
        <CollapsibleBlock
          key={`think-streaming-${idx}`}
          title="Thinking..."
          icon={Loader2}
          type="thought"
          isOpen={true}
          isStreaming={true}
        >
          <div className="streaming-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={MarkdownComponents}>
              {seg.value}
            </ReactMarkdown>
          </div>
        </CollapsibleBlock>
      );
    } else {
      elements.push(
        <CollapsibleBlock key={`think-${idx}`} title="Thought Process" icon={Bot} type="thought">
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={MarkdownComponents}>
            {seg.value}
          </ReactMarkdown>
        </CollapsibleBlock>
      );
    }
  });

  return <>{elements}</>;
});
