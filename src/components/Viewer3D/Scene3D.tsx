import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { subscribeScene, type SceneObject } from '../../services/sceneStore';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  addAnnotation,
  getAnnotations,
  subscribeAnnotations,
  subscribeGrid,
  setGrid,
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

function makeAxisLabel(text: string, color: string): THREE.Sprite {
  const W = 80; const H = 80;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.45, 0.45, 1);
  sprite.renderOrder = 998;
  return sprite;
}

function makeEdgeLabel(text: string): THREE.Sprite {
  const ctx2 = document.createElement('canvas').getContext('2d')!;
  ctx2.font = 'bold 22px system-ui, sans-serif';
  const measured = ctx2.measureText(text).width;
  const W = Math.ceil(measured) + 24;
  const H = 36;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(15,23,42,0.72)';
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(W - r, 0);
  ctx.quadraticCurveTo(W, 0, W, r);
  ctx.lineTo(W, H - r);
  ctx.quadraticCurveTo(W, H, W - r, H);
  ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(99,115,148,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = W / H;
  sprite.scale.set(aspect * 0.55, 0.55, 1);
  sprite.renderOrder = 996;
  return sprite;
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
    camera.up.set(0, 0, 1);
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
    grid.rotation.x = Math.PI / 2;
    // AxesHelper draws RGB lines; sprites add readable letter labels at each tip
    const axesHelper = new THREE.AxesHelper(2);
    const axisLabelX = makeAxisLabel('X', '#ef4444');
    axisLabelX.position.set(2.45, 0, 0.05);
    const axisLabelY = makeAxisLabel('Y', '#22c55e');
    axisLabelY.position.set(0, 2.45, 0.05);
    const axisLabelZ = makeAxisLabel('Z', '#3b82f6');
    axisLabelZ.position.set(0, 0, 2.45);
    scene.add(grid, axesHelper, axisLabelX, axisLabelY, axisLabelZ);

    const meshGroup = new THREE.Group();
    const annotationGroup = new THREE.Group();
    scene.add(meshGroup, annotationGroup);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    const target = new THREE.Vector3(0, 0, 0);
    let yaw = Math.atan2(camera.position.x, camera.position.y);
    let pitch = Math.asin(camera.position.z / camera.position.length());
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
        target.y + Math.cos(yaw) * cp * radius,
        target.z + Math.sin(pitch) * radius
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
      const hits = raycaster.intersectObjects(meshGroup.children, true);
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

    const sceneNodes = new Map<string, THREE.Object3D>();
    const modelLoadEpoch = new Map<string, number>();
    const stlLoader = new STLLoader();
    const objLoader = new OBJLoader();
    const gltfLoader = new GLTFLoader();

    const decodeBase64ToBytes = (base64: string): Uint8Array => {
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i);
      }
      return bytes;
    };

    const setTransform = (obj: SceneObject, node: THREE.Object3D) => {
      node.position.set(obj.position.x, obj.position.y, obj.position.z);
      node.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
      node.scale.set(obj.scale.x, obj.scale.y, obj.scale.z);
    };

    const disposeNode = (node: THREE.Object3D) => {
      node.traverse((child) => {
        const maybeMesh = child as THREE.Mesh;
        if (maybeMesh.geometry) {
          maybeMesh.geometry.dispose();
        }
        if (maybeMesh.material) {
          const mat = maybeMesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
    };

    // Normalize a freshly loaded model so its bounding sphere fits targetRadius.
    // Must be called before the object is parented to a container so the BB
    // is computed in local (identity) space.
    const normalizeModel = (obj: THREE.Object3D, targetRadius = 1.0): void => {
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (sphere.radius < 1e-6) return;
      const s = targetRadius / sphere.radius;
      // Apply scale first so the position offset uses scaled coords
      obj.scale.multiplyScalar(s);
      obj.position.sub(center.multiplyScalar(s));
    };

    // Re-frame the camera so the entire meshGroup is comfortably visible.
    // Also auto-resizes the grid to span the scene.
    const fitCameraToMeshGroup = (): void => {
      const box = new THREE.Box3().setFromObject(meshGroup);
      if (box.isEmpty()) return;
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (sphere.radius < 0.01) return;
      target.copy(sphere.center);
      radius = Math.max(sphere.radius * 3, 1.5);
      applyCamera();
      // Expand the grid so it comfortably contains the scene
      const desiredGrid = Math.ceil(sphere.radius * 6);
      if (desiredGrid > 4) setGrid({ size: Math.max(desiredGrid, 10) });
    };

    const parseModelObject = async (obj: SceneObject): Promise<THREE.Object3D> => {
      const payload = obj.payloadBase64 || '';
      const format = obj.modelFormat || 'obj';
      const bytes = decodeBase64ToBytes(payload);

      if (format === 'stl') {
        const geometry = stlLoader.parse(bytes.buffer);
        const material = new THREE.MeshStandardMaterial({ color: obj.color || '#94a3b8', roughness: 0.6, metalness: 0.08 });
        return new THREE.Mesh(geometry, material);
      }

      if (format === 'obj') {
        const text = new TextDecoder().decode(bytes);
        const group = objLoader.parse(text);
        group.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = new THREE.MeshStandardMaterial({ color: obj.color || '#94a3b8', roughness: 0.6, metalness: 0.08 });
        });
        return group;
      }

      return await new Promise<THREE.Object3D>((resolve, reject) => {
        gltfLoader.parse(bytes.buffer, '', (gltf) => resolve(gltf.scene), (err) => reject(err));
      });
    };

    const createModelPlaceholder = () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x64748b, wireframe: true })
      );
      return mesh;
    };

    const syncScene = (objs: SceneObject[]) => {
      const seen = new Set<string>();
      for (const obj of objs) {
        seen.add(obj.id);
        const existing = sceneNodes.get(obj.id);

        if (obj.kind === 'model') {
          const container = existing || new THREE.Group();
          if (!existing) {
            const placeholder = createModelPlaceholder();
            container.add(placeholder);
            const ud = container.userData as Record<string, unknown>;
            ud.objectId = obj.id;
            ud.kind = obj.kind;
            meshGroup.add(container);
            sceneNodes.set(obj.id, container);

            const nextEpoch = (modelLoadEpoch.get(obj.id) || 0) + 1;
            modelLoadEpoch.set(obj.id, nextEpoch);

            parseModelObject(obj)
              .then((loaded) => {
                if (modelLoadEpoch.get(obj.id) !== nextEpoch) {
                  disposeNode(loaded);
                  return;
                }
                while (container.children.length > 0) {
                  const child = container.children[0];
                  container.remove(child);
                  disposeNode(child);
                }
                normalizeModel(loaded);
                loaded.traverse((child) => {
                  const ud = child.userData as Record<string, unknown>;
                  ud.objectId = obj.id;
                  ud.kind = obj.kind;
                });
                container.add(loaded);
                fitCameraToMeshGroup();
              })
              .catch(() => {
                // Keep placeholder on loader errors; tool layer returns failures to model.
              });
          }

          const ud = container.userData as Record<string, unknown>;
          ud.objectId = obj.id;
          ud.kind = obj.kind;
          setTransform(obj, container);
          continue;
        }

        let primitive = existing as THREE.Mesh | undefined;
        if (!primitive) {
          const geom = buildGeometry(obj);
          const mat = new THREE.MeshStandardMaterial({ color: obj.color, roughness: 0.55, metalness: 0.1 });
          primitive = new THREE.Mesh(geom, mat);
          meshGroup.add(primitive);
          sceneNodes.set(obj.id, primitive);
        } else {
          const ud = primitive.userData as Record<string, unknown>;
          if (ud.kind !== obj.kind || ud.size !== obj.size) {
            primitive.geometry.dispose();
            primitive.geometry = buildGeometry(obj);
          }
          (primitive.material as THREE.MeshStandardMaterial).color.set(obj.color);
        }

        const ud = primitive.userData as Record<string, unknown>;
        ud.kind = obj.kind;
        ud.size = obj.size;
        ud.objectId = obj.id;
        setTransform(obj, primitive);
      }

      for (const [id, node] of sceneNodes) {
        if (seen.has(id)) continue;
        meshGroup.remove(node);
        disposeNode(node);
        sceneNodes.delete(id);
        modelLoadEpoch.delete(id);
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

    let gridEdgeLabels: THREE.Sprite[] = [];
    const disposeGridEdgeLabels = () => {
      for (const s of gridEdgeLabels) {
        scene.remove(s);
        (s.material as THREE.SpriteMaterial).map?.dispose();
        (s.material as THREE.SpriteMaterial).dispose();
      }
      gridEdgeLabels = [];
    };

    const unsubscribeGrid = subscribeGrid((cfg) => {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      const divisions = Math.max(2, Math.min(200, Math.round(cfg.size)));
      grid = new THREE.GridHelper(cfg.size, divisions, 0x334155, 0x1e293b);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);

      disposeGridEdgeLabels();
      const half = cfg.size / 2;
      const labelText = `${cfg.size} ${cfg.unit}`;
      const lx = makeEdgeLabel(labelText);
      lx.position.set(half + 0.9, 0, 0.12);
      const ly = makeEdgeLabel(labelText);
      ly.position.set(0, half + 0.9, 0.12);
      scene.add(lx, ly);
      gridEdgeLabels = [lx, ly];
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
      for (const node of sceneNodes.values()) {
        disposeNode(node);
      }
      for (const entry of markers.values()) {
        entry.sphere.geometry.dispose();
        (entry.sphere.material as THREE.Material).dispose();
        (entry.label.material as THREE.SpriteMaterial).map?.dispose();
        (entry.label.material as THREE.SpriteMaterial).dispose();
      }
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      disposeGridEdgeLabels();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="viewer3d-canvas" />;
}
