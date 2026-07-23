import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line, Transformer, Group, Rect, Ellipse } from 'react-konva';
import Konva from 'konva';
import { useStore, useActiveRoom } from '../store/store';
import { objectsMatchingSearch } from '../lib/selectors';
import { computeVisibleBounds } from '../lib/bounds';
import { computeWallCandidate } from '../lib/walls';
import { storageCharacter } from '../lib/shelf';
import { collectSnapLines, snapEdges, type BBox, type SnapGuides, NO_SNAP_GUIDES } from '../lib/snapping';
import type { RoomObject } from '../types';
import ObjectNode from './ObjectNode';
import TransformTools from './TransformTools';
import WallLayer from './WallLayer';
import FloorLayer from './FloorLayer';
import StatusBar from './StatusBar';

/** A same-layer object never casts a shadow onto its neighbors — only onto
 * whatever layer(s) render beneath it. Rendered as a separate pre-pass, one
 * full opaque silhouette per object, entirely covered up (within its own
 * layer) by that layer's real, shadowless fills drawn immediately after —
 * see the two-pass grouping in the object Layer below. */
function ObjectShadowCaster({ obj, px, selected }: { obj: RoomObject; px: number; selected: boolean }) {
  if (obj.kind === 'text') return null;
  const w = obj.width * px;
  const h = obj.height * px;
  const character = storageCharacter(obj);
  const shadowProps = {
    fill: 'black',
    shadowColor: 'black',
    shadowBlur: selected ? 18 : character === 'drawer' ? 13 : 10,
    shadowOpacity: character === 'drawer' ? 0.48 : 0.4,
    shadowOffsetY: 4,
  };
  return (
    <Group
      x={(obj.x + obj.width / 2) * px}
      y={(obj.y + obj.height / 2) * px}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={obj.rotation}
      listening={false}
    >
      {obj.kind === 'circle' ? (
        <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...shadowProps} />
      ) : (
        <Rect width={w} height={h} cornerRadius={obj.cornerRadius * px} {...shadowProps} />
      )}
    </Group>
  );
}

