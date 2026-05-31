import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { subscribeScene, type SceneObject } from '../../services/sceneStore';
import {
  addAnnotation,
  getAnnotations,
  subscribeAnnotations,
  subscribeGrid,
  type Annotation
} from '../../services/annotationStore';

function buildGeometry(obj: SceneObject): THREE.BufferGeometry {
  const s = obj.size;
  switch (obj.kind) {
    case 'sphere':   return new THREE.SphereGeometry(s * 0.5, 32, 24);
    case 'cylinder': return new THREE.CylinderGeometry(s * 0.5, s * 0.5, s, 32);
    case 'cone':     return new THREE.ConeGeometry(s * 0.5, s, 32);
    case 'plane':    return new THREE.PlaneGeometry(s, s);
    case 'torus':    return new THREE.TorusGeometry(s * 0.5, s * 0.15, 16, 48);
    case 'box':
    default:         return new THREE.BoxGeometry(s, s, s);
  }
}

function makeLabelSprite(text: string, accent = '#fbbf24'): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(15,23,42,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.6, 0.6, 1);
  sprite.renderOrder = 999;
  return sprite;
}

interface Scene3DProps {
  selectedAnnotationId?: string | null;
  onAnnotationCreated?: (id: string) => void;
}

export default function Scene3D({ selectedAnnotationId = null, onAnnotationCreated }: Scene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(selectedAnnotationId);
  const onCreatedRef = useRef(onAnnotationCreated);

  useEffect(() => { selectedIdRef.current = selectedAnnotationId; }, [selectedAnnotationId]);
  useEffect(() => { onCreatedRef.current = onAnnotationCreated; }, [onAnnotationCreated]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(4, 4, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 8, 5);
    scene.add(ambient, dir);

    let grid = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    const axes = new THREE.AxesHelper(2);
    scene.add(grid, axes);

    const meshGroup = new THREE.Group();
    const annotationGroup = new THREE.Group();
    scene.add(meshGroup, annotationGroup);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const target = new THREE.Vector3(0, 0, 0);
    let yaw = Math.atan2(camera.position.x, camera.position.z);
    let pitch = Math.asin(camera.position.y / camera.position.length());
    let radius = camera.position.length();
    let dragging = false;
    let dragMode: 'orbit' | 'pan' | 'none' = 'none';
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let downButton = 0;
    let downTime = 0;
    let movedDist = 0;

    const applyCamera = () => {
      const cp = Math.cos(pitch);
      camera.position.set(
        target.x + Math.sin(yaw) * cp * radius,
        target.y + Math.sin(pitch) * radius,
        target.z + Math.cos(yaw) * cp * radius
      );
      camera.lookAt(target);
    };
    applyCamera();

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const pickAnnotationPoint = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(meshGroup.children, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const ud = hit.object.userData as Record<string, unknown>;
        return {
          point: hit.point.clone(),
          targetObjectId: (ud.objectId as string) || null,
          targetKind: (ud.kind as string) || null
        };
      }
      const planeHit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, planeHit)) {
        return { point: planeHit, targetObjectId: null, targetKind: null };
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      // Left = orbit, right/middle = pan. Ignore other buttons.
      if (e.button === 0) dragMode = 'orbit';
      else if (e.button === 1 || e.button === 2) dragMode = 'pan';
      else return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      downX = e.clientX; downY = e.clientY; downTime = performance.now(); movedDist = 0;
      downButton = e.button;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      movedDist += Math.hypot(dx, dy);
      if (dragMode === 'pan') {
        // Translate target along camera's right/up axes; scale with view size.
        const rect = renderer.domElement.getBoundingClientRect();
        const worldPerPixel = (2 * radius * Math.tan((camera.fov * Math.PI / 180) / 2)) / Math.max(1, rect.height);
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
        target.addScaledVector(right, -dx * worldPerPixel);
        target.addScaledVector(up, dy * worldPerPixel);
      } else {
        yaw -= dx * 0.005;
        pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch + dy * 0.005));
      }
      applyCamera();
    };
    const onUp = (e: PointerEvent) => {
      const wasDragging = dragging;
      const mode = dragMode;
      dragging = false;
      dragMode = 'none';
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (!wasDragging) return;
      const elapsed = performance.now() - downTime;
      const totalDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (mode === 'orbit' && movedDist < 4 && totalDist < 4 && elapsed < 400 && downButton === 0) {
        const hit = pickAnnotationPoint(e.clientX, e.clientY);
        if (hit) {
          const ann = addAnnotation({
            position: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
            targetObjectId: hit.targetObjectId,
            targetKind: hit.targetKind
          });
          onCreatedRef.current?.(ann.id);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      radius = Math.max(1.5, Math.min(40, radius * (1 + e.deltaY * 0.001)));
      applyCamera();
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    const meshes = new Map<string, THREE.Mesh>();

    const syncScene = (objs: SceneObject[]) => {
      const seen = new Set<string>();
      for (const obj of objs) {
        seen.add(obj.id);
        let mesh = meshes.get(obj.id);
        if (!mesh) {
          const geom = buildGeometry(obj);
          const mat = new THREE.MeshStandardMaterial({ color: obj.color, roughness: 0.55, metalness: 0.1 });
          mesh = new THREE.Mesh(geom, mat);
          meshGroup.add(mesh);
          meshes.set(obj.id, mesh);
          const ud = mesh.userData as Record<string, unknown>;
          ud.kind = obj.kind;
          ud.size = obj.size;
          ud.objectId = obj.id;
        } else {
          const ud = mesh.userData as Record<string, unknown>;
          if (ud.kind !== obj.kind || ud.size !== obj.size) {
            mesh.geometry.dispose();
            mesh.geometry = buildGeometry(obj);
            ud.kind = obj.kind;
            ud.size = obj.size;
          }
          ud.objectId = obj.id;
          (mesh.material as THREE.MeshStandardMaterial).color.set(obj.color);
        }
        mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
        mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        mesh.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
      }
      for (const [id, mesh] of meshes) {
        if (seen.has(id)) continue;
        meshGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        meshes.delete(id);
      }
    };

    const unsubscribe = subscribeScene(syncScene);

    interface MarkerEntry {
      group: THREE.Group;
      sphere: THREE.Mesh;
      label: THREE.Sprite;
      indexShown: number;
    }
    const markers = new Map<string, MarkerEntry>();

    const buildMarker = (ann: Annotation): MarkerEntry => {
      const group = new THREE.Group();
      group.position.set(ann.position.x, ann.position.y, ann.position.z);
      const sphereGeom = new THREE.SphereGeometry(0.12, 16, 12);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, depthTest: false });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.renderOrder = 998;
      const label = makeLabelSprite(String(ann.index));
      label.position.set(0, 0.35, 0);
      group.add(sphere, label);
      annotationGroup.add(group);
      return { group, sphere, label, indexShown: ann.index };
    };

    const styleMarker = (entry: MarkerEntry, selected: boolean) => {
      const mat = entry.sphere.material as THREE.MeshBasicMaterial;
      mat.color.set(selected ? 0x38bdf8 : 0xfbbf24);
      entry.sphere.scale.setScalar(selected ? 1.8 : 1);
    };

    const syncAnnotations = (list: Annotation[]) => {
      const seen = new Set<string>();
      const selected = selectedIdRef.current;
      for (const ann of list) {
        seen.add(ann.id);
        let entry = markers.get(ann.id);
        if (!entry) {
          entry = buildMarker(ann);
          markers.set(ann.id, entry);
        } else {
          entry.group.position.set(ann.position.x, ann.position.y, ann.position.z);
          if (entry.indexShown !== ann.index) {
            entry.group.remove(entry.label);
            (entry.label.material as THREE.SpriteMaterial).map?.dispose();
            (entry.label.material as THREE.SpriteMaterial).dispose();
            const next = makeLabelSprite(String(ann.index));
            next.position.set(0, 0.35, 0);
            entry.group.add(next);
            entry.label = next;
            entry.indexShown = ann.index;
          }
        }
        styleMarker(entry, ann.id === selected);
      }
      for (const [id, entry] of markers) {
        if (seen.has(id)) continue;
        annotationGroup.remove(entry.group);
        entry.sphere.geometry.dispose();
        (entry.sphere.material as THREE.Material).dispose();
        (entry.label.material as THREE.SpriteMaterial).map?.dispose();
        (entry.label.material as THREE.SpriteMaterial).dispose();
        markers.delete(id);
      }
    };

    const unsubscribeAnn = subscribeAnnotations(syncAnnotations);

    let lastSelected: string | null = selectedIdRef.current;

    const unsubscribeGrid = subscribeGrid((cfg) => {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      const divisions = Math.max(2, Math.min(200, Math.round(cfg.size)));
      grid = new THREE.GridHelper(cfg.size, divisions, 0x334155, 0x1e293b);
      scene.add(grid);
    });

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const loop = () => {
      if (selectedIdRef.current !== lastSelected) {
        lastSelected = selectedIdRef.current;
        syncAnnotations(getAnnotations());
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubscribe();
      unsubscribeAnn();
      unsubscribeGrid();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      for (const entry of markers.values()) {
        entry.sphere.geometry.dispose();
        (entry.sphere.material as THREE.Material).dispose();
        (entry.label.material as THREE.SpriteMaterial).map?.dispose();
        (entry.label.material as THREE.SpriteMaterial).dispose();
      }
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="viewer3d-canvas" />;
}
