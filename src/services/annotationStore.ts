/**
 * Annotation + stage-grid store for the 3D Workspace.
 *
 * Annotations are user-placed notes anchored to a world-space point, optionally
 * attached to a scene object. They drive both the in-viewport markers (rendered
 * by Scene3D) and the overlay glass panel (AnnotationOverlay). The store also
 * holds the current grid size and measurement unit so the viewport and overlay
 * stay in sync.
 */

import type { Vec3 } from './sceneStore';

export type MeasurementUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface Annotation {
  id: string;
  index: number;
  position: Vec3;
  targetObjectId: string | null;
  targetKind: string | null;
  note: string;
  createdAt: number;
}

export interface GridConfig {
  size: number;
  unit: MeasurementUnit;
}

type AnnotationListener = (list: Annotation[]) => void;
type GridListener = (cfg: GridConfig) => void;

let annotations: Annotation[] = [];
let counter = 0;
const annotationListeners = new Set<AnnotationListener>();

let grid: GridConfig = { size: 20, unit: 'm' };
const gridListeners = new Set<GridListener>();

function emitAnnotations() {
  const snap = annotations.slice();
  for (const fn of annotationListeners) fn(snap);
}

function emitGrid() {
  const snap = { ...grid };
  for (const fn of gridListeners) fn(snap);
}

function reindex() {
  annotations = annotations.map((a, i) => ({ ...a, index: i + 1 }));
}

export function subscribeAnnotations(fn: AnnotationListener): () => void {
  annotationListeners.add(fn);
  fn(annotations.slice());
  return () => { annotationListeners.delete(fn); };
}

export function getAnnotations(): Annotation[] {
  return annotations.slice();
}

export function addAnnotation(input: {
  position: Vec3;
  targetObjectId?: string | null;
  targetKind?: string | null;
  note?: string;
}): Annotation {
  counter += 1;
  const ann: Annotation = {
    id: `ann-${counter}`,
    index: annotations.length + 1,
    position: { ...input.position },
    targetObjectId: input.targetObjectId ?? null,
    targetKind: input.targetKind ?? null,
    note: input.note ?? '',
    createdAt: Date.now()
  };
  annotations = [...annotations, ann];
  emitAnnotations();
  return ann;
}

export function updateAnnotation(id: string, patch: { note?: string }): Annotation | null {
  const idx = annotations.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const next = { ...annotations[idx], ...(patch.note !== undefined ? { note: patch.note } : {}) };
  annotations = annotations.slice();
  annotations[idx] = next;
  emitAnnotations();
  return next;
}

export function removeAnnotation(id: string): boolean {
  const next = annotations.filter((a) => a.id !== id);
  if (next.length === annotations.length) return false;
  annotations = next;
  reindex();
  emitAnnotations();
  return true;
}

export function clearAnnotations(): number {
  const n = annotations.length;
  annotations = [];
  emitAnnotations();
  return n;
}

export function subscribeGrid(fn: GridListener): () => void {
  gridListeners.add(fn);
  fn({ ...grid });
  return () => { gridListeners.delete(fn); };
}

export function getGrid(): GridConfig {
  return { ...grid };
}

export function setGrid(patch: Partial<GridConfig>): GridConfig {
  const size = typeof patch.size === 'number' && patch.size > 0 ? patch.size : grid.size;
  const unit = patch.unit ?? grid.unit;
  grid = { size, unit };
  emitGrid();
  return { ...grid };
}
