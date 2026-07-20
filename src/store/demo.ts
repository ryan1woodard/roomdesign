import type { RoomObject, Item, Tag, Layer } from '../types';

/** Seed content so a first-time user lands in a furnished room, not a void. */
export function buildDemo(): {
  objects: Record<string, RoomObject>;
  items: Record<string, Item>;
  tags: Record<string, Tag>;
  layers: Layer[];
} {
  const layers: Layer[] = [
    { id: 'layer-main', name: 'Room', visible: true },
    { id: 'layer-walls', name: 'Walls', visible: true },
  ];

  const tags: Record<string, Tag> = {
    'tag-elec': { id: 'tag-elec', name: 'Electronics', color: '#4f8cff' },
    'tag-tools': { id: 'tag-tools', name: 'Tools', color: '#39c07a' },
    'tag-print': { id: 'tag-print', name: '3D Printing', color: '#ff9f45' },
    'tag-net': { id: 'tag-net', name: 'Networking', color: '#a678f0' },
    'tag-office': { id: 'tag-office', name: 'Office', color: '#8b95a7' },
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
    layerId: 'layer-main',
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
    layerId: 'layer-main',
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
    y: 100,
    width: 72,
    height: 30,
    depthIn: 34,
    rotation: 0,
    fill: '#334',
    cornerRadius: 10,
    notes: '',
    layerId: 'layer-main',
    storage: { type: 'single' },
  };

  const objects: Record<string, RoomObject> = {
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

  const items: Record<string, Item> = {};
  const push = (it: Item) => {
    items[it.id] = it;
  };

  push(mk('i1', 'Arduino Uno', 'obj-shelf', '0:0', 0, ['tag-elec'], 4, { widthIn: 2.7, heightIn: 2.1, depthIn: 0.6 }));
  push(mk('i2', 'ESP32 Dev Board', 'obj-shelf', '0:0', 1, ['tag-elec'], 6));
  push(mk('i3', 'Breadboard', 'obj-shelf', '0:0', 2, ['tag-elec'], 3));
  push(mk('i4', 'Jumper Wires', 'obj-shelf', '0:0', 3, ['tag-elec'], 1));

  push(mk('i5', 'SSD 1TB', 'obj-shelf', '0:1', 0, ['tag-elec'], 2, { value: 89 }));
  push(mk('i6', 'USB-C Cables', 'obj-shelf', '0:1', 1, ['tag-elec'], 8));
  push(mk('i7', 'Ethernet Adapter', 'obj-shelf', '0:1', 2, ['tag-net'], 2));

  push(mk('i8', 'Screwdriver Set', 'obj-shelf', '1:0', 0, ['tag-tools'], 1));
  push(mk('i9', 'Digital Calipers', 'obj-shelf', '1:0', 1, ['tag-tools'], 1));
  push(mk('i10', 'Soldering Iron', 'obj-shelf', '1:1', 0, ['tag-tools', 'tag-elec'], 1));

  push(mk('i11', 'PLA Filament — Black', 'obj-shelf', '2:0', 0, ['tag-print'], 3));
  push(mk('i12', 'PLA Filament — White', 'obj-shelf', '2:0', 1, ['tag-print'], 2));
  push(mk('i13', 'Nozzles 0.4mm', 'obj-shelf', '2:1', 0, ['tag-print'], 10));

  push(mk('i14', 'Cat6 Cable 25ft', 'obj-desk', '0:1', 0, ['tag-net'], 3));
  push(mk('i15', 'Network Switch', 'obj-desk', '0:1', 1, ['tag-net'], 1));

  push(mk('i16', 'Sticky Notes', 'obj-desk', '0:2', 0, ['tag-office'], 5));
  push(mk('i17', 'Pens', 'obj-desk', '0:2', 1, ['tag-office'], 12));

  push(mk('i18', 'Mechanical Keyboard', 'obj-desk', '0:0', 0, ['tag-elec', 'tag-office'], 1));
  push(mk('i19', 'Monitor', 'obj-desk', '0:0', 1, ['tag-elec'], 2));

  return { objects, items, tags, layers };
}
