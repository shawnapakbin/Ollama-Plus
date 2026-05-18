import React from 'react';
import { Box, Move3D, RotateCcw, Ruler } from 'lucide-react';
import './Viewer3D.css';

export default function Viewer3D() {
  return (
    <div className="viewer3d-container">
      <aside className="viewer3d-sidebar glass-panel">
        <h3>3D Workspace</h3>
        <div className="viewer3d-tools">
          <button><Move3D size={14} /> Transform</button>
          <button><RotateCcw size={14} /> Recenter</button>
          <button><Ruler size={14} /> Measure</button>
        </div>
        <p className="viewer3d-note">
          Hybrid mode baseline is enabled: this viewport is reserved for real-time interaction while OpenSCAD-backed modifiers will be connected in the next implementation steps.
        </p>
      </aside>

      <section className="viewer3d-stage glass-panel">
        <div className="viewer3d-placeholder" role="img" aria-label="3D preview placeholder">
          <Box size={56} />
          <h4>Interactive 3D Preview</h4>
          <p>STL/OBJ/3MF import and transform controls will mount here in the next increment.</p>
        </div>
      </section>
    </div>
  );
}
