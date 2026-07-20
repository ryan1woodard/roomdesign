import { useEffect, useRef } from 'react';
import { Group, Rect, Ellipse, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';
import type { RoomObject } from '../types';
import { gridCells, cellName, cellKind } from '../lib/shelf';

const HANDLE = 0; // reserved

interface Props {
  obj: RoomObject;
  px: number; // pixels per inch (world scale, before stage zoom)
  selected: boolean;
  searchHit: boolean;
  dimmed: boolean;
  counts: Record<string, number>;
  showDetail: boolean; // zoom-dependent: show cell labels/counts
  snapIn: number | null; // grid snap step in inches, or null
  registerNode: (id: string, node: Konva.Group | null) => void;
  onSelect: (id: string, additive: boolean) => void;
  onOpenCell: (id: string, cellKey: string) => void;
  onOpenPicker: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

export default function ObjectNode({
  obj,
  px,
  selected,
  searchHit,
  dimmed,
  counts,
  showDetail,
  snapIn,
  registerNode,
  onSelect,
  onOpenCell,
  onOpenPicker,
  onDragMove,
  onDragEnd,
}: Props) {
  const groupRef = useRef<Konva.Group>(null);
  const glowRef = useRef<Konva.Rect>(null);

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

  const centerX = (obj.x + obj.width / 2) * px;
  const centerY = (obj.y + obj.height / 2) * px;

  const stroke = selected ? '#4f8cff' : 'rgba(255,255,255,0.14)';
  const strokeW = selected ? 2 : 1;

  const commonShapeProps = {
    fill: obj.fill === 'transparent' ? undefined : obj.fill,
    stroke,
    strokeWidth: strokeW,
    shadowColor: 'black',
    shadowBlur: selected ? 18 : 10,
    shadowOpacity: 0.4,
    shadowOffsetY: 4,
  };

  return (
    <Group
      ref={groupRef}
      x={centerX}
      y={centerY}
      offsetX={w / 2}
      offsetY={h / 2}
      rotation={obj.rotation}
      draggable
      opacity={dimmed ? 0.35 : 1}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(obj.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(obj.id, false);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        if (isContainer) onOpenPicker(obj.id);
        else onOpenCell(obj.id, 'surface');
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        if (isContainer) onOpenPicker(obj.id);
        else onOpenCell(obj.id, 'surface');
      }}
      onDragMove={() => {
        const n = groupRef.current!;
        let tlx = n.x() / px - obj.width / 2;
        let tly = n.y() / px - obj.height / 2;
        if (snapIn) {
          tlx = Math.round(tlx / snapIn) * snapIn;
          tly = Math.round(tly / snapIn) * snapIn;
          n.x((tlx + obj.width / 2) * px);
          n.y((tly + obj.height / 2) * px);
        }
        onDragMove(obj.id, tlx, tly);
      }}
      onDragEnd={() => {
        const n = groupRef.current!;
        let tlx = n.x() / px - obj.width / 2;
        let tly = n.y() / px - obj.height / 2;
        if (snapIn) {
          tlx = Math.round(tlx / snapIn) * snapIn;
          tly = Math.round(tly / snapIn) * snapIn;
        }
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

      {/* Container cell divisions */}
      {isContainer &&
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
                  onOpenCell(obj.id, c.key);
                }}
                onDblTap={(e) => {
                  e.cancelBubble = true;
                  onOpenCell(obj.id, c.key);
                }}
              />
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

      {/* Name label */}
      {obj.kind === 'text' ? (
        <Text
          width={w}
          text={obj.name}
          fontSize={Math.max(10, h * 0.6)}
          fontFamily="Inter, sans-serif"
          fontStyle="600"
          fill={obj.fill === 'transparent' ? '#eef1f7' : '#fff'}
        />
      ) : (
        <Text
          x={6}
          y={isContainer ? -16 : 6}
          text={obj.name}
          fontSize={11}
          fontFamily="Inter, sans-serif"
          fontStyle="600"
          fill={isContainer ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)'}
          listening={false}
          shadowColor="black"
          shadowBlur={4}
        />
      )}
      {HANDLE ? <Line points={[]} /> : null}
    </Group>
  );
}
