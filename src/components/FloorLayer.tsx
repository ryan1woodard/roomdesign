import { Line } from 'react-konva';
import type { Room } from '../types';

interface Props {
  room: Room;
  px: number;
  visible: boolean;
}

/** The room's floor fill, split out from WallLayer so it can render at the
 * very bottom of the stage — beneath every object layer — while the walls
 * themselves render above everything (see WallLayer) so nothing can ever
 * shadow onto a wall, and a wall's own shadow always falls over the room. */
export default function FloorLayer({ room, px, visible }: Props) {
  if (!visible) return null;
  return (
    <>
      {room.floors.map((f) => {
        const pts = f.vertexIds.flatMap((vid) => {
          const v = room.vertices[vid];
          return v ? [v.x * px, v.y * px] : [];
        });
        return <Line key={f.id} points={pts} closed fill={room.floorColor} opacity={room.floorOpacity} listening={false} />;
      })}
    </>
  );
}
