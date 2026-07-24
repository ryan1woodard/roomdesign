import { useEffect, useRef } from 'react';
import { Group, Rect, Ellipse, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import type { RoomObject, AppMode } from '../types';
import type { ObjectTool } from '../store/store';
import { gridCells, cellName, cellKind, storageCharacter } from '../lib/shelf';
import { objectBBox, snapTranslate, type SnapLines, type SnapGuides, NO_SNAP_GUIDES } from '../lib/snapping';

const LABEL_MIN_W = 60; // px, floor so labels on very narrow objects stay legible
const LABEL_PAD = 6; // px, horizontal padding keeping wrapped text off the object's edges
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_H = 15; // px, measured line height at LABEL_FONT_SIZE/600 weight
const ICON_GAP = 6; // px, screen-space gap between the label's last line and the storage-type icon below it
const ICON_W = 24;
const ICON_H = 17;

// Shared, lazily-created canvas context used only to measure text — lets us
// compute how many lines a wrapped label will occupy synchronously during
// render (matching Konva's own greedy word-wrap closely enough for line
// counting), so the storage-type icon can sit a fixed gap below the label's
// actual last line instead of a worst-case reserved block that leaves an
// awkward gap under short, single-line names.
let measureCtx: CanvasRenderingContext2D | null = null;
function wrappedLineCount(text: string, maxWidth: number, fontSize: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxWidth <= 0) return 1;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 1;
  measureCtx.font = `600 ${fontSize}px Inter, sans-serif`;
  const spaceWidth = measureCtx.measureText(' ').width;
  let lines = 1;
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = measureCtx.measureText(word).width;
    const nextWidth = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
    if (nextWidth > maxWidth && lineWidth > 0) {
      lines += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = nextWidth;
    }
  }
  return lines;
}

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
  showIcons: boolean;
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
  showIcons,
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
  const labelLines = wrappedLineCount(obj.name, labelW, LABEL_FONT_SIZE);
  // Text and icon are two independently toggleable pieces of one block that's
  // always centered on the object as a whole — each piece only contributes to
  // the block's height (and thus to where the other piece lands) while its
  // own toggle is on, so turning either off re-centers what's left rather
  // than leaving a gap where it used to be.
  const textH = showAllLabels ? labelLines * LABEL_LINE_H : 0;
  const iconH = showIcons ? ICON_H : 0;
  const textIconGap = showAllLabels && showIcons ? ICON_GAP : 0;
  const labelBlockH = textH + textIconGap + iconH;

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

      {/* Floating name label + storage-type icon: independently toggleable
          (Labels / Icons toolbar buttons) but always stacked and centered as
          one block on the object's own center point — counter-scaled so it
          stays a constant, readable screen size at any zoom. */}
      {labelBlockH > 0 && (
        <Group x={centerX} y={centerY} scaleX={counterScale} scaleY={counterScale} listening={false}>
          {showAllLabels && (
            <Text
              x={-labelW / 2}
              y={-labelBlockH / 2}
              width={labelW}
              height={textH}
              align="center"
              verticalAlign="top"
              text={obj.name}
              fontSize={LABEL_FONT_SIZE}
              lineHeight={1.2}
              fontFamily="Inter, sans-serif"
              fontStyle="600"
              fill="#eef1f7"
              shadowColor="black"
              shadowBlur={6}
              shadowOpacity={0.8}
              wrap="word"
            />
          )}

          {/* A small glyph identifying the storage character (shelf/drawer/
              container) or, for a plain surface object, "table". */}
          {showIcons && (
            <Group x={-ICON_W / 2} y={-labelBlockH / 2 + textH + textIconGap}>
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
