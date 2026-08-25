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

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    })
  });

  const payload = await readJson(response);
  const content = typeof payload?.message?.content === 'string' ? payload.message.content : '';
  if (!content.trim()) {
    throw new Error('Ollama returned an empty assistant message.');
  }

  const metrics = extractMetrics(payload);

  return {
    endpoint,
    model,
    content,
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

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    })
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

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    const delta = typeof payload?.message?.content === 'string' ? payload.message.content : '';
    if (delta) {
      content += delta;
      callbacks.onToken?.(delta);
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

  if (!content.trim()) {
    throw new Error('Ollama returned an empty assistant stream.');
  }

  return {
    endpoint,
    model,
    content,
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