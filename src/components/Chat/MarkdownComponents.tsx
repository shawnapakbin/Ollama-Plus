import React from 'react';
import { CodeBlock } from './CodeBlock';

export const MarkdownComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    return !inline && match ? (
      <CodeBlock language={match[1]} value={codeString} {...props} />
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
};
