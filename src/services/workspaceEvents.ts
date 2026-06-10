const OPEN_VIEWER3D_EVENT = 'workspace:open-viewer3d';

/**
 * Request that the app focuses the 3D Workspace panel.
 */
export function requestOpenViewer3D() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_VIEWER3D_EVENT));
}

/**
 * Subscribe to 3D Workspace focus requests.
 */
export function onOpenViewer3D(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(OPEN_VIEWER3D_EVENT, listener);
  return () => window.removeEventListener(OPEN_VIEWER3D_EVENT, listener);
}
