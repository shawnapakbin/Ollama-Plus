const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

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

  return {
    endpoint,
    model,
    content,
    done: Boolean(payload?.done),
    totalDuration: Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : null,
    evalCount: Number.isFinite(Number(payload?.eval_count)) ? Number(payload.eval_count) : null
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
  let totalDuration = null;
  let evalCount = null;

  const consumeLine = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    const delta = typeof payload?.message?.content === 'string' ? payload.message.content : '';
    if (delta) {
      content += delta;
      callbacks.onToken?.(delta);
    }

    if (payload?.done) {
      totalDuration = Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : totalDuration;
      evalCount = Number.isFinite(Number(payload?.eval_count)) ? Number(payload.eval_count) : evalCount;
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
    totalDuration,
    evalCount
  };
}

export { DEFAULT_OLLAMA_BASE_URL };