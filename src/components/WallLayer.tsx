import { useMemo, useState } from 'react';
import Konva from 'konva';
import { Group, Line, Circle, Rect, Text } from 'react-konva';
import type { Room, WallSegment, WallOpening, WallVertex } from '../types';
import { useStore, type WallTool, type WallEntitySelection } from '../store/store';
import {
  wallRenderSegments,
  wallPointAt,
  wallAngleAt,
  sampleWallPoints,
  projectPointOnWall,
  computeWallOutwardNormals,
  outwardShiftedEndpoints,
  type Normal,
} from '../lib/walls';
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
  /** The vertex the draw cursor is currently snapped onto, if any — highlighted so snapping feels predictable. */
  snapTargetVertexId?: string | null;
  visible: boolean;
  /** Whether Wall Designer Mode is actually active (the Walls layer is the active layer). */
  interactive: boolean;
}

function wallColor(wall: WallSegment, sel: WallEntitySelection) {
  return sel && sel.type === 'wall' && sel.id === wall.id ? WALL_COLOR_SELECTED : WALL_COLOR;
}

/** Build a tiny two-entry vertices map so the shared geometry helpers (which
 * key off vertex id) can be reused with the outward-shifted render points. */
function synthVertices(wall: WallSegment, pts: { a: WallVertex; b: WallVertex }): Record<string, WallVertex> {
  return { [wall.a]: pts.a, [wall.b]: pts.b };
}

