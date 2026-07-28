export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  model?: string;
  name?: string;
  tool_calls?: ToolCall[];
  attachments?: string[];
  images?: string[];
  imageReferences?: string[];
  metrics?: ChatMetrics | null;
}

export interface ChatMetrics {
  totalDuration: string;
  loadDuration: string;
  promptEvalCount: number;
  promptEvalDuration: string;
  promptEvalRate: string;
  evalCount: number;
  evalDuration: string;
  evalRate: string;
}

export interface OllamaFinalResponse {
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
  done: boolean;
}

export interface ThinkBlockSegment {
  kind: 'text' | 'think';
  value: string;
  streaming?: boolean;
}
