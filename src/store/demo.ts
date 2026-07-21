import type { RoomObject, Item, Tag, Room, WallVertex, WallSegment, WallOpening } from '../types';
import { computeFloors } from '../lib/walls';

function rectLoop(x0: number, y0: number, x1: number, y1: number, thickness: number) {
  const v = (x: number, y: number): WallVertex => ({ id: `vtx-${x}-${y}-${Math.random().toString(36).slice(2, 6)}`, x, y });
  const vTL = v(x0, y0);
  const vTR = v(x1, y0);
  const vBR = v(x1, y1);
  const vBL = v(x0, y1);
  const vertices: Record<string, WallVertex> = { [vTL.id]: vTL, [vTR.id]: vTR, [vBR.id]: vBR, [vBL.id]: vBL };
  const mk = (a: string, b: string): WallSegment => ({
    id: `wall-${a.slice(0, 4)}-${b.slice(0, 4)}-${Math.random().toString(36).slice(2, 6)}`,
    a,
    b,
    thickness,
    curved: false,
    curveOffset: 0,
  });
  const wTop = mk(vTL.id, vTR.id);
  const wRight = mk(vTR.id, vBR.id);
  const wBottom = mk(vBR.id, vBL.id);
  const wLeft = mk(vBL.id, vTL.id);
  const walls: Record<string, WallSegment> = {
    [wTop.id]: wTop,
    [wRight.id]: wRight,
    [wBottom.id]: wBottom,
    [wLeft.id]: wLeft,
  };
  return { vertices, walls, wTop, wRight, wBottom, wLeft };
}

