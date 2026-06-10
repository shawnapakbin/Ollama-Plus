import { lazy, Suspense, useState, useCallback, useRef, useEffect } from 'react';
import Chat from './Chat/Chat';
import AnnotationOverlay from './Viewer3D/AnnotationOverlay';
import './Viewer3D.css';

const Scene3D = lazy(() => import('./Viewer3D/Scene3D'));

const CHAT_WIDTH_KEY = 'viewer3dChatWidth';
const DEFAULT_CHAT_WIDTH = 380;
const MIN_CHAT_WIDTH = 300;

function loadChatWidth(): number {
  const raw = localStorage.getItem(CHAT_WIDTH_KEY);
  if (!raw) return DEFAULT_CHAT_WIDTH;
  const value = Number(raw);
  return Number.isFinite(value) && value >= MIN_CHAT_WIDTH ? value : DEFAULT_CHAT_WIDTH;
}

interface Viewer3DProps {
  selectedModel: string;
  hostUrl: string;
  keepAlive: boolean;
  sessionId: string | null;
  sessionTitle?: string;
  onSessionUpdate: () => void;
}

export default function Viewer3D({
  selectedModel,
  hostUrl,
  keepAlive,
  sessionId,
  sessionTitle,
  onSessionUpdate
}: Viewer3DProps) {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState<number>(() => loadChatWidth());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  const widthRef = useRef(chatWidth);

  const handleAnnotationCreated = useCallback((id: string) => {
    setSelectedAnnotationId(id);
  }, []);

  const clampWidth = useCallback((next: number) => {
    const container = containerRef.current;
    if (!container) return Math.max(MIN_CHAT_WIDTH, next);
    const max = Math.max(MIN_CHAT_WIDTH, Math.floor(container.clientWidth * 0.65));
    return Math.max(MIN_CHAT_WIDTH, Math.min(next, max));
  }, []);

  const handleResizeMove = useCallback((event: MouseEvent) => {
    if (!resizingRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const next = bounds.right - event.clientX;
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setChatWidth(clamped);
  }, [clampWidth]);

  const handleResizeUp = useCallback(() => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    localStorage.setItem(CHAT_WIDTH_KEY, String(widthRef.current));
    document.body.classList.remove('viewer3d-resizing');
    window.removeEventListener('mousemove', handleResizeMove);
  }, [handleResizeMove]);

  const handleResizeDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 1280px)').matches) return;
    event.preventDefault();
    resizingRef.current = true;
    document.body.classList.add('viewer3d-resizing');
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeUp, { once: true });
  }, [handleResizeMove, handleResizeUp]);

  useEffect(() => {
    widthRef.current = chatWidth;
    if (!containerRef.current) return;
    containerRef.current.style.setProperty('--viewer3d-chat-width', `${chatWidth}px`);
  }, [chatWidth]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeUp);
      document.body.classList.remove('viewer3d-resizing');
    };
  }, [handleResizeMove, handleResizeUp]);

  return (
    <div ref={containerRef} className="viewer3d-container">
      <section className="viewer3d-stage glass-panel">
        <Suspense fallback={<div className="viewer3d-loading">Loading 3D scene…</div>}>
          <Scene3D
            selectedAnnotationId={selectedAnnotationId}
            onAnnotationCreated={handleAnnotationCreated}
          />
        </Suspense>
        <AnnotationOverlay
          selectedId={selectedAnnotationId}
          onSelect={setSelectedAnnotationId}
        />
      </section>

      <div
        className="viewer3d-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onMouseDown={handleResizeDown}
      />

      <aside className="viewer3d-chat glass-panel">
        <Chat
          selectedModel={selectedModel}
          hostUrl={hostUrl}
          keepAlive={keepAlive}
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          onSessionUpdate={onSessionUpdate}
        />
      </aside>
    </div>
  );
}
