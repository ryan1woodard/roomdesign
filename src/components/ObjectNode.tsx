import { useEffect, useRef } from 'react';
import { Group, Rect, Ellipse, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import type { RoomObject, AppMode } from '../types';
import type { ObjectTool } from '../store/store';
import { gridCells, cellName, cellKind, storageCharacter } from '../lib/shelf';
import { objectBBox, snapTranslate, type SnapLines, type SnapGuides, NO_SNAP_GUIDES } from '../lib/snapping';

const LABEL_MIN_W = 60; // px, floor so labels on very narrow objects stay legible
const LABEL_PAD = 6; // px, horizontal padding keeping wrapped text off the object's edges
const LABEL_H = 48; // px, tall enough for a wrapped label to run to 3 lines before Konva starts clipping it
const ICON_GAP = 4; // px, screen-space gap between label text and the storage-type icon below it
const ICON_W = 24;
const ICON_H = 17;

interface Props {
  obj: RoomObject;
  px: number; // pixels per inch (world scale, before stage zoom)
  selected: boolean;
  searchHit: boolean;
  counts: Record<string, number>;
  showDetail: boolean; // zoom-dependent: show cell labels/counts
  /** Every wall/object edge this object's own edges can snap to (excluding itself), for the Free Move tool. */
  getSnapLines: (excludeId: string) => SnapLines;
  onSnapGuideChange: (guides: SnapGuides) => void;
  zoomScale: number; // current stage zoom (cam.scale)
  showAllLabels: boolean;
  /** Design Mode resizes furniture, and moves/rotates it directly only when
   * the Free Move tool is active (the Move/Rotate tools use a dedicated
   * gizmo instead); Inventory Mode opens it instead. */
  mode: AppMode;
  objectTool: ObjectTool;
  registerNode: (id: string, node: Konva.Group | null) => void;
  onSelect: (id: string, additive: boolean) => void;
  onOpenCell: (id: string, cellKey: string) => void;
  onOpenPicker: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

export default function ObjectNode({
  obj,
  px,
  selected,
  searchHit,
  counts,
  showDetail,
  getSnapLines,
  onSnapGuideChange,
  zoomScale,
  showAllLabels,
  mode,
  objectTool,
  registerNode,
  onSelect,
  onOpenCell,
  onOpenPicker,
  onDragMove,
  onDragEnd,
  onContextMenu,
}: Props) {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);
  const dragSnapLinesRef = useRef<SnapLines>({ vertical: [], horizontal: [] });

  const w = obj.width * px;
  const h = obj.height * px;
  // Labels wrap to stay within the object's own on-screen footprint instead
  // of overflowing past it. The label itself is counter-scaled to a constant
  // screen size regardless of zoom (see `counterScale` below), so its local
  // units already map 1:1 to real screen pixels — matching that requires
  // sizing off the object's actual on-screen width (`w * zoomScale`), not
  // its unzoomed world-space width. Very narrow/zoomed-out objects get a
  // small readable floor rather than wrapping down to one letter per line.
  const labelW = Math.max(w * zoomScale - LABEL_PAD * 2, LABEL_MIN_W);

  useEffect(() => {
    registerNode(obj.id, groupRef.current);
    return () => registerNode(obj.id, null);
  }, [obj.id, registerNode]);

  // Pulse animation for search hits.
  useEffect(() => {
    if (!searchHit || !glowRef.current) return;
    const node = glowRef.current;
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = (Math.sin(frame.time / 300) + 1) / 2; // 0..1
      node.opacity(0.35 + t * 0.55);
      node.shadowBlur(14 + t * 22);
    }, node.getLayer());
    anim.start();
    return () => {
      anim.stop();
    };
  }, [searchHit]);

  const isContainer = obj.storage.type === 'grid';
  const cells = isContainer ? gridCells(obj.storage) : [];
  const character = storageCharacter(obj);
  // The "Open Compartments" canvas overlay was removed as a product decision —
  // this flag (and the rendering it gates below) is kept in place rather than
  // deleted in case the feature comes back, but it must never be toggled on.
  const showCompartments = false;

  const centerX = (obj.x + obj.width / 2) * px;
  const centerY = (obj.y + obj.height / 2) * px;

  const counterScale = 1 / Math.max(0.001, zoomScale);

  const hasCustomBorder = !selected && (obj.borderWidth ?? 0) > 0;
  const stroke = selected ? '#4f8cff' : hasCustomBorder ? obj.borderColor || '#ffffff' : 'rgba(255,255,255,0.14)';
  const strokeW = selected ? 2 : hasCustomBorder ? obj.borderWidth! : 1;

  const commonShapeProps = {
    fill: obj.fill === 'transparent' ? undefined : obj.fill,
    stroke,
    strokeWidth: strokeW,
  };

  return (
    <>
      <Group
        ref={groupRef}
        x={centerX}
        y={centerY}
        offsetX={w / 2}
        offsetY={h / 2}
        rotation={obj.rotation}
        draggable={mode === 'design' && objectTool === 'freeMove'}
        onMouseDown={(e) => {
          e.cancelBubble = true;
          onSelect(obj.id, e.evt.shiftKey);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onSelect(obj.id, false);
        }}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
          onSelect(obj.id, false);
          onContextMenu(obj.id, e.evt.clientX, e.evt.clientY);
        }}
        onDblClick={(e) => {
          e.cancelBubble = true;
          if (mode !== 'inventory') return;
          if (isContainer) onOpenPicker(obj.id);
          else onOpenCell(obj.id, 'surface');
        }}
        onDblTap={(e) => {
          e.cancelBubble = true;
          if (mode !== 'inventory') return;
          if (isContainer) onOpenPicker(obj.id);
          else onOpenCell(obj.id, 'surface');
        }}
        onDragStart={() => {
          dragSnapLinesRef.current = getSnapLines(obj.id);
        }}
        onDragMove={() => {
          const n = groupRef.current!;
          let tlx = n.x() / px - obj.width / 2;
          let tly = n.y() / px - obj.height / 2;
          const bbox = objectBBox({ ...obj, x: tlx, y: tly });
          const { dx, dy, guides } = snapTranslate(bbox, dragSnapLinesRef.current);
          tlx += dx;
          tly += dy;
          n.x((tlx + obj.width / 2) * px);
          n.y((tly + obj.height / 2) * px);
          onSnapGuideChange(guides);
          onDragMove(obj.id, tlx, tly);
        }}
        onDragEnd={() => {
          const n = groupRef.current!;
          const tlx = n.x() / px - obj.width / 2;
          const tly = n.y() / px - obj.height / 2;
          onSnapGuideChange(NO_SNAP_GUIDES);
          onDragEnd(obj.id, tlx, tly);
        }}
      >
        {/* search-hit glow ring */}
        {searchHit && (
          <Rect
            ref={glowRef}
            x={-4}
            y={-4}
            width={w + 8}
            height={h + 8}
            cornerRadius={obj.cornerRadius * px + 4}
            stroke="#4f8cff"
            strokeWidth={3}
            shadowColor="#4f8cff"
            shadowBlur={22}
            shadowOpacity={1}
            listening={false}
          />
        )}

        {obj.kind === 'circle' ? (
          <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...commonShapeProps} />
        ) : (
          <Rect width={w} height={h} cornerRadius={obj.cornerRadius * px} {...commonShapeProps} />
        )}

        {/* Container cell divisions — only while "Open Compartments" is on. */}
        {isContainer &&
          showCompartments &&
          cells.map((c) => {
            const cx = c.x * w;
            const cy = c.y * h;
            const cw = c.w * w;
            const ch = c.h * h;
            const kind = cellKind(obj, c.key);
            const count = counts[c.key] ?? 0;
            return (
              <Group key={c.key}>
                <Rect
                  x={cx}
                  y={cy}
                  width={cw}
                  height={ch}
                  cornerRadius={3}
                  fill={kind === 'drawer' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.04)'}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={1}
                  onDblClick={(e) => {
                    e.cancelBubble = true;
                    if (mode !== 'inventory') return;
                    onOpenCell(obj.id, c.key);
                  }}
                  onDblTap={(e) => {
                    e.cancelBubble = true;
                    if (mode !== 'inventory') return;
                    onOpenCell(obj.id, c.key);
                  }}
                />
                {/* Interior line work: a drawer front's pull, or a shelf's top highlight. */}
                {kind === 'drawer' && cw > 18 && ch > 14 && (
                  <Line
                    points={[cx + cw * 0.3, cy + ch * 0.28, cx + cw * 0.7, cy + ch * 0.28]}
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth={Math.max(1, ch * 0.02)}
                    lineCap="round"
                    listening={false}
                  />
                )}
                {kind === 'shelf' && cw > 18 && ch > 14 && (
                  <Line points={[cx + 2, cy + 1, cx + cw - 2, cy + 1]} stroke="rgba(255,255,255,0.22)" strokeWidth={1} listening={false} />
                )}
                {showDetail && cw > 30 && (
                  <Text
                    x={cx + 4}
                    y={cy + 4}
                    width={cw - 8}
                    text={cellName(obj, c.key)}
                    fontSize={9}
                    fontFamily="Inter, sans-serif"
                    fill="rgba(255,255,255,0.7)"
                    listening={false}
                    ellipsis
                    wrap="none"
                  />
                )}
                {showDetail && count > 0 && cw > 24 && ch > 20 && (
                  <>
                    <Circle x={cx + cw - 11} y={cy + ch - 11} radius={8} fill="#4f8cff" listening={false} />
                    <Text
                      x={cx + cw - 19}
                      y={cy + ch - 15}
                      width={16}
                      align="center"
                      text={String(count)}
                      fontSize={9}
                      fontStyle="bold"
                      fill="white"
                      listening={false}
                    />
                  </>
                )}
              </Group>
            );
          })}

      </Group>

      {/* Floating name label: centered on the object regardless of rotation,
          counter-scaled so it stays a constant, readable screen size at any
          zoom. Overlapping labels on crowded objects are expected and
          intentional — legibility of "which object is which" wins over
          avoiding overlap. Hidden entirely via the Labels toolbar toggle. */}
      {showAllLabels && (
        <Group x={centerX} y={centerY} scaleX={counterScale} scaleY={counterScale} listening={false}>
          <Text
            x={-labelW / 2}
            y={-LABEL_H / 2}
            width={labelW}
            height={LABEL_H}
            align="center"
            verticalAlign="middle"
            text={obj.name}
            fontSize={12}
            lineHeight={1.2}
            fontFamily="Inter, sans-serif"
            fontStyle="600"
            fill="#eef1f7"
            shadowColor="black"
            shadowBlur={6}
            shadowOpacity={0.8}
            wrap="word"
          />

          {/* Inventory Mode: a small glyph identifying the storage character
              (shelf/drawer/container) or, for a plain surface object, "table" —
              replaces the old corner badge so it reads clearly at the label's
              fixed on-screen size regardless of zoom. */}
          {mode === 'inventory' && (
            <Group x={-ICON_W / 2} y={LABEL_H / 2 + ICON_GAP}>
              <Rect
                width={ICON_W}
                height={ICON_H}
                cornerRadius={3}
                fill="rgba(10,13,20,0.85)"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={1}
              />
              {character === 'shelf' && (
                <>
                  <Line points={[5, 5, 19, 5]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.3} lineCap="round" />
                  <Line points={[5, 8.5, 19, 8.5]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.3} lineCap="round" />
                  <Line points={[5, 12, 19, 12]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.3} lineCap="round" />
                </>
              )}
              {character === 'drawer' && (
                <>
                  <Rect x={5} y={4} width={14} height={9} cornerRadius={1.5} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
                  <Line points={[9, 8.5, 15, 8.5]} stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} lineCap="round" />
                </>
              )}
              {character === 'grid' && (
                <>
                  <Rect x={5} y={3} width={14} height={11} cornerRadius={1.5} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                  <Line points={[12, 3, 12, 14]} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
                  <Line points={[5, 8.5, 19, 8.5]} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
                </>
              )}
              {character === 'surface' && (
                <>
                  <Line points={[5, 6, 19, 6]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} lineCap="round" />
                  <Line points={[7, 6, 7, 13]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.3} lineCap="round" />
                  <Line points={[17, 6, 17, 13]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.3} lineCap="round" />
                </>
              )}
            </Group>
          )}
        </Group>
      )}
    </>
  );
}
