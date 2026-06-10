import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Save, Edit3, Plus, Loader2 } from 'lucide-react';
import MarkdownInputForm from './MarkdownInputForm';
import { ipcService } from '../services/ipcService';
import { safeMarkdownUrl } from '../services/markdownSafety';
import './Wiki.css';

const WIKI_NAME_PATTERN = /^[A-Za-z0-9._\-/ ]+$/;

export default function Wiki() {
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await ipcService.listWiki();
        if (cancelled) return;
        setFiles(list);
        if (list.length > 0) {
          const first = list[0];
          setIsLoading(true);
          setErrorMessage(null);
          try {
            const data = await ipcService.readWiki(first);
            if (cancelled) return;
            setContent(data || '');
            setActiveFile(first);
            setIsEditing(false);
          } catch (err) {
            if (!cancelled) {
              setErrorMessage(err instanceof Error ? err.message : 'Failed to read file.');
            }
          } finally {
            if (!cancelled) setIsLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to list wiki files.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchWikiList = async () => {
    try {
      const list = await ipcService.listWiki();
      setFiles(list);
      if (list.length > 0 && !activeFile) {
        void loadFile(list[0]);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to list wiki files.');
    }
  };

  const loadFile = async (path: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await ipcService.readWiki(path);
      setContent(data || '');
      setActiveFile(path);
      setIsEditing(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read file.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    if (!activeFile) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const ok = await ipcService.writeWiki(activeFile, content);
      if (ok === false) throw new Error('Write rejected by main process.');
      setIsEditing(false);
      await fetchWikiList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save file.');
    } finally {
      setIsSaving(false);
    }
  };

  const createNewFile = () => {
    setErrorMessage(null);
    setShowNewFileForm(true);
  };

  const commitNewFile = (rawName: string | null) => {
    setShowNewFileForm(false);
    const name = (rawName || '').trim();
    if (!name) return;
    if (!WIKI_NAME_PATTERN.test(name) || name.includes('..')) {
      setErrorMessage('Invalid file name. Use letters, numbers, dots, dashes, underscores, slashes or spaces only.');
      return;
    }
    const safeName = name.endsWith('.md') ? name : `${name}.md`;
    setActiveFile(safeName);
    setContent('# ' + safeName.replace('.md', ''));
    setIsEditing(true);
    if (!files.includes(safeName)) {
      setFiles([...files, safeName]);
    }
  };

  return (
    <div className="wiki-container">
      <div className="wiki-sidebar glass-panel">
        <div className="wiki-sidebar-header">
          <h3>Knowledge Base</h3>
          <button onClick={createNewFile} className="icon-btn" title="New Note">
            <Plus size={16} />
          </button>
        </div>
        <div className="wiki-list">
          {files.map(f => (
            <button 
              key={f} 
              className={`wiki-item ${f === activeFile ? 'active' : ''}`}
              onClick={() => loadFile(f)}
            >
              <FileText size={14} /> {f}
            </button>
          ))}
          {files.length === 0 && <p className="no-files">No wiki files found.</p>}
        </div>
      </div>
      
      <div className="wiki-main glass-panel">
        {activeFile ? (
          <div className="wiki-editor-container">
            <div className="wiki-toolbar">
              <span className="wiki-filename">{activeFile}</span>
              <div className="wiki-actions">
                {isEditing ? (
                  <button onClick={saveFile} className="primary" disabled={isSaving}>
                    {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {isSaving ? 'Saving…' : 'Save'}
                  </button>
                ) : (
                  <button onClick={() => setIsEditing(true)}><Edit3 size={14}/> Edit</button>
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="wiki-error" role="alert">{errorMessage}</div>
            )}

            <div className="wiki-content">
              {isLoading ? (
                <div className="empty-state"><Loader2 size={32} className="spin" /><p>Loading…</p></div>
              ) : isEditing ? (
                <textarea 
                  aria-label="Edit wiki markdown"
                  className="wiki-textarea" 
                  value={content} 
                  onChange={(e) => setContent(e.target.value)}
                />
              ) : (
                <div className="wiki-preview scrollable">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl}>{content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={48} className="empty-icon" />
            <p>Select or create a markdown file.</p>
            {errorMessage && <p className="wiki-error" role="alert">{errorMessage}</p>}
          </div>
        )}
      </div>

      {showNewFileForm && (
        <div className="input-overlay">
          <MarkdownInputForm
            title="Create Wiki File"
            markdown="### New wiki note\n\nEnter a file name for this markdown note. The app will append `.md` if missing."
            defaultValue="untitled.md"
            placeholder="notes.md"
            confirmLabel="Create"
            cancelLabel="Cancel"
            onSubmit={(value) => commitNewFile(value)}
            onCancel={() => commitNewFile(null)}
          />
        </div>
      )}
    </div>
  );
}
