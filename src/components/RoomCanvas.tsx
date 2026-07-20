import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Line, Transformer } from 'react-konva';
import Konva from 'konva';
import { useStore } from '../store/store';
import { objectsMatchingSearch } from '../lib/selectors';
import ObjectNode from './ObjectNode';

export const PX_PER_IN = 6; // world scale before stage zoom
const GRID_IN = 6; // grid + snap step, inches
const MIN_SCALE = 0.15;
const MAX_SCALE = 6;

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
  const [cam, setCam] = useState<Camera>({ x: 120, y: 120, scale: 1 });

  const objects = useStore((s) => s.objects);
  const items = useStore((s) => s.items);
  const tags = useStore((s) => s.tags);
  const layers = useStore((s) => s.layers);
  const selection = useStore((s) => s.selection);
  const settings = useStore((s) => s.settings);
  const search = useStore((s) => s.search);

  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const updateObject = useStore((s) => s.updateObject);
  const open = useStore((s) => s.open);
  const openPicker = useStore((s) => s.openPicker);

  const visibleLayerIds = useMemo(
    () => new Set(layers.filter((l) => l.visible).map((l) => l.id)),
    [layers],
  );

  const searchHits = useMemo(
    () => objectsMatchingSearch(items, search, tags),
    [items, search, tags],
  );

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
    if (selection.length === 1) {
      const node = nodeMap.current.get(selection[0]);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selection, objects]);

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
    setCam({
      scale: newScale,
      x: pointer.x - mousePoint.x * newScale,
      y: pointer.y - mousePoint.y * newScale,
    });
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
    const left = (-cam.x) / cam.scale;
    const top = (-cam.y) / cam.scale;
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

  return (
    <Stage
      ref={stageRef}
      width={w}
      height={h}
      x={cam.x}
      y={cam.y}
      scaleX={cam.scale}
      scaleY={cam.scale}
      draggable
      onWheel={onWheel}
      onDragEnd={(e) => {
        if (e.target === stageRef.current) {
          setCam((c) => ({ ...c, x: e.target.x(), y: e.target.y() }));
        }
      }}
      onMouseDown={(e) => {
        if (e.target === stageRef.current) clearSelection();
      }}
      onTouchStart={(e) => {
        if (e.target === stageRef.current) clearSelection();
      }}
      style={{ background: 'transparent' }}
    >
      <Layer listening={false}>{grid}</Layer>
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
            registerNode={registerNode}
            onSelect={handleObjSelect}
            onOpenCell={(id, key) => open({ objectId: id, cellKey: key })}
            onOpenPicker={(id) => openPicker(id)}
            onDragMove={(id, x, y) => updateObject(id, { x, y })}
            onDragEnd={(id, x, y) => updateObject(id, { x, y })}
          />
        ))}
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
      </Layer>
    </Stage>
  );
}
