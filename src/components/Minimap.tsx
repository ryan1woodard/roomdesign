import { useMemo, useState } from 'react';
import { Map } from 'lucide-react';
import type { Room } from '../types';
import { computeVisibleBounds } from '../lib/bounds';

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface Props {
  room: Room;
  cam: Camera;
  viewportW: number;
  viewportH: number;
  px: number;
  onJump: (cam: Camera) => void;
}

const MM_W = 190;
const MM_H = 130;
const PAD = 40;

export default function Minimap({ room, cam, viewportW, viewportH, px, onJump }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const bounds = useMemo(() => {
    const b = computeVisibleBounds(room);
    if (!b) return { minX: -PAD, minY: -PAD, maxX: 200 + PAD, maxY: 200 + PAD };
    return { minX: b.minX - PAD, minY: b.minY - PAD, maxX: b.maxX + PAD, maxY: b.maxY + PAD };
  }, [room]);

  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const mmScale = Math.min(MM_W / bw, MM_H / bh);

  const toMM = (x: number, y: number) => ({ x: (x - bounds.minX) * mmScale, y: (y - bounds.minY) * mmScale });

  const visMinX = -cam.x / (cam.scale * px);
  const visMinY = -cam.y / (cam.scale * px);
  const visMaxX = (viewportW - cam.x) / (cam.scale * px);
  const visMaxY = (viewportH - cam.y) / (cam.scale * px);
  const vp0 = toMM(visMinX, visMinY);
  const vp1 = toMM(visMaxX, visMaxY);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const worldX = clickX / mmScale + bounds.minX;
    const worldY = clickY / mmScale + bounds.minY;
    onJump({
      scale: cam.scale,
      x: viewportW / 2 - worldX * px * cam.scale,
      y: viewportH / 2 - worldY * px * cam.scale,
    });
  };

  if (collapsed) {
    return (
      <button className="minimap-collapsed glass" onClick={() => setCollapsed(false)} title="Show minimap">
        <Map size={16} />
      </button>
    );
  }

  return (
    <div className="minimap glass">
      <button className="minimap-toggle" onClick={() => setCollapsed(true)} title="Hide minimap">
        <Map size={13} />
      </button>
      <svg width={MM_W} height={MM_H} viewBox={`0 0 ${MM_W} ${MM_H}`} onClick={handleClick} style={{ cursor: 'pointer' }}>
        <rect x={0} y={0} width={MM_W} height={MM_H} fill="var(--bg-1)" rx={6} />
        {Object.values(room.walls).map((wallSeg) => {
          const a = room.vertices[wallSeg.a];
          const b = room.vertices[wallSeg.b];
          if (!a || !b) return null;
          const pa = toMM(a.x, a.y);
          const pb = toMM(b.x, b.y);
          return <line key={wallSeg.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#8b95a8" strokeWidth={1.5} />;
        })}
        {Object.values(room.objects).map((obj) => {
          const p = toMM(obj.x, obj.y);
          return (
            <rect
              key={obj.id}
              x={p.x}
              y={p.y}
              width={Math.max(1, obj.width * mmScale)}
              height={Math.max(1, obj.height * mmScale)}
              fill={obj.fill === 'transparent' ? '#4f8cff' : obj.fill}
              opacity={0.9}
              rx={1}
            />
          );
        })}
        <rect
          x={Math.min(vp0.x, vp1.x)}
          y={Math.min(vp0.y, vp1.y)}
          width={Math.abs(vp1.x - vp0.x)}
          height={Math.abs(vp1.y - vp0.y)}
          fill="rgba(79,140,255,0.12)"
          stroke="#4f8cff"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
