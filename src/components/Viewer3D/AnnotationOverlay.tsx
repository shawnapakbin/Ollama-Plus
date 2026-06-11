import { useEffect, useState, useCallback } from 'react';
import { Send, Pencil, Trash2, Eraser, Check, X } from 'lucide-react';
import {
  type Annotation,
  type GridConfig,
  type MeasurementUnit,
  clearAnnotations,
  getGrid,
  removeAnnotation,
  setGrid,
  subscribeAnnotations,
  subscribeGrid,
  updateAnnotation
} from '../../services/annotationStore';
import './AnnotationOverlay.css';

interface AnnotationOverlayProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const UNITS: MeasurementUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

function formatPos(p: { x: number; y: number; z: number }): string {
  const f = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));
  return `(${f(p.x)}, ${f(p.y)}, ${f(p.z)})`;
}

function buildPromptText(list: Annotation[], unit: MeasurementUnit, gridSize: number): string {
  if (list.length === 0) return '';
  const header =
    `I've placed ${list.length} annotation${list.length === 1 ? '' : 's'} on the 3D stage to guide you.` +
    ` Stage grid is ${gridSize} ${unit} across; coordinates below are in scene units (treated as ${unit}).`;
  const lines = list.map((a) => {
    const target = a.targetObjectId ? ` on ${a.targetKind || 'object'} "${a.targetObjectId}"` : ' on the stage';
    const note = a.note.trim() ? ` — ${a.note.trim()}` : ' — (no note)';
    return `${a.index}. at ${formatPos(a.position)}${target}${note}`;
  });
  const footer =
    `Use the scene_3d tool to act on these annotations: add, transform, recolor, or remove primitives so the result matches the user's intent at each marker. Confirm what you changed.`;
  return `${header}\n\n${lines.join('\n')}\n\n${footer}`;
}

export default function AnnotationOverlay({ selectedId, onSelect }: AnnotationOverlayProps) {
  const [list, setList] = useState<Annotation[]>([]);
  const [grid, setGridState] = useState<GridConfig>(() => getGrid());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => subscribeAnnotations(setList), []);
  useEffect(() => subscribeGrid(setGridState), []);

  const beginEdit = useCallback((ann: Annotation) => {
    onSelect(ann.id);
    setEditingId(ann.id);
    setDraft(ann.note);
  }, [onSelect]);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    updateAnnotation(editingId, { note: draft });
    setEditingId(null);
    setDraft('');
  }, [editingId, draft]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft('');
  }, []);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    if (editingId === selectedId) cancelEdit();
    removeAnnotation(selectedId);
    onSelect(null);
  }, [selectedId, editingId, cancelEdit, onSelect]);

  const handleClearAll = useCallback(() => {
    if (list.length === 0) return;
    if (!window.confirm(`Delete all ${list.length} annotation(s)?`)) return;
    clearAnnotations();
    onSelect(null);
    cancelEdit();
  }, [list.length, onSelect, cancelEdit]);

  const handleSend = useCallback(() => {
    const text = buildPromptText(list, grid.unit, grid.size);
    if (!text) return;
    window.dispatchEvent(new CustomEvent('ollama-plus:inject-prompt', { detail: { text } }));
  }, [list, grid]);

  const handleGridSize = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) setGrid({ size: n });
  };

  const handleUnit = (u: string) => {
    if ((UNITS as string[]).includes(u)) setGrid({ unit: u as MeasurementUnit });
  };

  const selected = list.find((a) => a.id === selectedId) || null;

  return (
    <div className="annotation-overlay">
      <div className="annotation-overlay__row">
        <span className="annotation-overlay__title">
          Annotations
          <span className="annotation-overlay__count">({list.length})</span>
        </span>
        <button
          type="button"
          className="annotation-overlay__btn annotation-overlay__btn--primary"
          onClick={handleSend}
          disabled={list.length === 0}
          title="Send annotations to the assistant"
        >
          <Send size={14} /> Send
        </button>
        <button
          type="button"
          className="annotation-overlay__btn"
          onClick={() => selected && beginEdit(selected)}
          disabled={!selected}
          title="Edit selected annotation"
        >
          <Pencil size={14} /> Edit
        </button>
        <button
          type="button"
          className="annotation-overlay__btn annotation-overlay__btn--danger"
          onClick={handleDelete}
          disabled={!selected}
          title="Delete selected annotation"
        >
          <Trash2 size={14} /> Delete
        </button>
        <button
          type="button"
          className="annotation-overlay__btn annotation-overlay__btn--danger"
          onClick={handleClearAll}
          disabled={list.length === 0}
          title="Remove every annotation"
        >
          <Eraser size={14} /> Clear All
        </button>
      </div>

      <div className="annotation-overlay__row annotation-overlay__grid">
        <label>
          Grid size
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={grid.size}
            onChange={(e) => handleGridSize(e.target.value)}
          />
        </label>
        <label>
          Unit
          <select value={grid.unit} onChange={(e) => handleUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <span className="annotation-overlay__hint">Click the stage or any object to drop a marker.</span>
      </div>

      <div className="annotation-overlay__list scrollable">
        {list.length === 0 && (
          <div className="annotation-overlay__empty">
            No annotations yet. Click anywhere in the viewport to add one.
          </div>
        )}
        {list.map((a) => {
          const isSelected = a.id === selectedId;
          const isEditing = a.id === editingId;
          return (
            <div
              key={a.id}
              className={`annotation-item${isSelected ? ' annotation-item--selected' : ''}`}
              onClick={() => onSelect(a.id)}
            >
              <div className="annotation-item__index">{a.index}</div>
              <div className="annotation-item__body">
                <div className="annotation-item__meta">
                  {formatPos(a.position)} {grid.unit}
                  {a.targetObjectId ? ` · ${a.targetKind || 'object'} ${a.targetObjectId}` : ' · stage'}
                </div>
                {isEditing ? (
                  <>
                    <textarea
                      className="annotation-item__edit"
                      autoFocus
                      value={draft}
                      spellCheck={true}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Describe what should happen here..."
                    />
                    <div className="annotation-item__edit-row">
                      <button
                        type="button"
                        className="annotation-overlay__btn annotation-overlay__btn--primary"
                        onClick={(e) => { e.stopPropagation(); commitEdit(); }}
                      >
                        <Check size={14} /> Save
                      </button>
                      <button
                        type="button"
                        className="annotation-overlay__btn"
                        onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                      >
                        <X size={14} /> Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    className="annotation-item__note"
                    onDoubleClick={(e) => { e.stopPropagation(); beginEdit(a); }}
                  >
                    {a.note.trim() || <em className="annotation-item__placeholder">Double-click to add a note…</em>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
