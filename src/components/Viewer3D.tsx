import { useState, useCallback } from 'react';
import Chat from './Chat';
import Scene3D from './Viewer3D/Scene3D';
import AnnotationOverlay from './Viewer3D/AnnotationOverlay';
import './Viewer3D.css';

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

  const handleAnnotationCreated = useCallback((id: string) => {
    setSelectedAnnotationId(id);
  }, []);

  return (
    <div className="viewer3d-container">
      <section className="viewer3d-stage glass-panel">
        <Scene3D
          selectedAnnotationId={selectedAnnotationId}
          onAnnotationCreated={handleAnnotationCreated}
        />
        <AnnotationOverlay
          selectedId={selectedAnnotationId}
          onSelect={setSelectedAnnotationId}
        />
      </section>

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
