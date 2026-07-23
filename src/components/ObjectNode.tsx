import { useEffect, useRef } from 'react';
import { Group, Rect, Ellipse, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import type { RoomObject, AppMode } from '../types';
import type { ObjectTool } from '../store/store';
import { gridCells, cellName, cellKind, storageCharacter } from '../lib/shelf';
import { objectBBox, snapTranslate, type SnapLines, type SnapGuides, NO_SNAP_GUIDES } from '../lib/snapping';

const LABEL_GAP = 6; // px, screen-space gap between object's top edge and its label
const LABEL_W = 140;
const LABEL_H = 18;
/** Below this stage zoom, labels are always hidden to avoid clutter. */
export const LABEL_MIN_ZOOM = 0.35;

interface Props {
  obj: RoomObject;
  px: number; // pixels per inch (world scale, before stage zoom)
  selected: boolean;
  searchHit: boolean;
  dimmed: boolean;
  counts: Record<string, number>;
  showDetail: boolean; // zoom-dependent: show cell labels/counts
  /** Every wall/object edge this object's own edges can snap to (excluding itself), for the Free Move tool. */
  getSnapLines: (excludeId: string) => SnapLines;
  onSnapGuideChange: (guides: SnapGuides) => void;
  zoomScale: number; // current stage zoom (cam.scale)
  showAllLabels: boolean;
  /** "Open Compartments" toolbar toggle — when off, a container renders as
   * a plain solid object, same as any non-container shape. */
  showCompartments: boolean;
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

/** Topmost screen-space Y of a rotated object's bounding box, relative to its center. */
function rotatedTopOffset(width: number, height: number, rotationDeg: number): number {
  const rad = (rotationDeg * Math.PI) / 180;
  const hw = width / 2;
  const hh = height / 2;
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  let minY = Infinity;
  for (const [x, y] of corners) {
    const ry = x * Math.sin(rad) + y * Math.cos(rad);
    if (ry < minY) minY = ry;
  }
  return minY;
}

export default function ObjectNode({
  obj,
  px,
  selected,
  searchHit,
  dimmed,
  counts,
  showDetail,
  getSnapLines,
  onSnapGuideChange,
  zoomScale,
  showAllLabels,
  showCompartments,
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
  const labelRef = useRef<Konva.Group>(null);
  const labelTweenRef = useRef<Konva.Tween | null>(null);
  const hoverRef = useRef(false);
  const dragSnapLinesRef = useRef<SnapLines>({ vertical: [], horizontal: [] });

  // Destroying the same Konva.Tween instance twice throws, and the label's
  // fade is driven from three independent places (the effect below, plus the
  // imperative hover handlers), so every "replace the tween" site must null
  // the ref out immediately to make repeat destroys a safe no-op.
  const killLabelTween = () => {
    labelTweenRef.current?.destroy();
    labelTweenRef.current = null;
  };
  const fadeLabelTo = (opacity: number, duration: number) => {
    killLabelTween();
    if (!labelRef.current) return;
    labelTweenRef.current = new Konva.Tween({ node: labelRef.current, duration, opacity });
    labelTweenRef.current.play();
  };

  const w = obj.width * px;
  const h = obj.height * px;

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
  const badgeVisible = isContainer && (showCompartments || showDetail) && (character === 'shelf' || character === 'drawer') && w > 40 && h > 24;

  const centerX = (obj.x + obj.width / 2) * px;
  const centerY = (obj.y + obj.height / 2) * px;

  const zoomVisible = zoomScale >= LABEL_MIN_ZOOM;
  const labelWanted = zoomVisible && (showAllLabels || selected || hoverRef.current);

  // Smoothly fade the label group in/out via a Konva tween (avoids per-frame React re-renders).
  useEffect(() => {
    fadeLabelTo(labelWanted ? 1 : 0, 0.15);
    return killLabelTween;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelWanted]);

  const topOffset = rotatedTopOffset(w, h, obj.rotation);
  const counterScale = 1 / Math.max(0.001, zoomScale);

  const hasCustomBorder = !selected && (obj.borderWidth ?? 0) > 0;
  const stroke = selected ? '#4f8cff' : hasCustomBorder ? obj.borderColor || '#ffffff' : 'rgba(255,255,255,0.14)';
  const strokeW = selected ? 2 : hasCustomBorder ? obj.borderWidth! : 1;

  const commonShapeProps = {
    fill: obj.fill === 'transparent' ? undefined : obj.fill,
    stroke,
    strokeWidth: strokeW,
    shadowColor: 'black',
    // Drawer units read slightly heavier/boxier than shelves or plain surfaces.
    shadowBlur: selected ? 18 : character === 'drawer' ? 13 : 10,
    shadowOpacity: character === 'drawer' ? 0.48 : 0.4,
    shadowOffsetY: 4,
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
        opacity={dimmed ? 0.35 : 1}
        onMouseEnter={() => {
          hoverRef.current = true;
          fadeLabelTo(zoomVisible ? 1 : 0, 0.15);
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          if (showAllLabels || selected) return;
          fadeLabelTo(0, 0.2);
        }}
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
        ) : obj.kind === 'text' ? null : (
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

        {/* Storage-type corner badge: a tiny shelf or drawer glyph, so the
            kind of container is recognizable even before opening it. */}
        {badgeVisible && (
          <Group x={w - 26} y={6} listening={false}>
            <Rect width={20} height={15} cornerRadius={3} fill="rgba(10,13,20,0.85)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            {character === 'shelf' ? (
              <>
                <Line points={[4, 5, 16, 5]} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                <Line points={[4, 10, 16, 10]} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
              </>
            ) : (
              <Line points={[6, 10, 14, 10]} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} lineCap="round" />
            )}
          </Group>
        )}

        {/* Inline text-object content */}
        {obj.kind === 'text' && (
          <Text
            width={w}
            text={obj.name}
            fontSize={Math.max(10, h * 0.6)}
            fontFamily="Inter, sans-serif"
            fontStyle="600"
            fill={obj.fill === 'transparent' ? '#eef1f7' : '#fff'}
          />
        )}
      </Group>

      {/* Floating name label: centered above the object, upright regardless of rotation,
          counter-scaled so it stays a constant, readable screen size at any zoom. */}
      {obj.kind !== 'text' && (
        <Group
          ref={labelRef}
          x={centerX}
          y={centerY + topOffset}
          scaleX={counterScale}
          scaleY={counterScale}
          opacity={0}
          listening={false}
        >
          <Text
            x={-LABEL_W / 2}
            y={-LABEL_H - LABEL_GAP}
            width={LABEL_W}
            height={LABEL_H}
            align="center"
            verticalAlign="middle"
            text={obj.name}
            fontSize={12}
            fontFamily="Inter, sans-serif"
            fontStyle="600"
            fill="#eef1f7"
            shadowColor="black"
            shadowBlur={6}
            shadowOpacity={0.8}
            ellipsis
            wrap="none"
          />
        </Group>
      )}
    </>
  );
}
