import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line, Transformer, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { useStore, useActiveRoom } from '../store/store';
import { objectsMatchingSearch } from '../lib/selectors';
import { computeVisibleBounds } from '../lib/bounds';
import ObjectNode from './ObjectNode';
import WallLayer from './WallLayer';
import Minimap from './Minimap';
import StatusBar from './StatusBar';

export const PX_PER_IN = 6; // world scale before stage zoom
const GRID_IN = 6; // grid + snap step, inches
const MIN_SCALE = 0.08;
const MAX_SCALE = 6;
const CAMERA_COMMIT_DEBOUNCE = 300;

interface Camera {
  x: number;
  y: number;
  scale: number;
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function useHtmlImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = src;
    return () => setImg(null);
  }, [src]);
  return img;
}

export default function RoomCanvas() {
  const { w, h } = useWindowSize();
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodeMap = useRef<Map<string, Konva.Group>>(new Map());
  const room = useActiveRoom();
  const [cam, setCam] = useState<Camera>(room.camera);
  const lastRoomId = useRef(room.id);
  const camCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wallCursor, setWallCursor] = useState<{ x: number; y: number } | null>(null);
  const wallGestureStart = useRef<{ x: number; y: number } | null>(null);
  const lastWallCommit = useRef<{ point: { x: number; y: number }; time: number } | null>(null);
  const fitAnimRef = useRef<number | null>(null);
  const [liveCursor, setLiveCursor] = useState<{ x: number; y: number } | null>(null);
  const lastCursorUpdate = useRef(0);

  const tags = useStore((s) => s.tags);
  const selection = useStore((s) => s.selection);
  const settings = useStore((s) => s.settings);
  const search = useStore((s) => s.search);
  const wallTool = useStore((s) => s.wallTool);
  const wallSelection = useStore((s) => s.wallSelection);
  const fitToViewToken = useStore((s) => s.fitToViewToken);

  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const updateObject = useStore((s) => s.updateObject);
  const open = useStore((s) => s.open);
  const openPicker = useStore((s) => s.openPicker);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setRoomCamera = useStore((s) => s.setRoomCamera);
  const commitWallPoint = useStore((s) => s.commitWallPoint);
  const cancelWallDraft = useStore((s) => s.cancelWallDraft);
  const selectWallEntity = useStore((s) => s.selectWallEntity);

  const objects = room.objects;
  const items = room.items;
  const layers = room.layers;
  const mode = settings.mode;
  const activeLayer = layers.find((l) => l.id === room.activeLayerId);
  const isWallMode = mode === 'design' && activeLayer?.kind === 'wall';
  const wallLayer = layers.find((l) => l.kind === 'wall');
  const blueprintImg = useHtmlImage(room.blueprint?.image);

  // Restore camera + clear live drawing state whenever the active room changes.
  useEffect(() => {
    if (lastRoomId.current !== room.id) {
      lastRoomId.current = room.id;
      setCam(room.camera);
      setWallCursor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const commitCameraDebounced = useCallback(
    (next: Camera) => {
      if (camCommitTimer.current) clearTimeout(camCommitTimer.current);
      camCommitTimer.current = setTimeout(() => setRoomCamera(room.id, next), CAMERA_COMMIT_DEBOUNCE);
    },
    [room.id, setRoomCamera],
  );

  const visibleLayerIds = useMemo(() => new Set(layers.filter((l) => l.visible).map((l) => l.id)), [layers]);

  const searchHits = useMemo(() => objectsMatchingSearch(items, search, tags), [items, search, tags]);

  // Per-object per-cell item counts.
  const counts = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const it of Object.values(items)) {
      (map[it.objectId] ??= {})[it.cellKey] = (map[it.objectId]?.[it.cellKey] ?? 0) + 1;
    }
    return map;
  }, [items]);

  const effectiveScale = PX_PER_IN * cam.scale;
  const showDetail = effectiveScale > 3.2;

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodeMap.current.set(id, node);
    else nodeMap.current.delete(id);
  }, []);

  // Attach transformer to a single selected object.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selection.length === 1 && !isWallMode) {
      const node = nodeMap.current.get(selection[0]);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selection, objects, isWallMode]);

  const worldPointFromStage = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getRelativePointerPosition();
    if (!p) return null;
    return { x: p.x / PX_PER_IN, y: p.y / PX_PER_IN };
  }, []);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const oldScale = cam.scale;
    const pointer = stage.getPointerPosition()!;
    const mousePoint = {
      x: (pointer.x - cam.x) / oldScale,
      y: (pointer.y - cam.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.08;
    let newScale = direction > 0 ? oldScale * factor : oldScale / factor;
    newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const next = {
      scale: newScale,
      x: pointer.x - mousePoint.x * newScale,
      y: pointer.y - mousePoint.y * newScale,
    };
    setCam(next);
    commitCameraDebounced(next);
  };

  const snapIn = settings.snapToGrid ? GRID_IN : null;

  const handleObjSelect = (id: string, additive: boolean) => {
    if (additive) {
      const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
      setSelection(next);
    } else if (!selection.includes(id)) {
      setSelection([id]);
    }
  };

  const onTransformEnd = () => {
    if (selection.length !== 1) return;
    const node = nodeMap.current.get(selection[0]);
    const obj = objects[selection[0]];
    if (!node || !obj) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const newW = Math.max(2, obj.width * scaleX);
    const newH = Math.max(2, obj.height * scaleY);
    updateObject(obj.id, {
      width: Math.round(newW),
      height: Math.round(newH),
      rotation: Math.round(node.rotation()),
    });
  };

  // Grid lines across the visible world region.
  const grid = useMemo(() => {
    if (!settings.gridVisible) return null;
    const step = GRID_IN * PX_PER_IN;
    const left = -cam.x / cam.scale;
    const top = -cam.y / cam.scale;
    const right = (w - cam.x) / cam.scale;
    const bottom = (h - cam.y) / cam.scale;
    const startX = Math.floor(left / step) * step;
    const startY = Math.floor(top / step) * step;
    const lines: React.ReactNode[] = [];
    for (let x = startX; x < right; x += step) {
      const major = Math.round(x / step) % 2 === 0;
      lines.push(
        <Line
          key={`v${x}`}
          points={[x, top, x, bottom]}
          stroke={major ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)'}
          strokeWidth={1 / cam.scale}
        />,
      );
    }
    for (let y = startY; y < bottom; y += step) {
      const major = Math.round(y / step) % 2 === 0;
      lines.push(
        <Line
          key={`h${y}`}
          points={[left, y, right, y]}
          stroke={major ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)'}
          strokeWidth={1 / cam.scale}
        />,
      );
    }
    return lines;
  }, [settings.gridVisible, cam, w, h]);

  const objectList = useMemo(
    () => Object.values(objects).filter((o) => visibleLayerIds.has(o.layerId)),
    [objects, visibleLayerIds],
  );

  // Fit-to-view: animate the camera to frame every visible object/wall.
  useEffect(() => {
    if (fitToViewToken === 0) return;
    const bounds = computeVisibleBounds(room);
    if (!bounds) return;
    const marginIn = 24;
    const boxW = Math.max(1, bounds.maxX - bounds.minX + marginIn * 2);
    const boxH = Math.max(1, bounds.maxY - bounds.minY + marginIn * 2);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w / (boxW * PX_PER_IN), h / (boxH * PX_PER_IN))));
    const targetCam: Camera = {
      scale: targetScale,
      x: w / 2 - centerX * PX_PER_IN * targetScale,
      y: h / 2 - centerY * PX_PER_IN * targetScale,
    };

    const start = { ...cam };
    const startTime = performance.now();
    const duration = 450;
    if (fitAnimRef.current) cancelAnimationFrame(fitAnimRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = {
        x: start.x + (targetCam.x - start.x) * eased,
        y: start.y + (targetCam.y - start.y) * eased,
        scale: start.scale + (targetCam.scale - start.scale) * eased,
      };
      setCam(next);
      if (t < 1) {
        fitAnimRef.current = requestAnimationFrame(step);
      } else {
        setRoomCamera(room.id, next);
      }
    };
    fitAnimRef.current = requestAnimationFrame(step);
    return () => {
      if (fitAnimRef.current) cancelAnimationFrame(fitAnimRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToViewToken]);

  const stageDraggable = !isWallMode || wallTool === 'select';

  return (
    <>
      <Stage
        ref={stageRef}
        width={w}
        height={h}
        x={cam.x}
        y={cam.y}
        scaleX={cam.scale}
        scaleY={cam.scale}
        draggable={stageDraggable}
        onWheel={onWheel}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            const next = { ...cam, x: e.target.x(), y: e.target.y() };
            setCam(next);
            commitCameraDebounced(next);
          }
        }}
        onMouseMove={() => {
          if (isWallMode && wallTool !== 'select') {
            setWallCursor(worldPointFromStage());
          }
          const now = performance.now();
          if (now - lastCursorUpdate.current > 60) {
            lastCursorUpdate.current = now;
            setLiveCursor(worldPointFromStage());
          }
        }}
        onMouseLeave={() => setLiveCursor(null)}
        onMouseDown={(e) => {
          // Drawing captures the gesture regardless of what's under the cursor
          // (an existing wall may be right where the next point goes).
          if (isWallMode && wallTool === 'draw') {
            wallGestureStart.current = worldPointFromStage();
            return;
          }
          if (e.target !== stageRef.current) return;
          if (isWallMode && wallTool === 'select') {
            selectWallEntity(null);
          } else if (!isWallMode) {
            clearSelection();
          }
        }}
        onMouseUp={() => {
          if (!isWallMode || wallTool !== 'draw') return;
          const upPoint = worldPointFromStage();
          if (!upPoint) return;

          // Clicking again at (nearly) the same spot as the previous commit,
          // shortly after, finishes the chain without closing it. This is a
          // deliberate re-implementation rather than Konva's built-in dblclick:
          // Konva's own double-click simulation is purely time-based (no
          // distance check), so two ordinary fast clicks anywhere on the
          // canvas — an entirely normal way to place wall points quickly —
          // would otherwise be misread as "finish" and silently cancel the draft.
          const draftBefore = useStore.getState().wallDraft;
          const now = performance.now();
          const last = lastWallCommit.current;
          if (
            draftBefore &&
            last &&
            now - last.time < 450 &&
            Math.hypot(upPoint.x - last.point.x, upPoint.y - last.point.y) < 6
          ) {
            cancelWallDraft();
            lastWallCommit.current = null;
            wallGestureStart.current = null;
            return;
          }

          if (!draftBefore) {
            const downPoint = wallGestureStart.current ?? upPoint;
            commitWallPoint(downPoint);
            const dragged = Math.hypot(upPoint.x - downPoint.x, upPoint.y - downPoint.y) > 3;
            if (dragged) commitWallPoint(upPoint);
            lastWallCommit.current = { point: dragged ? upPoint : downPoint, time: now };
          } else {
            commitWallPoint(upPoint);
            lastWallCommit.current = { point: upPoint, time: now };
          }
          wallGestureStart.current = null;
        }}
        onTouchStart={(e) => {
          if (e.target === stageRef.current && !isWallMode) clearSelection();
        }}
        onContextMenu={(e) => e.evt.preventDefault()}
        style={{ background: 'transparent' }}
      >
        <Layer listening={false}>{grid}</Layer>

        {blueprintImg && room.blueprint && (
          <Layer listening={false}>
            <KonvaImage image={blueprintImg} x={0} y={0} opacity={room.blueprint.opacity} />
          </Layer>
        )}

        <Layer>
          <WallLayer
            room={room}
            px={PX_PER_IN}
            units={settings.units}
            wallTool={isWallMode ? wallTool : 'select'}
            wallSelection={wallSelection}
            wallCursorIn={wallCursor}
            visible={wallLayer ? visibleLayerIds.has(wallLayer.id) : false}
            interactive={isWallMode}
          />
        </Layer>

        <Layer>
          {objectList.map((obj) => (
            <ObjectNode
              key={obj.id}
              obj={obj}
              px={PX_PER_IN}
              selected={selection.includes(obj.id)}
              searchHit={searchHits.has(obj.id)}
              dimmed={search.trim().length > 0 && !searchHits.has(obj.id)}
              counts={counts[obj.id] ?? {}}
              showDetail={showDetail}
              snapIn={snapIn}
              zoomScale={cam.scale}
              showAllLabels={settings.showAllLabels}
              mode={mode}
              registerNode={registerNode}
              onSelect={handleObjSelect}
              onOpenCell={(id, key) => mode === 'inventory' && open({ objectId: id, cellKey: key })}
              onOpenPicker={(id) => mode === 'inventory' && openPicker(id)}
              onDragMove={(id, x, y) => updateObject(id, { x, y })}
              onDragEnd={(id, x, y) => updateObject(id, { x, y })}
              onContextMenu={(id, x, y) => openContextMenu(id, x, y)}
            />
          ))}
          {mode === 'design' && !isWallMode && (
            <Transformer
              ref={trRef}
              rotateEnabled
              keepRatio={false}
              borderStroke="#4f8cff"
              anchorStroke="#4f8cff"
              anchorFill="#12151d"
              anchorSize={9}
              rotateAnchorOffset={22}
              onTransformEnd={onTransformEnd}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
            />
          )}
        </Layer>
      </Stage>

      <Minimap room={room} cam={cam} viewportW={w} viewportH={h} px={PX_PER_IN} onJump={(next) => {
        setCam(next);
        commitCameraDebounced(next);
      }} />

      <StatusBar zoomPct={cam.scale * 100} cursorWorld={liveCursor} />
    </>
  );
}
