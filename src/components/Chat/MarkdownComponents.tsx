import React from 'react';
import { CodeBlock } from './CodeBlock';

interface MarkdownCodeProps extends React.ComponentPropsWithoutRef<'code'> {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const MarkdownComponents = {
  code({ inline, className, children, ...props }: MarkdownCodeProps) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    return !inline && match ? (
      <CodeBlock language={match[1]} value={codeString} />
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
};
