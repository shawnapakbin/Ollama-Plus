/**
 * Unit tests for ToolUseGroup component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToolUseGroup } from '../../../src/components/Agent/ToolUseGroup';
import type { ToolUseBlockState } from '../../../src/types/agentChat';

vi.mock('../../../src/components/Agent/ToolUseBlock', () => ({
  ToolUseBlock: ({ block }: { block: ToolUseBlockState }) => <div>{block.tool}</div>,
}));

vi.mock('../../../src/components/Agent/ToolUseGroup.css', () => ({}));

function createBlock(id: string): ToolUseBlockState {
  return {
    id,
    timestamp: `2024-01-01T00:00:0${id}.000Z`,
    tool: `tool-${id}`,
    category: 'file',
    params: {},
    output: null,
    status: 'success',
    error: null,
    duration: 1,
    afterMessageId: null,
  };
}

describe('ToolUseGroup', () => {
  it('uses button headers and links each header to a unique content region', () => {
    const { container } = render(
      <>
        <ToolUseGroup blocks={[createBlock('1'), createBlock('2')]} defaultExpanded={true} />
        <ToolUseGroup blocks={[createBlock('3'), createBlock('4')]} defaultExpanded={true} />
      </>
    );

    const headers = Array.from(container.querySelectorAll<HTMLButtonElement>('.tool-use-group__header'));
    const contents = Array.from(container.querySelectorAll<HTMLDivElement>('.tool-use-group__content'));

    expect(headers).toHaveLength(2);
    expect(contents).toHaveLength(2);
    expect(headers[0]?.type).toBe('button');
    expect(headers[1]?.type).toBe('button');
    expect(headers[0]?.getAttribute('aria-controls')).toBe(contents[0]?.id);
    expect(headers[1]?.getAttribute('aria-controls')).toBe(contents[1]?.id);
    expect(contents[0]?.id).not.toBe(contents[1]?.id);
  });
});
