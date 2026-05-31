import { useCallback, useEffect, useState } from 'react';
import { ipcService } from '../../../services/ipcService';

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
      const res = await ipcService.invokeOllama(hostUrl, '/api/ps');
      if (res && res.models && res.models.length > 0) {
        const current = res.models.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (m: any) => m.name === selectedModel || selectedModel.startsWith(m.name)
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
    refresh();
  }, [refresh]);

  return { processor, refresh };
}
