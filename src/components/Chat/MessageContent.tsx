import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

type MessageContentProps = {
  content: string;
};

export function MessageContent({ content }: MessageContentProps) {
  return (
    <div className="message-content">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}
