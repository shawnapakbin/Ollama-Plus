export const WIKI_AUTONOMY_MODES = new Set(['auto', 'review', 'hybrid']);
export const WIKI_KNOWLEDGE_POLICIES = new Set(['strict', 'balanced', 'aggressive']);

export const DEFAULT_WIKI_AUTONOMY_MODE = 'hybrid';
export const DEFAULT_WIKI_KNOWLEDGE_POLICY = 'strict';

export function isValidWikiAutonomyMode(value) {
  return typeof value === 'string' && WIKI_AUTONOMY_MODES.has(value);
}

export function isValidWikiKnowledgePolicy(value) {
  return typeof value === 'string' && WIKI_KNOWLEDGE_POLICIES.has(value);
}

export function normalizeWikiConfig(raw) {
  const next = raw && typeof raw === 'object' ? raw : {};
  const root = typeof next.root === 'string' ? next.root : '';
  const autonomyMode = isValidWikiAutonomyMode(next.autonomyMode)
    ? next.autonomyMode
    : DEFAULT_WIKI_AUTONOMY_MODE;
  const knowledgePolicy = isValidWikiKnowledgePolicy(next.knowledgePolicy)
    ? next.knowledgePolicy
    : DEFAULT_WIKI_KNOWLEDGE_POLICY;
  return { root, autonomyMode, knowledgePolicy };
}

export function shouldRequireWikiApproval(action, payload, autonomyMode) {
  if (autonomyMode === 'auto') return false;
  if (autonomyMode === 'review') {
    return ['upsert_note', 'append_entry', 'delete', 'rename'].includes(action);
  }

  if (action === 'delete' || action === 'rename') return true;
  if (action === 'append_entry') return false;
  if (action === 'upsert_note') {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    return Boolean(payload?.overwrite) || content.length > 2000;
  }
  return false;
}

export function evaluateWikiKnowledgePolicy(payload, knowledgePolicy) {
  if (knowledgePolicy === 'aggressive') return { allowed: true };

  const explicit = payload?.explicit === true;
  const category = String(payload?.category || '').toLowerCase();
  const pathValue = String(payload?.path || payload?.relativePath || '').toLowerCase();
  const profileWrite = category === 'profile' || pathValue.startsWith('profile/');

  if (knowledgePolicy === 'strict') {
    if (explicit) return { allowed: true };
    return {
      allowed: false,
      reason: 'Knowledge policy is strict: write operations require explicit user intent. Set explicit=true when the user explicitly asks to save.'
    };
  }

  if (knowledgePolicy === 'balanced') {
    if (explicit || profileWrite) return { allowed: true };
    return {
      allowed: false,
      reason: 'Knowledge policy is balanced: broad knowledge writes require explicit user intent. Profile preference updates are allowed.'
    };
  }

  return { allowed: true };
}
