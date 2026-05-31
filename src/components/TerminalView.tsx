import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import { Plus, Terminal as TermIcon, Code } from 'lucide-react';
import { ipcService } from '../services/ipcService';
import './TerminalView.css';

export default function TerminalView() {
  const terminalRef = useRef(null);
  const [terminals, setTerminals] = useState([]);
  const [activeTermId, setActiveTermId] = useState(null);
  const xtermInstance = useRef(null);

  const spawnNewTerminal = async (type) => {
    const id = await ipcService.spawnTerminal(type);
    const newTerm = { id, type, label: `${type} - ${id.substring(0,4)}` };
    setTerminals(prev => [...prev, newTerm]);
    setActiveTermId(id);
  };

  useEffect(() => {
    if (!terminalRef.current || !activeTermId) return;

    if (xtermInstance.current) {
      xtermInstance.current.dispose();
      xtermInstance.current = null;
    }

    const term = new Terminal({
      theme: {
        background: '#0b0c10',
        foreground: '#e2e8f0',
        cursor: '#38bdf8'
      },
      fontFamily: 'Consolas, monospace',
      fontSize: 14,
    });

    term.open(terminalRef.current);
    xtermInstance.current = term;

    const termId = activeTermId;
    const onDataDisposable = term.onData(data => {
      ipcService.terminalInput(termId, data);
    });

    const removeListener = ipcService.onTerminalOutput((id, data) => {
      if (id === termId && xtermInstance.current === term) {
        term.write(data);
      }
    });

    return () => {
      removeListener();
      onDataDisposable.dispose();
      term.dispose();
      if (xtermInstance.current === term) {
        xtermInstance.current = null;
      }
    };
  }, [activeTermId]);

  return (
    <div className="terminal-container">
      <div className="terminal-sidebar glass-panel">
        <div className="term-sidebar-header">
          <h3>Terminals</h3>
        </div>
        <div className="term-list">
          {terminals.map(t => (
            <button 
              key={t.id} 
              className={`term-tab ${t.id === activeTermId ? 'active' : ''}`}
              onClick={() => setActiveTermId(t.id)}
            >
              {t.type === 'shell' ? <TermIcon size={14}/> : <Code size={14}/>}
              {t.label}
            </button>
          ))}
          {terminals.length === 0 && <p className="no-terms">No active terminals</p>}
        </div>
        <div className="term-actions">
          <button onClick={() => spawnNewTerminal('shell')} className="primary">
            <Plus size={14} /> Shell
          </button>
          <button onClick={() => spawnNewTerminal('python')}>
            <Plus size={14} /> Python
          </button>
        </div>
      </div>
      <div className="terminal-main glass-panel">
        {activeTermId ? (
          <div ref={terminalRef} className="xterm-wrapper" />
        ) : (
          <div className="empty-state">
            <TermIcon size={48} className="empty-icon" />
            <p>Select or create a terminal to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
