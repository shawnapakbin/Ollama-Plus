import { describe, expect, it } from 'vitest';
import {
  detectVisionCapabilityFromShow,
  modelLikelySupportsVision,
  normalizeImageAttachmentMode,
  selectImageTransport
} from '../src/components/Chat/pipeline/imageTransport';

describe('normalizeImageAttachmentMode', () => {
  it('defaults unknown values to both', () => {
    expect(normalizeImageAttachmentMode(undefined)).toBe('both');
    expect(normalizeImageAttachmentMode('')).toBe('both');
    expect(normalizeImageAttachmentMode('invalid')).toBe('both');
  });

  it('accepts explicit supported values', () => {
    expect(normalizeImageAttachmentMode('base64')).toBe('base64');
    expect(normalizeImageAttachmentMode('path')).toBe('path');
    expect(normalizeImageAttachmentMode('both')).toBe('both');
  });
});

describe('modelLikelySupportsVision', () => {
  it('detects common multimodal naming patterns', () => {
    expect(modelLikelySupportsVision('llava:13b')).toBe(true);
    expect(modelLikelySupportsVision('qwen2.5-vl')).toBe(true);
    expect(modelLikelySupportsVision('llama3.2-vision')).toBe(true);
  });

  it('does not mark plain text models as vision', () => {
    expect(modelLikelySupportsVision('llama3.1:8b')).toBe(false);
    expect(modelLikelySupportsVision('mistral')).toBe(false);
  });
});

describe('detectVisionCapabilityFromShow', () => {
  it('detects positive vision signals from show response', () => {
    const show = {
      details: { architecture: 'llava' },
      model_info: { projector: 'clip-vit' }
    };
    expect(detectVisionCapabilityFromShow(show)).toBe(true);
  });

  it('returns null when no strong signal is present', () => {
    expect(detectVisionCapabilityFromShow({ parameters: 'num_ctx 8192' })).toBeNull();
  });
});

describe('selectImageTransport', () => {
  const imagePayloads = ['abc123'];
  const imageReferences = ['C:/tmp/pic.png'];

  it('prefers base64 for vision models when available', () => {
    const out = selectImageTransport({
      preferredMode: 'both',
      supportsVision: true,
      imagePayloads,
      imageReferences
    });
    expect(out.mode).toBe('base64');
    expect(out.images).toEqual(imagePayloads);
  });

  it('uses path mode when explicitly preferred and available', () => {
    const out = selectImageTransport({
      preferredMode: 'path',
      supportsVision: true,
      imagePayloads,
      imageReferences
    });
    expect(out.mode).toBe('path');
    expect(out.imageReferences).toEqual(imageReferences);
  });

  it('falls back to path references for non-vision models', () => {
    const out = selectImageTransport({
      preferredMode: 'both',
      supportsVision: false,
      imagePayloads,
      imageReferences
    });
    expect(out.mode).toBe('path');
    expect(out.images).toEqual([]);
    expect(out.imageReferences).toEqual(imageReferences);
  });

  it('returns none when only base64 exists for non-vision models', () => {
    const out = selectImageTransport({
      preferredMode: 'base64',
      supportsVision: false,
      imagePayloads,
      imageReferences: []
    });
    expect(out.mode).toBe('none');
  });
});
