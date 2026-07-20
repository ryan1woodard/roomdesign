import { useMemo } from 'react';
import { Group, Line, Circle, Rect, Arc, Text } from 'react-konva';
import type { Room, WallSegment, WallOpening } from '../types';
import { useStore, type WallTool, type WallEntitySelection } from '../store/store';
import { wallRenderSegments, wallPointAt, wallAngleAt, sampleWallPoints, projectPointOnWall } from '../lib/walls';
import { formatLength } from '../lib/units';
import type { Unit } from '../types';

const WALL_COLOR = '#8b95a8';
const WALL_COLOR_SELECTED = '#4f8cff';
const BG = '#0b0d12';

interface Props {
  room: Room;
  px: number;
  units: Unit;
  wallTool: WallTool;
  wallSelection: WallEntitySelection;
  wallCursorIn: { x: number; y: number } | null;
  visible: boolean;
  /** Whether Wall Designer Mode is actually active (the Walls layer is the active layer). */
  interactive: boolean;
}

function wallColor(wall: WallSegment, sel: WallEntitySelection) {
  return sel && sel.type === 'wall' && sel.id === wall.id ? WALL_COLOR_SELECTED : WALL_COLOR;
}

export default function WallLayer({ room, px, units, wallTool, wallSelection, wallCursorIn, visible, interactive }: Props) {
  const selectWallEntity = useStore((s) => s.selectWallEntity);
  const moveVertex = useStore((s) => s.moveVertex);
  const splitWallAt = useStore((s) => s.splitWallAt);
  const addOpening = useStore((s) => s.addOpening);
  const moveOpeningAlongWall = useStore((s) => s.moveOpeningAlongWall);
  const wallDraft = useStore((s) => s.wallDraft);

  const openingsByWall = useMemo(() => {
    const map: Record<string, WallOpening[]> = {};
    for (const o of Object.values(room.openings)) {
      (map[o.wallId] ??= []).push(o);
    }
    return map;
  }, [room.openings]);

  // Vertex joint radius = half the thickest connected wall, so corners look plugged.
  const jointRadius = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of Object.values(room.walls)) {
      map[w.a] = Math.max(map[w.a] ?? 0, w.thickness / 2);
      map[w.b] = Math.max(map[w.b] ?? 0, w.thickness / 2);
    }
    return map;
  }, [room.walls]);

  if (!visible) return null;

  return (
    <Group>
      {/* Floors */}
      {room.floors.map((f) => {
        const pts = f.vertexIds.flatMap((vid) => {
          const v = room.vertices[vid];
          return v ? [v.x * px, v.y * px] : [];
        });
        return (
          <Line
            key={f.id}
            points={pts}
            closed
            fill={room.floorColor}
            opacity={room.floorOpacity}
            listening={false}
          />
        );
      })}

      {/* Blueprint reference image */}
      {/* (rendered by RoomCanvas beneath everything else, not here) */}

      {/* Walls */}
      {Object.values(room.walls).map((wall) => {
        const openings = openingsByWall[wall.id] ?? [];
        const segments = wallRenderSegments(wall, room.vertices, openings);
        const color = wallColor(wall, wallSelection);
        return (
          <Group key={wall.id}>
            {segments.map((seg, i) => {
              const pts = wall.curved
                ? sampleWallPoints(wall, room.vertices, seg.t0, seg.t1, 16).flatMap((p) => [p.x * px, p.y * px])
                : (() => {
                    const p0 = wallPointAt(wall, room.vertices, seg.t0);
                    const p1 = wallPointAt(wall, room.vertices, seg.t1);
                    return [p0.x * px, p0.y * px, p1.x * px, p1.y * px];
                  })();
              return (
                <Line
                  key={i}
                  points={pts}
                  stroke={color}
                  strokeWidth={wall.thickness * px}
                  hitStrokeWidth={wall.thickness * px + 16}
                  lineCap="round"
                  lineJoin="round"
                  listening={interactive}
                  onMouseDown={(e) => {
                    if (!interactive) return;
                    if (wallTool === 'select') {
                      e.cancelBubble = true;
                      selectWallEntity({ type: 'wall', id: wall.id });
                    } else if (wallTool === 'door' || wallTool === 'window') {
                      e.cancelBubble = true;
                      const stage = e.target.getStage()!;
                      const p = stage.getRelativePointerPosition()!;
                      const worldPoint = { x: p.x / px, y: p.y / px };
                      const t = projectPointOnWall(wall, room.vertices, worldPoint);
                      addOpening(wall.id, wallTool, t);
                    }
                  }}
                  onDblClick={(e) => {
                    if (!interactive || wallTool !== 'select') return;
                    e.cancelBubble = true;
                    const stage = e.target.getStage()!;
                    const p = stage.getRelativePointerPosition()!;
                    const worldPoint = { x: p.x / px, y: p.y / px };
                    const t = projectPointOnWall(wall, room.vertices, worldPoint);
                    splitWallAt(wall.id, t);
                  }}
                />
              );
            })}
          </Group>
        );
      })}

      {/* Vertex joints (visual plug at corners) */}
      {Object.values(room.vertices).map((v) => (
        <Circle
          key={`joint-${v.id}`}
          x={v.x * px}
          y={v.y * px}
          radius={(jointRadius[v.id] ?? 0) * px}
          fill={WALL_COLOR}
          listening={false}
        />
      ))}

      {/* Openings: doors and windows */}
      {Object.values(room.openings).map((o) => {
        const wall = room.walls[o.wallId];
        if (!wall) return null;
        const pt = wallPointAt(wall, room.vertices, o.t);
        const angleDeg = (wallAngleAt(wall, room.vertices, o.t) * 180) / Math.PI;
        const selected = wallSelection?.type === 'opening' && wallSelection.id === o.id;
        const wPx = o.width * px;
        const tPx = wall.thickness * px;
        const swingSign = o.swing === 'left' ? -1 : 1;
        const flipSign = o.flip ? -1 : 1;

        return (
          <Group
            key={o.id}
            x={pt.x * px}
            y={pt.y * px}
            rotation={angleDeg}
            listening={interactive}
            draggable={interactive && wallTool === 'select'}
            dragBoundFunc={(pos) => {
              const worldPoint = { x: pos.x / px, y: pos.y / px };
              const t = projectPointOnWall(wall, room.vertices, worldPoint);
              const p = wallPointAt(wall, room.vertices, t);
              return { x: p.x * px, y: p.y * px };
            }}
            onDragMove={(e) => {
              const worldPoint = { x: e.target.x() / px, y: e.target.y() / px };
              const t = projectPointOnWall(wall, room.vertices, worldPoint);
              moveOpeningAlongWall(o.id, t);
            }}
            onMouseDown={(e) => {
              if (!interactive || wallTool !== 'select') return;
              e.cancelBubble = true;
              selectWallEntity({ type: 'opening', id: o.id });
            }}
          >
            {/* Gap fill (matches page background so the wall reads as cut open) */}
            <Rect x={-wPx / 2} y={-tPx / 2} width={wPx} height={tPx} fill={BG} listening={false} />

            {o.kind === 'window' ? (
              <>
                <Rect
                  x={-wPx / 2}
                  y={-tPx / 2}
                  width={wPx}
                  height={tPx}
                  fill="rgba(120,180,255,0.22)"
                  stroke={selected ? WALL_COLOR_SELECTED : '#6fa8ff'}
                  strokeWidth={selected ? 2 : 1.5}
                />
                <Line points={[-wPx / 2, 0, wPx / 2, 0]} stroke="#6fa8ff" strokeWidth={1} />
              </>
            ) : (
              <>
                {/* Door leaf + swing arc */}
                <Line
                  points={[swingSign * -wPx / 2, 0, swingSign * -wPx / 2, flipSign * wPx]}
                  stroke={selected ? WALL_COLOR_SELECTED : '#c9a876'}
                  strokeWidth={2}
                />
                <Arc
                  x={swingSign * -wPx / 2}
                  y={0}
                  innerRadius={wPx}
                  outerRadius={wPx}
                  angle={90}
                  rotation={flipSign > 0 ? (swingSign > 0 ? 0 : -90) : swingSign > 0 ? -90 : 180}
                  stroke={selected ? WALL_COLOR_SELECTED : 'rgba(201,168,118,0.6)'}
                  strokeWidth={1}
                  dash={[4, 3]}
                />
                <Rect
                  x={-wPx / 2}
                  y={-tPx / 2}
                  width={wPx}
                  height={tPx}
                  stroke={selected ? WALL_COLOR_SELECTED : 'transparent'}
                  strokeWidth={selected ? 2 : 0}
                />
              </>
            )}
          </Group>
        );
      })}

      {/* Vertex drag handles (Wall Designer Mode + select tool only) */}
      {interactive &&
        wallTool === 'select' &&
        Object.values(room.vertices).map((v) => {
          const selected = wallSelection?.type === 'vertex' && wallSelection.id === v.id;
          return (
            <Circle
              key={`handle-${v.id}`}
              x={v.x * px}
              y={v.y * px}
              radius={6}
              fill={selected ? WALL_COLOR_SELECTED : 'rgba(255,255,255,0.85)'}
              stroke={selected ? '#fff' : 'rgba(0,0,0,0.3)'}
              strokeWidth={1.5}
              draggable
              onMouseDown={(e) => {
                e.cancelBubble = true;
                selectWallEntity({ type: 'vertex', id: v.id });
              }}
              onDragMove={(e) => {
                moveVertex(v.id, e.target.x() / px, e.target.y() / px);
              }}
            />
          );
        })}

      {/* Live drawing preview + dimension label */}
      {wallTool === 'draw' && wallDraft && wallCursorIn && (
        <DrawPreview room={room} px={px} units={units} lastVertexId={wallDraft.lastVertexId} cursor={wallCursorIn} />
      )}
      {wallTool === 'draw' && !wallDraft && wallCursorIn && (
        <Circle x={wallCursorIn.x * px} y={wallCursorIn.y * px} radius={5} fill="rgba(79,140,255,0.6)" listening={false} />
      )}
    </Group>
  );
}