export const PX_PER_IN = 6; // world scale before stage zoom
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
  const [wallSnapVertexId, setWallSnapVertexId] = useState<string | null>(null);
  const wallGestureStart = useRef<{ x: number; y: number } | null>(null);
  const lastWallCommit = useRef<{ point: { x: number; y: number }; time: number } | null>(null);
  const fitAnimRef = useRef<number | null>(null);
  const [liveCursor, setLiveCursor] = useState<{ x: number; y: number } | null>(null);
  const lastCursorUpdate = useRef(0);
  const [snapGuide, setSnapGuide] = useState<SnapGuides>(NO_SNAP_GUIDES);

  const tags = useStore((s) => s.tags);
  const selection = useStore((s) => s.selection);
  const settings = useStore((s) => s.settings);
  const search = useStore((s) => s.search);
  const wallTool = useStore((s) => s.wallTool);
  const wallSelection = useStore((s) => s.wallSelection);
  const wallDraft = useStore((s) => s.wallDraft);
  const objectTool = useStore((s) => s.objectTool);
  const fitToViewToken = useStore((s) => s.fitToViewToken);

  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const updateObject = useStore((s) => s.updateObject);
  const open = useStore((s) => s.open);
  const openPicker = useStore((s) => s.openPicker);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const setRoomCamera = useStore((s) => s.setRoomCamera);
  const requestFitToView = useStore((s) => s.requestFitToView);
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

  // Automatic Fit to View on startup: whenever the app is loaded/reloaded/
  // reopened, frame the visible workspace without requiring a manual click.
  // A tick's delay lets the window/stage settle to its real size first.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestFitToView());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Attach transformer (resize handles) to a single selected object — in the
  // default 'select' tool and in 'freeMove' (which also allows dragging),
  // since 'move'/'rotate' show their own dedicated gizmo instead.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selection.length === 1 && !isWallMode && (objectTool === 'select' || objectTool === 'freeMove')) {
      const node = nodeMap.current.get(selection[0]);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selection, objects, isWallMode, objectTool]);

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

  const handleObjSelect = (id: string, additive: boolean) => {
    if (additive) {
      const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
      setSelection(next);
    } else if (!selection.includes(id)) {
      setSelection([id]);
    }
  };

  const getSnapLines = useCallback((excludeId: string) => collectSnapLines(room, excludeId), [room]);

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
    // The node's runtime x/y already reflect the new center Konva computed to
    // keep the anchor corner you actually dragged fixed (any corner other
    // than bottom-right shifts the center) — read them back instead of only
    // width/height, or the object snaps back to its old position on the next
    // render whenever you resize from the top, left, or any non-bottom-right handle.
    const newCenterX = node.x() / PX_PER_IN;
    const newCenterY = node.y() / PX_PER_IN;
    updateObject(obj.id, {
      x: Math.round(newCenterX - newW / 2),
      y: Math.round(newCenterY - newH / 2),
      width: Math.round(newW),
      height: Math.round(newH),
    });
    setSnapGuide(NO_SNAP_GUIDES);
  };

  const objectList = useMemo(() => {
    const layerIndex = new Map(layers.map((l, i) => [l.id, i]));
    return Object.values(objects)
      .filter((o) => visibleLayerIds.has(o.layerId))
      .sort((a, b) => (layerIndex.get(a.layerId) ?? 0) - (layerIndex.get(b.layerId) ?? 0));
  }, [objects, visibleLayerIds, layers]);

  // Grouped by layer (bottom layer first, matching objectList's order) so each
  // layer can be drawn as its own [shadows, then fills] pass — see ObjectShadowCaster.
  const objectLayerGroups = useMemo(() => {
    const groups: RoomObject[][] = [];
    let currentLayerId: string | null = null;
    for (const obj of objectList) {
      if (obj.layerId !== currentLayerId) {
        groups.push([]);
        currentLayerId = obj.layerId;
      }
      groups[groups.length - 1].push(obj);
    }
    return groups;
  }, [objectList]);

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

    // The toolbar and status bar float on top of the canvas rather than
    // taking up their own layout space, so framing against the raw window
    // height leaves the room tucked behind them. Measure their real height
    // and treat only the strip between them as the usable viewport.
    const topBarRect = document.querySelector('.top-bar')?.getBoundingClientRect();
    const statusBarRect = document.querySelector('.status-bar')?.getBoundingClientRect();
    const topInset = topBarRect ? topBarRect.bottom + 16 : 0;
    const bottomInset = statusBarRect ? h - statusBarRect.top + 16 : 0;
    const usableH = Math.max(100, h - topInset - bottomInset);
    const usableCenterY = topInset + usableH / 2;

    const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w / (boxW * PX_PER_IN), usableH / (boxH * PX_PER_IN))));
    const targetCam: Camera = {
      scale: targetScale,
      x: w / 2 - centerX * PX_PER_IN * targetScale,
      y: usableCenterY - centerY * PX_PER_IN * targetScale,
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
        onMouseMove={(e) => {
          if (isWallMode && wallTool === 'draw') {
            const raw = worldPointFromStage();
            if (raw) {
              const angleSnapOn = !e.evt.altKey;
              const candidate = computeWallCandidate(room.vertices, wallDraft, raw, angleSnapOn);
              setWallCursor(candidate.point);
              setWallSnapVertexId(candidate.snappedVertexId);
            } else {
              setWallCursor(null);
              setWallSnapVertexId(null);
            }
          } else if (isWallMode && wallTool !== 'select') {
            setWallCursor(worldPointFromStage());
            setWallSnapVertexId(null);
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
        onMouseUp={(e) => {
          if (!isWallMode || wallTool !== 'draw') return;
          const angleSnapOn = !e.evt.altKey;
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
            commitWallPoint(downPoint, angleSnapOn);
            const dragged = Math.hypot(upPoint.x - downPoint.x, upPoint.y - downPoint.y) > 3;
            if (dragged) commitWallPoint(upPoint, angleSnapOn);
            lastWallCommit.current = { point: dragged ? upPoint : downPoint, time: now };
          } else {
            commitWallPoint(upPoint, angleSnapOn);
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
        <Layer>
          <FloorLayer room={room} px={PX_PER_IN} visible={wallLayer ? visibleLayerIds.has(wallLayer.id) : false} />
        </Layer>

        <Layer>
          {objectLayerGroups.map((group, i) => (
            <Group key={i}>
              {group.map((obj) => (
                <ObjectShadowCaster key={obj.id} obj={obj} px={PX_PER_IN} selected={selection.includes(obj.id)} />
              ))}
              {group.map((obj) => (
                <ObjectNode
                  key={obj.id}
                  obj={obj}
                  px={PX_PER_IN}
                  selected={selection.includes(obj.id)}
                  searchHit={searchHits.has(obj.id)}
                  dimmed={search.trim().length > 0 && !searchHits.has(obj.id)}
                  counts={counts[obj.id] ?? {}}
                  showDetail={showDetail}
                  getSnapLines={getSnapLines}
                  onSnapGuideChange={setSnapGuide}
                  zoomScale={cam.scale}
                  showAllLabels={settings.showAllLabels ?? true}
                  mode={mode}
                  objectTool={objectTool}
                  registerNode={registerNode}
                  onSelect={handleObjSelect}
                  onOpenCell={(id, key) => mode === 'inventory' && open({ objectId: id, cellKey: key })}
                  onOpenPicker={(id) => mode === 'inventory' && openPicker(id)}
                  onDragMove={(id, x, y) => updateObject(id, { x, y })}
                  onDragEnd={(id, x, y) => updateObject(id, { x, y })}
                  onContextMenu={(id, x, y) => openContextMenu(id, x, y)}
                />
              ))}
            </Group>
          ))}
          {mode === 'design' && !isWallMode && (objectTool === 'select' || objectTool === 'freeMove') && (
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              keepRatio={false}
              borderStroke="#4f8cff"
              anchorStroke="#4f8cff"
              anchorFill="#12151d"
              anchorSize={9}
              onTransformEnd={onTransformEnd}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 8 || newBox.height < 8) return oldBox;
                const stage = trRef.current?.getStage();
                const obj = selection.length === 1 ? objects[selection[0]] : null;
                if (!stage || !obj) return newBox;

                // `oldBox`/`newBox` are in absolute stage pixels (they account
                // for camera pan/zoom), a different space than the world*px
                // coordinates every object position is expressed in — convert
                // through the stage's transform before snapping, and back after,
                // the same technique used to fix the door/window drag-off-screen bug.
                const inverse = stage.getAbsoluteTransform().copy().invert();
                const toWorld = (x: number, y: number) => {
                  const p = inverse.point({ x, y });
                  return { x: p.x / PX_PER_IN, y: p.y / PX_PER_IN };
                };
                const oldTL = toWorld(oldBox.x, oldBox.y);
                const oldBR = toWorld(oldBox.x + oldBox.width, oldBox.y + oldBox.height);
                const newTL = toWorld(newBox.x, newBox.y);
                const newBR = toWorld(newBox.x + newBox.width, newBox.y + newBox.height);

                const stationary: BBox = {
                  left: Math.min(oldTL.x, oldBR.x),
                  right: Math.max(oldTL.x, oldBR.x),
                  top: Math.min(oldTL.y, oldBR.y),
                  bottom: Math.max(oldTL.y, oldBR.y),
                };
                const candidate: BBox = {
                  left: Math.min(newTL.x, newBR.x),
                  right: Math.max(newTL.x, newBR.x),
                  top: Math.min(newTL.y, newBR.y),
                  bottom: Math.max(newTL.y, newBR.y),
                };

                const snapped = snapEdges(candidate, stationary, getSnapLines(obj.id));
                setSnapGuide(snapped.guides);

                const forward = stage.getAbsoluteTransform();
                const p0 = forward.point({ x: snapped.left * PX_PER_IN, y: snapped.top * PX_PER_IN });
                const p1 = forward.point({ x: snapped.right * PX_PER_IN, y: snapped.bottom * PX_PER_IN });

                return { x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y, rotation: newBox.rotation };
              }}
            />
          )}
          {mode === 'design' &&
            !isWallMode &&
            (objectTool === 'move' || objectTool === 'rotate') &&
            selection.length === 1 &&
            objects[selection[0]] && (
              <TransformTools
                key={selection[0]}
                obj={objects[selection[0]]}
                px={PX_PER_IN}
                zoomScale={cam.scale}
                tool={objectTool}
                getSnapLines={getSnapLines}
                onSnapGuideChange={setSnapGuide}
                units={settings.units}
                onUpdate={(patch) => updateObject(selection[0], patch)}
              />
            )}
          {mode === 'design' && !isWallMode && snapGuide.v && (
            <Line
              points={[snapGuide.v.x * PX_PER_IN, snapGuide.v.y0 * PX_PER_IN, snapGuide.v.x * PX_PER_IN, snapGuide.v.y1 * PX_PER_IN]}
              stroke="#ff4fc3"
              strokeWidth={1.5 / cam.scale}
              dash={[6 / cam.scale, 4 / cam.scale]}
              listening={false}
            />
          )}
          {mode === 'design' && !isWallMode && snapGuide.h && (
            <Line
              points={[snapGuide.h.x0 * PX_PER_IN, snapGuide.h.y * PX_PER_IN, snapGuide.h.x1 * PX_PER_IN, snapGuide.h.y * PX_PER_IN]}
              stroke="#ff4fc3"
              strokeWidth={1.5 / cam.scale}
              dash={[6 / cam.scale, 4 / cam.scale]}
              listening={false}
            />
          )}
        </Layer>

        {/* Walls render last (topmost) so nothing an object does can ever
            shadow onto a wall — the wall's own fill always repaints over any
            bleed — while the wall's own shadow (added in WallLayer) falls
            correctly over every object/floor beneath it. */}
        <Layer>
          <WallLayer
            room={room}
            px={PX_PER_IN}
            units={settings.units}
            wallTool={isWallMode ? wallTool : 'select'}
            wallSelection={wallSelection}
            wallCursorIn={wallCursor}
            snapTargetVertexId={wallSnapVertexId}
            visible={wallLayer ? visibleLayerIds.has(wallLayer.id) : false}
            interactive={isWallMode}
          />
        </Layer>
      </Stage>

      <StatusBar zoomPct={cam.scale * 100} cursorWorld={liveCursor} />
    </>
  );
}
