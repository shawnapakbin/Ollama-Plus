import type { OllamaFinalResponse, ChatMetrics } from '../types';

export function formatMetrics(finalRes: OllamaFinalResponse | null): ChatMetrics | null {
  if (!finalRes) return null;
  return {
    totalDuration: (finalRes.total_duration / 1e9).toFixed(2) + 's',
    loadDuration: (finalRes.load_duration / 1e6).toFixed(2) + 'ms',
    promptEvalCount: finalRes.prompt_eval_count,
    promptEvalDuration: (finalRes.prompt_eval_duration / 1e6).toFixed(2) + 'ms',
    promptEvalRate: (finalRes.prompt_eval_count / (finalRes.prompt_eval_duration / 1e9)).toFixed(2) + ' tok/s',
    evalCount: finalRes.eval_count,
    evalDuration: (finalRes.eval_duration / 1e6).toFixed(2) + 'ms',
    evalRate: (finalRes.eval_count / (finalRes.eval_duration / 1e9)).toFixed(2) + ' tok/s'
  };
}
