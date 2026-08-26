/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

/**
 * Normalizes a single metric field value.
 * Returns null for undefined, null, non-numeric (NaN, Infinity), or negative values.
 * Preserves zero and positive finite numbers.
 */
export function normalizeMetricField(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  return num;
}

/**
 * Extracts all 6 metric fields from an Ollama response payload (final chunk or non-streaming response).
 * Maps snake_case Ollama fields to camelCase Metrics_Object properties.
 */
export function extractMetrics(payload) {
  return {
    totalDuration: normalizeMetricField(payload?.total_duration),
    loadDuration: normalizeMetricField(payload?.load_duration),
    promptEvalCount: normalizeMetricField(payload?.prompt_eval_count),
    promptEvalDuration: normalizeMetricField(payload?.prompt_eval_duration),
    evalCount: normalizeMetricField(payload?.eval_count),
    evalDuration: normalizeMetricField(payload?.eval_duration),
  };
}

/**
 * Returns the optional tool catalog from a chat input only when it is a
 * non-empty array. Returns null otherwise so callers can omit the `tools`
 * field entirely and keep the outgoing /api/chat body byte-for-byte identical
 * to a tool-less request.
 */
function resolveToolCatalog(input) {
  const tools = input?.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    return tools;
  }
  return null;
}

/**
 * Builds the JSON body for an /api/chat request. Includes a `tools` array only
 * when a non-empty catalog is provided; otherwise the body is exactly
 * { model, stream, messages }.
 */
function buildChatBody({ model, stream, messages, tools }) {
  const body = {
    model,
    stream,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  };
  if (tools) {
    body.tools = tools;
  }
  return body;
}

/**
 * Normalizes the `message.tool_calls` array returned by a tool-capable model
 * into a plain array. Returns an empty array when no tool calls are present.
 */
function normalizeToolCalls(message) {
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }
  return toolCalls.filter((call) => call && typeof call === 'object');
}

function ensureProtocol(value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function normalizeOllamaBaseUrl(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_OLLAMA_BASE_URL;
  const url = new URL(ensureProtocol(raw));

  if (!url.port) {
    url.port = '11434';
  }

  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = typeof payload?.error === 'string' ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(`Ollama request failed: ${detail}`);
  }

  return payload;
}

export async function listOllamaModels(fetchImpl, baseUrl) {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const response = await fetchImpl(`${normalizedBaseUrl}/api/tags`, {
    method: 'GET'
  });
  const payload = await readJson(response);
  const models = Array.isArray(payload?.models)
    ? payload.models
      .map((entry) => ({
        name: typeof entry?.name === 'string' ? entry.name : '',
        size: Number.isFinite(Number(entry?.size)) ? Number(entry.size) : null,
        modifiedAt: typeof entry?.modified_at === 'string' ? entry.modified_at : null
      }))
      .filter((entry) => entry.name)
    : [];

  return {
    endpoint: normalizedBaseUrl,
    models
  };
}

export async function requestOllamaChat(fetchImpl, input) {
  const endpoint = normalizeOllamaBaseUrl(input.endpoint);
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : '';
  if (!model) {
    throw new Error('Select an Ollama model before sending a chat message.');
  }

  const tools = resolveToolCatalog(input);

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(buildChatBody({
      model,
      stream: false,
      messages: input.messages,
      tools
    }))
  });

  const payload = await readJson(response);
  const content = typeof payload?.message?.content === 'string' ? payload.message.content : '';
  const toolCalls = normalizeToolCalls(payload?.message);
  // A tool-call turn legitimately has no text; only error on empty content when
  // the model returned neither content nor a tool call.
  if (!content.trim() && toolCalls.length === 0) {
    throw new Error('Ollama returned an empty assistant message.');
  }

  const metrics = extractMetrics(payload);

  return {
    endpoint,
    model,
    content,
    toolCalls,
    done: Boolean(payload?.done),
    totalDuration: metrics.totalDuration,
    loadDuration: metrics.loadDuration,
    promptEvalCount: metrics.promptEvalCount,
    promptEvalDuration: metrics.promptEvalDuration,
    evalCount: metrics.evalCount,
    evalDuration: metrics.evalDuration,
    metrics
  };
}

export async function requestOllamaChatStream(fetchImpl, input, callbacks = {}) {
  const endpoint = normalizeOllamaBaseUrl(input.endpoint);
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : '';
  if (!model) {
    throw new Error('Select an Ollama model before sending a chat message.');
  }

  const tools = resolveToolCatalog(input);

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(buildChatBody({
      model,
      stream: true,
      messages: input.messages,
      tools
    }))
  });

  if (!response.ok) {
    await readJson(response);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const fallback = await requestOllamaChat(fetchImpl, input);
    callbacks.onToken?.(fallback.content);
    return fallback;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let content = '';
  let metrics = null;
  const toolCalls = [];

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    const delta = typeof payload?.message?.content === 'string' ? payload.message.content : '';
    if (delta) {
      content += delta;
      callbacks.onToken?.(delta);
    }

    // Accumulate any tool calls emitted across streamed chunks (including the
    // final `done` chunk). A tool-call turn may carry no text content.
    for (const call of normalizeToolCalls(payload?.message)) {
      toolCalls.push(call);
    }

    if (payload?.done) {
      metrics = extractMetrics(payload);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      consumeLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeLine(buffer);
  }

  // A tool-call turn legitimately produces no text; only error on empty content
  // when the model returned neither content nor a tool call.
  if (!content.trim() && toolCalls.length === 0) {
    throw new Error('Ollama returned an empty assistant stream.');
  }

  return {
    endpoint,
    model,
    content,
    toolCalls,
    done: true,
    totalDuration: metrics?.totalDuration ?? null,
    loadDuration: metrics?.loadDuration ?? null,
    promptEvalCount: metrics?.promptEvalCount ?? null,
    promptEvalDuration: metrics?.promptEvalDuration ?? null,
    evalCount: metrics?.evalCount ?? null,
    evalDuration: metrics?.evalDuration ?? null,
    metrics
  };
}

export { DEFAULT_OLLAMA_BASE_URL };