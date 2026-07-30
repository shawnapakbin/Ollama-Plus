import { useCallback, useEffect, useState } from 'react';
import { llmService } from '../../../services/llmService';

interface ProcessorModel {
  name: string;
  size_vram: number;
}

function isProcessorModel(value: unknown): value is ProcessorModel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; size_vram?: unknown };
  return typeof candidate.name === 'string' && typeof candidate.size_vram === 'number';
}

/**
 * Polls `/api/ps` to determine whether the selected model is currently loaded
 * into VRAM (GPU) or system RAM (CPU). Exposes the current label plus a manual
 * refresh that callers can fire after a generation completes.
 */
export function useProcessorStatus(hostUrl: string | undefined, selectedModel: string | undefined) {
  const [processor, setProcessor] = useState<'GPU' | 'CPU' | null>(null);

  const refresh = useCallback(async () => {
    if (!hostUrl || !selectedModel) return;
    try {
      const res = await llmService.listRunningModels(hostUrl, 4_000);
      const models = Array.isArray((res as { models?: unknown }).models)
        ? (res as { models: unknown[] }).models.filter(isProcessorModel)
        : [];

      if (models.length > 0) {
        const current = models.find(
          (m) => m.name === selectedModel || selectedModel.startsWith(m.name)
        );
        if (current) {
          setProcessor(current.size_vram > 0 ? 'GPU' : 'CPU');
        } else {
          setProcessor(null);
        }
      } else {
        setProcessor(null);
      }
    } catch (e) {
      console.error('Failed to fetch processor status', e);
    }
  }, [hostUrl, selectedModel]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return { processor, refresh };
}
