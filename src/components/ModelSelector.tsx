import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Star, Radar, ChevronDown, Search, Loader2, X } from 'lucide-react';
import { ipcService } from '../services/ipcService';
import './ModelSelector.css';

export type ModelEntry = {
  name: string;
  host: string;
  available: boolean;
};

type LanResult = {
  host: string;
  address: string;
  models: Array<{ name: string }>;
};

interface ModelSelectorProps {
  localHostUrl: string;
  localModels: Array<{ name: string }>;
  selectedModel: string;
  selectedHost: string;
  status: string;
  onSelect: (model: ModelEntry) => void;
  onRefreshLocal: () => void;
  lanPickerOpenSignal?: number;
}

const FAVORITES_KEY = 'modelFavorites.v1';
const LAN_CACHE_KEY = 'lanOllamaHosts.v1';
const LAN_SELECTED_KEY = 'lanOllamaSelectedModels.v1';

function modelKey(host: string, name: string): string {
  return `${host}|${name}`;
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function loadCachedLan(): LanResult[] {
  try {
    const raw = localStorage.getItem(LAN_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.host === 'string' && Array.isArray(entry.models));
  } catch {
    return [];
  }
}

function loadSelectedLanKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(LAN_SELECTED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function shortHost(host: string): string {
  try {
    const u = new URL(host);
    return u.host;
  } catch {
    return host;
  }
}

export default function ModelSelector({
  localHostUrl,
  localModels,
  selectedModel,
  selectedHost,
  status,
  onSelect,
  onRefreshLocal,
  lanPickerOpenSignal = 0
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showLanPicker, setShowLanPicker] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [lanHosts, setLanHosts] = useState<LanResult[]>(() => loadCachedLan());
  const [selectedLanKeys, setSelectedLanKeys] = useState<Set<string>>(() => loadSelectedLanKeys());
  const [draftLanKeys, setDraftLanKeys] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastUnavailableSelectionRef = useRef('');
  const lastHandledLanPickerSignalRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem(LAN_CACHE_KEY, JSON.stringify(lanHosts));
  }, [lanHosts]);

  useEffect(() => {
    localStorage.setItem(LAN_SELECTED_KEY, JSON.stringify([...selectedLanKeys]));
  }, [selectedLanKeys]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const results = await ipcService.scanLanOllama();
      setLanHosts(Array.isArray(results) ? results : []);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, []);

  const openLanPicker = useCallback(() => {
    setDraftLanKeys(new Set(selectedLanKeys));
    setShowLanPicker(true);
  }, [selectedLanKeys]);

  useEffect(() => {
    if (!lanPickerOpenSignal) return;
    if (lanPickerOpenSignal === lastHandledLanPickerSignalRef.current) return;
    lastHandledLanPickerSignalRef.current = lanPickerOpenSignal;
    const timer = window.setTimeout(() => {
      openLanPicker();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lanPickerOpenSignal, openLanPicker]);

  const toggleDraftLan = useCallback((key: string) => {
    setDraftLanKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const applyLanSelection = () => {
    setSelectedLanKeys(new Set(draftLanKeys));
    setShowLanPicker(false);
    setQuery('');
    setOpen(true);
  };

  const allModels: ModelEntry[] = useMemo(() => {
    const seen = new Set<string>();
    const result: ModelEntry[] = [];
    for (const m of localModels) {
      if (!m?.name) continue;
      const key = modelKey(localHostUrl, m.name);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ name: m.name, host: localHostUrl, available: true });
    }
    for (const lan of lanHosts) {
      for (const m of lan.models) {
        if (!m?.name) continue;
        const key = modelKey(lan.host, m.name);
        if (!selectedLanKeys.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ name: m.name, host: lan.host, available: true });
      }
    }

    // Keep user-selected LAN models visible even when a host/model is currently offline.
    for (const key of selectedLanKeys) {
      if (seen.has(key)) continue;
      const sep = key.indexOf('|');
      if (sep <= 0 || sep >= key.length - 1) continue;
      const host = key.slice(0, sep);
      const name = key.slice(sep + 1);
      if (!host || !name) continue;
      seen.add(key);
      result.push({ name, host, available: false });
    }

    return result;
  }, [localModels, localHostUrl, lanHosts, selectedLanKeys]);

  const scannedModelCount = useMemo(
    () => lanHosts.reduce((count, host) => count + host.models.length, 0),
    [lanHosts]
  );

  useEffect(() => {
    if (!selectedModel) return;
    const activeExists = allModels.some((m) => m.name === selectedModel && m.host === selectedHost);
    if (activeExists) {
      lastUnavailableSelectionRef.current = '';
      return;
    }

    const selectionKey = modelKey(selectedHost, selectedModel);
    if (lastUnavailableSelectionRef.current === selectionKey) return;
    lastUnavailableSelectionRef.current = selectionKey;

    if (allModels.length > 0) {
      const timer = window.setTimeout(() => {
        setQuery('');
        setOpen(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [allModels, onSelect, selectedHost, selectedModel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter((m) => m.name.toLowerCase().includes(q) || m.host.toLowerCase().includes(q));
  }, [allModels, query]);

  const { pinned, rest } = useMemo(() => {
    const pinnedList: ModelEntry[] = [];
    const restList: ModelEntry[] = [];
    for (const m of filtered) {
      if (favorites.has(modelKey(m.host, m.name))) pinnedList.push(m);
      else restList.push(m);
    }
    pinnedList.sort((a, b) => a.name.localeCompare(b.name));
    restList.sort((a, b) => {
      if (a.host !== b.host) {
        if (a.host === localHostUrl) return -1;
        if (b.host === localHostUrl) return 1;
        return a.host.localeCompare(b.host);
      }
      return a.name.localeCompare(b.name);
    });
    return { pinned: pinnedList, rest: restList };
  }, [filtered, favorites, localHostUrl]);

  const selectedExists = Boolean(selectedModel) && allModels.some((m) => m.name === selectedModel && m.host === selectedHost);
  const triggerLabel = selectedModel && selectedExists
    ? selectedModel
    : allModels.length === 0
      ? 'No models'
      : selectedModel
        ? 'Model unavailable'
        : 'Select model';
  const triggerHostLabel = selectedModel && selectedExists && selectedHost && selectedHost !== localHostUrl ? shortHost(selectedHost) : null;

  const renderRow = (m: ModelEntry) => {
    const key = modelKey(m.host, m.name);
    const isFav = favorites.has(key);
    const isSelected = m.name === selectedModel && m.host === selectedHost;
    return (
      <li key={key} className={`model-row${isSelected ? ' is-selected' : ''}`}>
        <button
          type="button"
          className={`model-fav-btn${isFav ? ' is-fav' : ''}`}
          aria-label={isFav ? `Unfavorite ${m.name}` : `Favorite ${m.name}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(key);
          }}
        >
          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="model-pick-btn"
          title={m.available ? undefined : 'Model currently unavailable'}
          onClick={() => {
            onSelect(m);
            setOpen(false);
          }}
        >
          <span className="model-pick-name">
            <i
              className={`model-availability-dot${m.available ? ' is-available' : ' is-unavailable'}`}
              aria-hidden="true"
            />
            <span>{m.name}</span>
          </span>
          <span className={`model-pick-host${m.host === localHostUrl ? ' is-local' : ''}`}>
            {m.host === localHostUrl ? 'local' : shortHost(m.host)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="model-selector" ref={rootRef}>
      <label>Model</label>
      <div className="model-select-row">
        <button
          type="button"
          className="model-trigger"
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          title={selectedHost ? `${selectedModel} @ ${shortHost(selectedHost)}` : status}
        >
          <span className="model-trigger-name">{triggerLabel}</span>
          {triggerHostLabel && <span className="model-trigger-host">{triggerHostLabel}</span>}
          <ChevronDown size={14} className="model-trigger-caret" />
        </button>
        <button
          type="button"
          className="icon-only-btn"
          onClick={onRefreshLocal}
          title="Refresh local models"
          aria-label="Refresh local models"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {open && (
        <div className="model-dropdown glass-panel">
          <div className="model-dropdown-search">
            <Search size={14} />
            <input
              autoFocus
              type="text"
              placeholder="Search models or hosts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search models"
            />
          </div>

          <div className="model-dropdown-list">
            {pinned.length > 0 && (
              <>
                <div className="model-section-header">Favorites</div>
                <ul>{pinned.map(renderRow)}</ul>
                <div className="model-section-divider" />
              </>
            )}
            {rest.length > 0 ? (
              <ul>{rest.map(renderRow)}</ul>
            ) : (
              pinned.length === 0 && (
                <div className="model-empty">
                  {allModels.length === 0
                    ? 'No models yet. Refresh local models or scan the LAN.'
                    : 'No matches.'}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {showLanPicker && typeof document !== 'undefined' && createPortal(
        <div
          className="lan-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="LAN model picker"
          onClick={() => setShowLanPicker(false)}
        >
          <div className="lan-picker-panel glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lan-picker-header">
              <div>
                <h3>LAN Model Scanner</h3>
                <p>
                  Scan your network, then choose which LAN models should appear in the model dropdown.
                </p>
              </div>
              <button
                type="button"
                className="icon-only-btn"
                onClick={() => setShowLanPicker(false)}
                aria-label="Close LAN picker"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="lan-picker-toolbar">
              <button
                type="button"
                className="model-scan-btn"
                onClick={handleScan}
                disabled={scanning}
                title="Scan local network for Ollama hosts"
              >
                {scanning ? <Loader2 size={14} className="spin" /> : <Radar size={14} />}
                <span>{scanning ? 'Scanning LAN...' : 'Scan LAN'}</span>
              </button>
              <span className="model-scan-meta">
                {lanHosts.length} host{lanHosts.length === 1 ? '' : 's'} / {scannedModelCount} model{scannedModelCount === 1 ? '' : 's'}
              </span>
            </div>

            {scanError && <div className="model-scan-error">{scanError}</div>}

            <div className="lan-picker-list">
              {lanHosts.length === 0 ? (
                <div className="model-empty">No LAN hosts discovered yet. Click Scan LAN to search.</div>
              ) : (
                lanHosts.map((host) => (
                  <section key={host.host} className="lan-host-group">
                    <header>{shortHost(host.host)}</header>
                    <ul>
                      {host.models.length === 0 ? (
                        <li className="model-empty">No models reported by this host.</li>
                      ) : (
                        host.models.map((m) => {
                          const key = modelKey(host.host, m.name);
                          const checked = draftLanKeys.has(key);
                          return (
                            <li key={key}>
                              <label className="lan-model-option">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDraftLan(key)}
                                />
                                <span>{m.name}</span>
                              </label>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </section>
                ))
              )}
            </div>

            <div className="lan-picker-actions">
              <button type="button" onClick={() => setShowLanPicker(false)}>Cancel</button>
              <button type="button" className="primary" onClick={applyLanSelection}>Apply Selection</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
