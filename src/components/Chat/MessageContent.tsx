/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.2
 */
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

type MessageContentProps = {
  content: string;
};

export function MessageContent({ content }: MessageContentProps) {
  if (!content || !content.trim()) {
    return <div className="message-content" />;
  }

  return (
    <div className="message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