function DrawPreview({
  room,
  px,
  units,
  lastVertexId,
  cursor,
}: {
  room: Room;
  px: number;
  units: Unit;
  lastVertexId: string;
  cursor: { x: number; y: number };
}) {
  const from = room.vertices[lastVertexId];
  if (!from) return null;
  const dx = cursor.x - from.x;
  const dy = cursor.y - from.y;
  const lengthIn = Math.hypot(dx, dy);
  const angleDeg = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
  const midX = ((from.x + cursor.x) / 2) * px;
  const midY = ((from.y + cursor.y) / 2) * px;

  return (
    <>
      <Line
        points={[from.x * px, from.y * px, cursor.x * px, cursor.y * px]}
        stroke="#4f8cff"
        strokeWidth={2}
        dash={[8, 6]}
        listening={false}
      />
      <Circle x={cursor.x * px} y={cursor.y * px} radius={5} fill="#4f8cff" listening={false} />
      <Group x={midX} y={midY - 14} listening={false}>
        <Rect x={-38} y={-11} width={76} height={20} cornerRadius={5} fill="rgba(10,13,20,0.85)" />
        <Text
          x={-38}
          y={-11}
          width={76}
          height={20}
          align="center"
          verticalAlign="middle"
          text={`${formatLength(lengthIn, units)} · ${angleDeg}°`}
          fontSize={11}
          fontFamily="Inter, sans-serif"
          fill="#eef1f7"
        />
      </Group>
    </>
  );
}