export default function WallLayer({ room, px, units, wallTool, wallSelection, wallCursorIn, snapTargetVertexId, visible, interactive }: Props) {
  const selectWallEntity = useStore((s) => s.selectWallEntity);
  const moveVertex = useStore((s) => s.moveVertex);
  const splitWallAt = useStore((s) => s.splitWallAt);
  const addOpening = useStore((s) => s.addOpening);
  const moveOpeningAlongWall = useStore((s) => s.moveOpeningAlongWall);
  const wallDraft = useStore((s) => s.wallDraft);
  const [hoveredOpeningId, setHoveredOpeningId] = useState<string | null>(null);
  const [hoveredVertexId, setHoveredVertexId] = useState<string | null>(null);

  const openingsByWall = useMemo(() => {
    const map: Record<string, WallOpening[]> = {};
    for (const o of Object.values(room.openings)) {
      (map[o.wallId] ??= []).push(o);
    }
    return map;
  }, [room.openings]);

  // Walls are drawn as the *interior* face; thickness always extends outward
  // from there, so measuring the inside of a room never changes when you
  // adjust a wall's thickness.
  const outwardNormals = useMemo(
    () => computeWallOutwardNormals(room.vertices, room.walls, room.floors),
    [room.vertices, room.walls, room.floors],
  );
  const renderEndpoints = useMemo(() => {
    const map: Record<string, { a: WallVertex; b: WallVertex }> = {};
    for (const wall of Object.values(room.walls)) {
      map[wall.id] = outwardShiftedEndpoints(wall, room.vertices, outwardNormals);
    }
    return map;
  }, [room.walls, room.vertices, outwardNormals]);

  // Vertex joints: shift toward the average outward direction of connected
  // walls so the corner visually meets the shifted wall rectangles; vertices
  // with no outward-facing wall (open chains) stay centered as before.
  const jointRender = useMemo(() => {
    const radius: Record<string, number> = {};
    const normalSum: Record<string, Normal> = {};
    for (const w of Object.values(room.walls)) {
      radius[w.a] = Math.max(radius[w.a] ?? 0, w.thickness / 2);
      radius[w.b] = Math.max(radius[w.b] ?? 0, w.thickness / 2);
      const n = outwardNormals[w.id];
      if (n) {
        for (const vid of [w.a, w.b]) {
          const cur = normalSum[vid] ?? { x: 0, y: 0 };
          normalSum[vid] = { x: cur.x + n.x, y: cur.y + n.y };
        }
      }
    }
    const map: Record<string, { x: number; y: number; r: number }> = {};
    for (const v of Object.values(room.vertices)) {
      const r = radius[v.id] ?? 0;
      const sum = normalSum[v.id];
      const len = sum ? Math.hypot(sum.x, sum.y) : 0;
      if (sum && len > 0.001) {
        map[v.id] = { x: v.x + (sum.x / len) * r, y: v.y + (sum.y / len) * r, r };
      } else {
        map[v.id] = { x: v.x, y: v.y, r };
      }
    }
    return map;
  }, [room.walls, room.vertices, outwardNormals]);

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

      {/* Walls */}
      {Object.values(room.walls).map((wall) => {
        const openings = openingsByWall[wall.id] ?? [];
        const rv = synthVertices(wall, renderEndpoints[wall.id]);
        const segments = wallRenderSegments(wall, rv, openings);
        const color = wallColor(wall, wallSelection);
        return (
          <Group key={wall.id}>
            {segments.map((seg, i) => {
              const pts = wall.curved
                ? sampleWallPoints(wall, rv, seg.t0, seg.t1, 16).flatMap((p) => [p.x * px, p.y * px])
                : (() => {
                    const p0 = wallPointAt(wall, rv, seg.t0);
                    const p1 = wallPointAt(wall, rv, seg.t1);
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
      {Object.values(room.vertices).map((v) => {
        const j = jointRender[v.id];
        return (
          <Circle
            key={`joint-${v.id}`}
            x={j.x * px}
            y={j.y * px}
            radius={j.r * px}
            fill={WALL_COLOR}
            listening={false}
          />
        );
      })}

      {/* Openings: doors and windows */}
      {Object.values(room.openings).map((o) => {
        const wall = room.walls[o.wallId];
        if (!wall) return null;
        const rv = synthVertices(wall, renderEndpoints[wall.id]);
        const pt = wallPointAt(wall, rv, o.t);
        const angleDeg = (wallAngleAt(wall, rv, o.t) * 180) / Math.PI;
        const selected = wallSelection?.type === 'opening' && wallSelection.id === o.id;
        const hovered = hoveredOpeningId === o.id;
        const wPx = o.width * px;
        const tPx = wall.thickness * px;

        return (
          <Group key={o.id}>
            <Group
              x={pt.x * px}
              y={pt.y * px}
              rotation={angleDeg}
              listening
              draggable={interactive && wallTool === 'select'}
              dragBoundFunc={function (this: Konva.Node, pos) {
                // `pos` is in absolute (stage) pixel coordinates, which differ
                // from the local world*px space used everywhere else in this
                // file whenever the camera is panned/zoomed away from the
                // identity transform (the common case, since Fit to View runs
                // automatically on load). Converting through the stage's
                // absolute transform — rather than dividing by `px` directly —
                // keeps the opening constrained to the wall instead of
                // snapping to a wildly wrong, possibly off-screen position.
                const stage = this.getStage()!;
                const inverse = stage.getAbsoluteTransform().copy().invert();
                const local = inverse.point(pos);
                const worldPoint = { x: local.x / px, y: local.y / px };
                const t = projectPointOnWall(wall, room.vertices, worldPoint);
                const p = wallPointAt(wall, rv, t);
                return stage.getAbsoluteTransform().point({ x: p.x * px, y: p.y * px });
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
              onMouseEnter={() => setHoveredOpeningId(o.id)}
              onMouseLeave={() => setHoveredOpeningId((cur) => (cur === o.id ? null : cur))}
            >
              {/* Gap fill (matches page background so the wall reads as cut open).
                  Listening (not false) so hovering/clicking anywhere in the
                  opening's footprint reaches the group, not just its thin
                  border/centerline strokes. */}
              <Rect x={-wPx / 2} y={-tPx / 2} width={wPx} height={tPx} fill={BG} />

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
                  <Rect
                    x={-wPx / 2}
                    y={-tPx / 2}
                    width={wPx}
                    height={tPx}
                    stroke={selected ? WALL_COLOR_SELECTED : '#c9a876'}
                    strokeWidth={selected ? 2 : 1.5}
                  />
                  <Line points={[-wPx / 2, 0, wPx / 2, 0]} stroke="#c9a876" strokeWidth={1} dash={[5, 4]} />
                </>
              )}
            </Group>

            {/* Hover tooltip — upright regardless of the wall's angle. */}
            {hovered && (
              <Group x={pt.x * px} y={pt.y * px - tPx / 2 - 24} listening={false}>
                <Rect x={-46} y={-11} width={92} height={22} cornerRadius={5} fill="rgba(10,13,20,0.9)" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                <Text
                  x={-46}
                  y={-11}
                  width={92}
                  height={22}
                  align="center"
                  verticalAlign="middle"
                  text={`${o.kind === 'door' ? 'Door' : 'Window'} · ${formatLength(o.width, units)}`}
                  fontSize={11}
                  fontFamily="Inter, sans-serif"
                  fontStyle="600"
                  fill="#eef1f7"
                />
              </Group>
            )}
          </Group>
        );
      })}

      {/* Vertex drag handles (Wall Designer Mode + select tool only) */}
      {interactive &&
        wallTool === 'select' &&
        Object.values(room.vertices).map((v) => {
          const selected = wallSelection?.type === 'vertex' && wallSelection.id === v.id;
          const hovered = hoveredVertexId === v.id;
          const emphasized = selected || hovered;
          return (
            <Circle
              key={`handle-${v.id}`}
              x={v.x * px}
              y={v.y * px}
              radius={emphasized ? 9 : 6}
              fill={selected ? WALL_COLOR_SELECTED : hovered ? '#dce8ff' : 'rgba(255,255,255,0.85)'}
              stroke={selected ? '#fff' : hovered ? WALL_COLOR_SELECTED : 'rgba(0,0,0,0.3)'}
              strokeWidth={emphasized ? 2 : 1.5}
              shadowColor={WALL_COLOR_SELECTED}
              shadowBlur={hovered ? 10 : 0}
              shadowOpacity={0.9}
              draggable
              onMouseEnter={() => setHoveredVertexId(v.id)}
              onMouseLeave={() => setHoveredVertexId((cur) => (cur === v.id ? null : cur))}
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

      {/* Snap-target glow: the vertex the draw cursor is currently locked onto */}
      {wallTool === 'draw' &&
        snapTargetVertexId &&
        room.vertices[snapTargetVertexId] &&
        (() => {
          const v = room.vertices[snapTargetVertexId];
          return (
            <Circle
              key="snap-target"
              x={v.x * px}
              y={v.y * px}
              radius={11}
              fill="rgba(79,140,255,0.25)"
              stroke={WALL_COLOR_SELECTED}
              strokeWidth={2}
              shadowColor={WALL_COLOR_SELECTED}
              shadowBlur={14}
              shadowOpacity={0.95}
              listening={false}
            />
          );
        })()}

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
