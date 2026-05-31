import { describe, it, expect } from 'vitest';
import { formatMetrics } from '../src/components/Chat/pipeline/formatMetrics';

describe('formatMetrics', () => {
  it('returns null when there is no final response', () => {
    expect(formatMetrics(null)).toBeNull();
  });

  it('formats nanosecond and millisecond fields', () => {
    const out = formatMetrics({
      total_duration: 2_000_000_000, // 2s
      load_duration: 50_000_000,     // 50ms
      prompt_eval_count: 100,
      prompt_eval_duration: 200_000_000, // 200ms
      eval_count: 500,
      eval_duration: 5_000_000_000, // 5s
      done: true
    });
    expect(out).toEqual({
      totalDuration: '2.00s',
      loadDuration: '50.00ms',
      promptEvalCount: 100,
      promptEvalDuration: '200.00ms',
      promptEvalRate: '500.00 tok/s',
      evalCount: 500,
      evalDuration: '5000.00ms',
      evalRate: '100.00 tok/s'
    });
  });
});
