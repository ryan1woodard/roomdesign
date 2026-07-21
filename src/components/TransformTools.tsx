import { useRef, useState } from 'react';
import { Group, Circle, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import type { RoomObject, Unit } from '../types';
import type { ObjectTool } from '../store/store';
import { formatLength } from '../lib/units';

const ACCENT = '#4f8cff';
const HANDLE_SCREEN_DIST = 60; // constant screen-px distance from the object's center
const ROTATE_SCREEN_RADIUS = 56;

interface Props {
  obj: RoomObject;
  px: number;
  zoomScale: number;
  tool: Extract<ObjectTool, 'move' | 'rotate'>;
  snapIn: number | null;
  units: Unit;
  onUpdate: (patch: Partial<RoomObject>) => void;
}

/** Small pill label used for the live readout while dragging a handle. */
function ReadoutLabel({ x, y, text, counterScale }: { x: number; y: number; text: string; counterScale: number }) {
  const w = Math.max(46, text.length * 7 + 16);
  return (
    <Group x={x} y={y} scaleX={counterScale} scaleY={counterScale} listening={false}>
      <Rect x={-w / 2} y={-12} width={w} height={24} cornerRadius={6} fill="rgba(10,13,20,0.92)" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
      <Text x={-w / 2} y={-12} width={w} height={24} align="center" verticalAlign="middle" text={text} fontSize={11} fontFamily="Inter, sans-serif" fontStyle="600" fill="#eef1f7" />
    </Group>
  );
}

/**
 * The exclusive way to move or rotate a selected object in Design Mode.
 * Renders on-canvas handles (move arrows or a rotate dial). Drag tracking
 * is done manually via `stage.getRelativePointerPosition()` (the same
 * technique used for wall drawing and shelf-divider dragging elsewhere in
 * this app) rather than Konva's own `draggable`/`dragBoundFunc`, whose
 * `pos` argument is reported in absolute stage pixels — a different space
 * than the plain world*px coordinates every object position is expressed
 * in here, which made the handles rotate/move by the wrong amount.
 */
export default function TransformTools({ obj, px, zoomScale, tool, snapIn, units, onUpdate }: Props) {
  const counterScale = 1 / Math.max(0.001, zoomScale);
  const centerX = (obj.x + obj.width / 2) * px;
  const centerY = (obj.y + obj.height / 2) * px;
  const dist = HANDLE_SCREEN_DIST * counterScale;
  const rotateRadius = ROTATE_SCREEN_RADIUS * counterScale;

  const [moveReadout, setMoveReadout] = useState<{ dx: number; dy: number } | null>(null);
  const [rotateReadout, setRotateReadout] = useState<number | null>(null);
  const cursorSet = useRef(false);

  const snap = (v: number) => (snapIn ? Math.round(v / snapIn) * snapIn : v);

  const setGrabCursor = (stage: Konva.Stage, grabbing: boolean) => {
    stage.container().style.cursor = grabbing ? 'grabbing' : '';
    cursorSet.current = grabbing;
  };

  const startMoveDrag = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, axis: 'both' | 'x' | 'y') => {
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;
    const startPointer = stage.getRelativePointerPosition();
    if (!startPointer) return;
    const startObj = { x: obj.x, y: obj.y };
    setGrabCursor(stage, true);
    setMoveReadout({ dx: 0, dy: 0 });

    const move = () => {
      const p = stage.getRelativePointerPosition();
      if (!p) return;
      const dxIn = axis === 'y' ? 0 : (p.x - startPointer.x) / px;
      const dyIn = axis === 'x' ? 0 : (p.y - startPointer.y) / px;
      const newX = snap(startObj.x + dxIn);
      const newY = snap(startObj.y + dyIn);
      onUpdate(axis === 'y' ? { y: newY } : axis === 'x' ? { x: newX } : { x: newX, y: newY });
      setMoveReadout({ dx: newX - startObj.x, dy: newY - startObj.y });
    };
    const up = () => {
      stage.off('mousemove.transform touchmove.transform', move);
      stage.off('mouseup.transform touchend.transform', up);
      setGrabCursor(stage, false);
      setMoveReadout(null);
    };
    stage.on('mousemove.transform touchmove.transform', move);
    stage.on('mouseup.transform touchend.transform', up);
  };

  const startRotateDrag = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;
    setGrabCursor(stage, true);
    setRotateReadout(obj.rotation);

    const move = () => {
      const p = stage.getRelativePointerPosition();
      if (!p) return;
      let deg = (Math.atan2(p.y - centerY, p.x - centerX) * 180) / Math.PI + 90;
      deg = Math.round(((deg % 360) + 360) % 360);
      onUpdate({ rotation: deg });
      setRotateReadout(deg);
    };
    const up = () => {
      stage.off('mousemove.transform touchmove.transform', move);
      stage.off('mouseup.transform touchend.transform', up);
      setGrabCursor(stage, false);
      setRotateReadout(null);
    };
    stage.on('mousemove.transform touchmove.transform', move);
    stage.on('mouseup.transform touchend.transform', up);
  };

  if (tool === 'move') {
    const handleFill = 'rgba(18,21,29,0.92)';

    return (
      <Group listening>
        {/* Axis guide lines */}
        <Line points={[centerX, centerY, centerX + dist, centerY]} stroke={ACCENT} strokeWidth={1.5} opacity={0.55} listening={false} />
        <Line points={[centerX, centerY, centerX, centerY + dist]} stroke={ACCENT} strokeWidth={1.5} opacity={0.55} listening={false} />

        {/* Free-move center handle */}
        <Group x={centerX} y={centerY} onMouseDown={(e) => startMoveDrag(e, 'both')} onTouchStart={(e) => startMoveDrag(e, 'both')}>
          <Circle radius={9 * counterScale} fill={handleFill} stroke={ACCENT} strokeWidth={2 * counterScale} />
          <Line points={[-4 * counterScale, 0, 4 * counterScale, 0]} stroke={ACCENT} strokeWidth={1.5 * counterScale} listening={false} />
          <Line points={[0, -4 * counterScale, 0, 4 * counterScale]} stroke={ACCENT} strokeWidth={1.5 * counterScale} listening={false} />
        </Group>

        {/* X-axis handle (horizontal-only) */}
        <Group x={centerX + dist} y={centerY} onMouseDown={(e) => startMoveDrag(e, 'x')} onTouchStart={(e) => startMoveDrag(e, 'x')}>
          <Group scaleX={counterScale} scaleY={counterScale}>
            <Line points={[-8, -6, 8, 0, -8, 6]} closed fill={ACCENT} stroke={ACCENT} />
          </Group>
        </Group>

        {/* Y-axis handle (vertical-only) */}
        <Group x={centerX} y={centerY + dist} onMouseDown={(e) => startMoveDrag(e, 'y')} onTouchStart={(e) => startMoveDrag(e, 'y')}>
          <Group scaleX={counterScale} scaleY={counterScale} rotation={90}>
            <Line points={[-8, -6, 8, 0, -8, 6]} closed fill={ACCENT} stroke={ACCENT} />
          </Group>
        </Group>

        {moveReadout && (
          <ReadoutLabel
            x={centerX + dist * 0.5}
            y={centerY - 20 * counterScale}
            counterScale={counterScale}
            text={`${moveReadout.dx >= 0 ? '+' : ''}${formatLength(moveReadout.dx, units)}, ${moveReadout.dy >= 0 ? '+' : ''}${formatLength(moveReadout.dy, units)}`}
          />
        )}
      </Group>
    );
  }

  // Rotate tool.
  const handleAngleRad = ((obj.rotation - 90) * Math.PI) / 180;
  const hx = centerX + rotateRadius * Math.cos(handleAngleRad);
  const hy = centerY + rotateRadius * Math.sin(handleAngleRad);

  return (
    <Group listening>
      <Circle x={centerX} y={centerY} radius={rotateRadius} stroke={ACCENT} strokeWidth={1.5} opacity={0.45} dash={[5, 5]} listening={false} />
      <Line points={[centerX, centerY, hx, hy]} stroke={ACCENT} strokeWidth={1.5} opacity={0.55} listening={false} />
      <Group x={hx} y={hy} onMouseDown={startRotateDrag} onTouchStart={startRotateDrag}>
        <Circle radius={9 * counterScale} fill="rgba(18,21,29,0.92)" stroke={ACCENT} strokeWidth={2 * counterScale} />
      </Group>

      {rotateReadout !== null && (
        <ReadoutLabel x={hx} y={hy - 26 * counterScale} counterScale={counterScale} text={`${rotateReadout}°`} />
      )}
    </Group>
  );
}