/** Seed content so a first-time user lands in a furnished, multi-room project. */
export function buildDemo(): {
  rooms: Record<string, Room>;
  roomOrder: string[];
  activeRoomId: string;
  tags: Record<string, Tag>;
} {
  const tags: Record<string, Tag> = {
    'tag-elec': { id: 'tag-elec', name: 'Electronics', color: '#4f8cff' },
    'tag-tools': { id: 'tag-tools', name: 'Tools', color: '#39c07a' },
    'tag-print': { id: 'tag-print', name: '3D Printing', color: '#ff9f45' },
    'tag-net': { id: 'tag-net', name: 'Networking', color: '#a678f0' },
    'tag-office': { id: 'tag-office', name: 'Office', color: '#8b95a7' },
  };

  // ---------------- Lab room ----------------
  const lab = rectLoop(0, 0, 280, 220, 6);
  const labDoor: WallOpening = {
    id: 'open-lab-door',
    wallId: lab.wBottom.id,
    kind: 'door',
    t: 0.5,
    width: 36,
  };
  const labWindow: WallOpening = {
    id: 'open-lab-window',
    wallId: lab.wTop.id,
    kind: 'window',
    t: 0.3,
    width: 48,
  };

  const desk: RoomObject = {
    id: 'obj-desk',
    name: 'Desk',
    kind: 'container',
    x: 60,
    y: 40,
    width: 60,
    height: 30,
    depthIn: 29,
    rotation: 0,
    fill: '#3b4a63',
    cornerRadius: 6,
    notes: 'Main work desk',
    layerId: 'layer-main-lab',
    storage: {
      type: 'grid',
      rows: 1,
      cols: 3,
      rowFractions: [1],
      colFractions: [1.4, 1, 1],
      cells: {
        '0:0': { name: 'Surface', kind: 'shelf' },
        '0:1': { name: 'Left Drawer', kind: 'drawer' },
        '0:2': { name: 'Right Drawer', kind: 'drawer' },
      },
    },
  };

  const shelf: RoomObject = {
    id: 'obj-shelf',
    name: 'Parts Shelf',
    kind: 'container',
    x: 150,
    y: 40,
    width: 40,
    height: 14,
    depthIn: 72,
    rotation: 0,
    fill: '#4a3b5f',
    cornerRadius: 6,
    notes: '',
    layerId: 'layer-main-lab',
    storage: {
      type: 'grid',
      rows: 3,
      cols: 2,
      rowFractions: [1, 1, 1],
      colFractions: [1, 1],
      cells: {
        '0:0': { name: 'Bin A', kind: 'drawer' },
        '0:1': { name: 'Bin B', kind: 'drawer' },
        '1:0': { name: 'Bin C', kind: 'drawer' },
        '1:1': { name: 'Bin D', kind: 'drawer' },
        '2:0': { name: 'Shelf Low L', kind: 'shelf' },
        '2:1': { name: 'Shelf Low R', kind: 'shelf' },
      },
    },
  };

  const table: RoomObject = {
    id: 'obj-table',
    name: 'Workbench',
    kind: 'roundedRect',
    x: 60,
    y: 110,
    width: 72,
    height: 30,
    depthIn: 34,
    rotation: 0,
    fill: '#334',
    cornerRadius: 10,
    notes: '',
    layerId: 'layer-main-lab',
    storage: { type: 'single' },
  };

  const labObjects: Record<string, RoomObject> = {
    'obj-desk': desk,
    'obj-shelf': shelf,
    'obj-table': table,
  };

  const now = Date.now();
  const mk = (
    id: string,
    name: string,
    objectId: string,
    cellKey: string,
    order: number,
    tagIds: string[],
    quantity = 1,
    extra: Partial<Item> = {},
  ): Item => ({
    id,
    name,
    quantity,
    tagIds,
    createdAt: now - order * 1000,
    updatedAt: now - order * 1000,
    objectId,
    cellKey,
    order,
    ...extra,
  });

  const labItems: Record<string, Item> = {};
  const push = (map: Record<string, Item>, it: Item) => {
    map[it.id] = it;
  };

  push(labItems, mk('i1', 'Arduino Uno', 'obj-shelf', '0:0', 0, ['tag-elec'], 4, { widthIn: 2.7, heightIn: 2.1, depthIn: 0.6 }));
  push(labItems, mk('i2', 'ESP32 Dev Board', 'obj-shelf', '0:0', 1, ['tag-elec'], 6));
  push(labItems, mk('i3', 'Breadboard', 'obj-shelf', '0:0', 2, ['tag-elec'], 3));
  push(labItems, mk('i4', 'Jumper Wires', 'obj-shelf', '0:0', 3, ['tag-elec'], 1));

  push(labItems, mk('i5', 'SSD 1TB', 'obj-shelf', '0:1', 0, ['tag-elec'], 2, { value: 89 }));
  push(labItems, mk('i6', 'USB-C Cables', 'obj-shelf', '0:1', 1, ['tag-elec'], 8));
  push(labItems, mk('i7', 'Ethernet Adapter', 'obj-shelf', '0:1', 2, ['tag-net'], 2));

  push(labItems, mk('i8', 'Screwdriver Set', 'obj-shelf', '1:0', 0, ['tag-tools'], 1));
  push(labItems, mk('i9', 'Digital Calipers', 'obj-shelf', '1:0', 1, ['tag-tools'], 1));
  push(labItems, mk('i10', 'Soldering Iron', 'obj-shelf', '1:1', 0, ['tag-tools', 'tag-elec'], 1));

  push(labItems, mk('i11', 'PLA Filament — Black', 'obj-shelf', '2:0', 0, ['tag-print'], 3));
  push(labItems, mk('i12', 'PLA Filament — White', 'obj-shelf', '2:0', 1, ['tag-print'], 2));
  push(labItems, mk('i13', 'Nozzles 0.4mm', 'obj-shelf', '2:1', 0, ['tag-print'], 10));

  push(labItems, mk('i14', 'Cat6 Cable 25ft', 'obj-desk', '0:1', 0, ['tag-net'], 3));
  push(labItems, mk('i15', 'Network Switch', 'obj-desk', '0:1', 1, ['tag-net'], 1));

  push(labItems, mk('i16', 'Sticky Notes', 'obj-desk', '0:2', 0, ['tag-office'], 5));
  push(labItems, mk('i17', 'Pens', 'obj-desk', '0:2', 1, ['tag-office'], 12));

  push(labItems, mk('i18', 'Mechanical Keyboard', 'obj-desk', '0:0', 0, ['tag-elec', 'tag-office'], 1));
  push(labItems, mk('i19', 'Monitor', 'obj-desk', '0:0', 1, ['tag-elec'], 2));

  const labRoom: Room = {
    id: 'room-lab',
    name: 'Lab',
    order: 0,
    notes: 'Main electronics lab',
    objects: labObjects,
    items: labItems,
    layers: [
      { id: 'layer-walls-lab', name: 'Walls', visible: true, kind: 'wall' },
      { id: 'layer-main-lab', name: 'Room', visible: true, kind: 'object' },
    ],
    activeLayerId: 'layer-main-lab',
    vertices: lab.vertices,
    walls: lab.walls,
    openings: { [labDoor.id]: labDoor, [labWindow.id]: labWindow },
    floors: computeFloors(lab.vertices, lab.walls),
    floorColor: '#1c2740',
    floorOpacity: 1,
    camera: { x: 160, y: 140, scale: 1 },
    blueprint: null,
  };

  // ---------------- Storage Room ----------------
  const storage = rectLoop(0, 0, 200, 150, 6);
  const storageDoor: WallOpening = {
    id: 'open-storage-door',
    wallId: storage.wLeft.id,
    kind: 'door',
    t: 0.5,
    width: 32,
  };

  const rack: RoomObject = {
    id: 'obj-rack',
    name: 'Storage Rack',
    kind: 'container',
    x: 30,
    y: 30,
    width: 60,
    height: 18,
    depthIn: 60,
    rotation: 0,
    fill: '#3b5f4a',
    cornerRadius: 4,
    notes: '',
    layerId: 'layer-main-storage',
    storage: {
      type: 'grid',
      rows: 2,
      cols: 3,
      rowFractions: [1, 1],
      colFractions: [1, 1, 1],
      cells: {
        '0:0': { name: 'Box 1', kind: 'shelf' },
        '0:1': { name: 'Box 2', kind: 'shelf' },
        '0:2': { name: 'Box 3', kind: 'shelf' },
        '1:0': { name: 'Box 4', kind: 'shelf' },
        '1:1': { name: 'Box 5', kind: 'shelf' },
        '1:2': { name: 'Box 6', kind: 'shelf' },
      },
    },
  };

  const storageItems: Record<string, Item> = {};
  push(storageItems, mk('i20', 'Spare Cables Bin', 'obj-rack', '0:0', 0, ['tag-elec'], 1));
  push(storageItems, mk('i21', 'Cardboard Boxes', 'obj-rack', '0:1', 0, ['tag-office'], 15));
  push(storageItems, mk('i22', 'Extra Filament Spools', 'obj-rack', '1:0', 0, ['tag-print'], 6));

  const storageRoom: Room = {
    id: 'room-storage',
    name: 'Storage Room',
    order: 1,
    notes: '',
    objects: { 'obj-rack': rack },
    items: storageItems,
    layers: [
      { id: 'layer-walls-storage', name: 'Walls', visible: true, kind: 'wall' },
      { id: 'layer-main-storage', name: 'Room', visible: true, kind: 'object' },
    ],
    activeLayerId: 'layer-main-storage',
    vertices: storage.vertices,
    walls: storage.walls,
    openings: { [storageDoor.id]: storageDoor },
    floors: computeFloors(storage.vertices, storage.walls),
    floorColor: '#241c30',
    floorOpacity: 1,
    camera: { x: 160, y: 140, scale: 1 },
    blueprint: null,
  };

  return {
    rooms: { [labRoom.id]: labRoom, [storageRoom.id]: storageRoom },
    roomOrder: [labRoom.id, storageRoom.id],
    activeRoomId: labRoom.id,
    tags,
  };
}
