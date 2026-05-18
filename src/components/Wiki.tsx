import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Save, Edit3, Plus } from 'lucide-react';
import MarkdownInputForm from './MarkdownInputForm';
import { ipcService } from '../services/ipcService';
import './Wiki.css';

export default function Wiki() {
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showNewFileForm, setShowNewFileForm] = useState(false);

  useEffect(() => {
    void fetchWikiList();
  }, []);

  const fetchWikiList = async () => {
    const list = await ipcService.listWiki();
    setFiles(list);
    if (list.length > 0 && !activeFile) {
      void loadFile(list[0]);
    }
  };

  const loadFile = async (path) => {
    const data = await ipcService.readWiki(path);
    setContent(data || '');
    setActiveFile(path);
    setIsEditing(false);
  };

  const saveFile = async () => {
    if (!activeFile) return;
    await ipcService.writeWiki(activeFile, content);
    setIsEditing(false);
    await fetchWikiList();
  };

  const createNewFile = () => {
    setShowNewFileForm(true);
  };

  const commitNewFile = (rawName: string | null) => {
    setShowNewFileForm(false);
    const name = (rawName || '').trim();
    if (name) {
      const safeName = name.endsWith('.md') ? name : `${name}.md`;
      setActiveFile(safeName);
      setContent('# ' + safeName.replace('.md', ''));
      setIsEditing(true);
      if (!files.includes(safeName)) {
        setFiles([...files, safeName]);
      }
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
                  <button onClick={saveFile} className="primary"><Save size={14}/> Save</button>
                ) : (
                  <button onClick={() => setIsEditing(true)}><Edit3 size={14}/> Edit</button>
                )}
              </div>
            </div>
            
            <div className="wiki-content">
              {isEditing ? (
                <textarea 
                  aria-label="Edit wiki markdown"
                  className="wiki-textarea" 
                  value={content} 
                  onChange={(e) => setContent(e.target.value)}
                />
              ) : (
                <div className="wiki-preview scrollable">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={48} className="empty-icon" />
            <p>Select or create a markdown file.</p>
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
