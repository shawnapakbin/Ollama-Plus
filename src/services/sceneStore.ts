/**
 * Shared 3D scene state used by Viewer3D and the `scene_3d` LLM tool.
 *
 * Keeps a flat list of primitive objects with simple transforms and colors.
 * Subscribers (the three.js viewport) re-render whenever the store changes.
 */

export type PrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';

export interface Vec3 { x: number; y: number; z: number }

export interface SceneObject {
  id: string;
  name: string;
  kind: PrimitiveKind;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  size: number;
}

type Listener = (objects: SceneObject[]) => void;

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

let objects: SceneObject[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit() {
  const snapshot = objects.slice();
  for (const fn of listeners) fn(snapshot);
}

function nextId(kind: PrimitiveKind): string {
  counter += 1;
  return `${kind}-${counter}`;
}

function clampVec(input: unknown, fallback: Vec3): Vec3 {
  if (!input || typeof input !== 'object') return { ...fallback };
  const src = input as Record<string, unknown>;
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  return { x: num(src.x, fallback.x), y: num(src.y, fallback.y), z: num(src.z, fallback.z) };
}

export function subscribeScene(fn: Listener): () => void {
  listeners.add(fn);
  fn(objects.slice());
  return () => { listeners.delete(fn); };
}

export function getSceneObjects(): SceneObject[] {
  return objects.slice();
}

export function addPrimitive(input: {
  kind: PrimitiveKind;
  name?: string;
  position?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
  scale?: Partial<Vec3>;
  color?: string;
  size?: number;
}): SceneObject {
  const obj: SceneObject = {
    id: nextId(input.kind),
    name: (input.name || input.kind).toString(),
    kind: input.kind,
    position: clampVec(input.position, ZERO),
    rotation: clampVec(input.rotation, ZERO),
    scale: clampVec(input.scale, ONE),
    color: input.color || '#38bdf8',
    size: typeof input.size === 'number' && input.size > 0 ? input.size : 1
  };
  objects = [...objects, obj];
  emit();
  return obj;
}

export function transformObject(id: string, patch: {
  position?: Partial<Vec3>;
  rotation?: Partial<Vec3>;
  scale?: Partial<Vec3>;
  color?: string;
  name?: string;
  size?: number;
}): SceneObject | null {
  const idx = objects.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  const cur = objects[idx];
  const merged: SceneObject = {
    ...cur,
    position: clampVec({ ...cur.position, ...patch.position }, cur.position),
    rotation: clampVec({ ...cur.rotation, ...patch.rotation }, cur.rotation),
    scale: clampVec({ ...cur.scale, ...patch.scale }, cur.scale),
    color: patch.color || cur.color,
    name: patch.name || cur.name,
    size: typeof patch.size === 'number' && patch.size > 0 ? patch.size : cur.size
  };
  objects = objects.slice();
  objects[idx] = merged;
  emit();
  return merged;
}

export function removeObject(id: string): boolean {
  const next = objects.filter((o) => o.id !== id);
  if (next.length === objects.length) return false;
  objects = next;
  emit();
  return true;
}

export function clearScene(): number {
  const n = objects.length;
  objects = [];
  emit();
  return n;
}
