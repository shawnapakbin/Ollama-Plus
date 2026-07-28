export type ImageAttachmentMode = 'base64' | 'path' | 'both';

export interface ImageTransportSelection {
  mode: 'none' | 'base64' | 'path';
  images: string[];
  imageReferences: string[];
  reason: string;
}

export function normalizeImageAttachmentMode(value: string | undefined): ImageAttachmentMode {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'base64' || normalized === 'path' || normalized === 'both') {
    return normalized;
  }
  return 'both';
}

export function modelLikelySupportsVision(modelName: string): boolean {
  const value = (modelName || '').toLowerCase();
  if (!value) return false;
  return /(vision|llava|bakllava|moondream|minicpm|qwen.*vl|llama\s*3\.?2.*vision)/i.test(value);
}

function walkUnknown(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((entry) => walkUnknown(entry, depth + 1)).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map((entry) => walkUnknown(entry, depth + 1)).join(' ');
  }
  return '';
}

/**
 * Attempts to infer vision support from `/api/show` response payload.
 * Returns null when no strong signal is present.
 */
export function detectVisionCapabilityFromShow(showResponse: unknown): boolean | null {
  if (!showResponse || typeof showResponse !== 'object') return null;
  const text = walkUnknown(showResponse).toLowerCase();
  if (!text.trim()) return null;

  const positive = /(vision|llava|bakllava|moondream|minicpm|projector|clip|multimodal|image encoder|vision tower|qwen.*vl)/i;
  const negative = /(text-only|text only|no vision|vision:\s*false)/i;

  if (positive.test(text)) return true;
  if (negative.test(text)) return false;
  return null;
}

export function selectImageTransport(args: {
  preferredMode: ImageAttachmentMode;
  supportsVision: boolean;
  imagePayloads: string[];
  imageReferences: string[];
}): ImageTransportSelection {
  const payloads = args.imagePayloads.filter((x) => x && x.trim().length > 0);
  const refs = args.imageReferences.filter((x) => x && x.trim().length > 0);

  if (payloads.length === 0 && refs.length === 0) {
    return { mode: 'none', images: [], imageReferences: [], reason: 'no-image-input' };
  }

  if (args.supportsVision) {
    if (args.preferredMode === 'base64' && payloads.length > 0) {
      return { mode: 'base64', images: payloads, imageReferences: [], reason: 'preferred-base64' };
    }
    if (args.preferredMode === 'path' && refs.length > 0) {
      return { mode: 'path', images: [], imageReferences: refs, reason: 'preferred-path' };
    }
    if (payloads.length > 0) {
      return { mode: 'base64', images: payloads, imageReferences: [], reason: 'fallback-base64' };
    }
    return { mode: 'path', images: [], imageReferences: refs, reason: 'fallback-path' };
  }

  if (refs.length > 0) {
    return { mode: 'path', images: [], imageReferences: refs, reason: 'non-vision-path-reference' };
  }

  return { mode: 'none', images: [], imageReferences: [], reason: 'non-vision-no-path-fallback' };
}
