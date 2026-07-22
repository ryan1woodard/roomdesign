import type { Item, Room, Tag } from '../types';
import { parseCsv, parseCsvRecords, toCsv } from './csv';
import { locationKeys, cellName } from './shelf';

export const INVENTORY_CSV_COLUMNS = [
  'id',
  'name',
  'quantity',
  'tags',
  'object',
  'cellKey',
  'notes',
  'value',
  'serial',
  'purchaseDate',
  'widthIn',
  'heightIn',
  'depthIn',
] as const;

function tagNames(item: Item, tags: Record<string, Tag>): string {
  return item.tagIds
    .map((id) => tags[id]?.name)
    .filter((n): n is string => !!n)
    .join('; ');
}

/** Serialize a room's inventory to CSV text (one row per item). */
export function itemsToCsv(room: Room, tags: Record<string, Tag>): string {
  const rows: string[][] = [[...INVENTORY_CSV_COLUMNS]];
  for (const item of Object.values(room.items)) {
    const obj = room.objects[item.objectId];
    rows.push([
      item.id,
      item.name,
      String(item.quantity),
      tagNames(item, tags),
      obj?.name ?? '',
      item.cellKey,
      item.notes ?? '',
      item.value !== undefined ? String(item.value) : '',
      item.serial ?? '',
      item.purchaseDate ?? '',
      item.widthIn !== undefined ? String(item.widthIn) : '',
      item.heightIn !== undefined ? String(item.heightIn) : '',
      item.depthIn !== undefined ? String(item.depthIn) : '',
    ]);
  }
  return toCsv(rows);
}

export function downloadInventoryCsv(room: Room, tags: Record<string, Tag>): void {
  const csv = itemsToCsv(room, tags);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${room.name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'Room'} inventory.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ImportedItemRow {
  /** Existing item id to update, or null to create a new item. */
  existingId: string | null;
  patch: Partial<Item>;
  /** Resolved object id the row's `object` column matched. */
  objectId: string;
  cellKey: string;
  /** Tag names from the row's `tags` column (may or may not already exist). */
  tagNames: string[];
}

export interface ImportResult {
  rows: ImportedItemRow[];
  /** Row numbers (1-based, header excluded) that couldn't be resolved to a valid object. */
  skipped: number[];
}

function numOrUndefined(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an inventory CSV export back into item patches, matching against the
 * room's current objects/tags. Rows whose `object` column doesn't match any
 * object in the room are skipped (reported by row number) rather than
 * silently corrupting the store with a dangling reference.
 */
export function parseInventoryCsv(text: string, room: Room): ImportResult {
  const records = parseCsvRecords(text);
  const objectsByName = new Map(Object.values(room.objects).map((o) => [o.name.trim().toLowerCase(), o]));

  const rows: ImportedItemRow[] = [];
  const skipped: number[] = [];

  records.forEach((rec, i) => {
    const objName = (rec.object ?? '').trim();
    const obj = objectsByName.get(objName.toLowerCase());
    if (!obj) {
      skipped.push(i + 1);
      return;
    }
    const validKeys = new Set(locationKeys(obj));
    const rawCellKey = (rec.cellKey ?? '').trim();
    const cellKey = validKeys.has(rawCellKey) ? rawCellKey : locationKeys(obj)[0];

    const tagCell = (rec.tags ?? '').trim();
    const tagNameList = tagCell ? tagCell.split(';').map((t) => t.trim()).filter(Boolean) : [];

    rows.push({
      existingId: rec.id && room.items[rec.id] ? rec.id : null,
      objectId: obj.id,
      cellKey,
      tagNames: tagNameList,
      patch: {
        name: rec.name?.trim() || 'Imported item',
        quantity: Math.max(1, Math.round(numOrUndefined(rec.quantity ?? '') ?? 1)),
        notes: rec.notes || undefined,
        value: numOrUndefined(rec.value ?? ''),
        serial: rec.serial || undefined,
        purchaseDate: rec.purchaseDate || undefined,
        widthIn: numOrUndefined(rec.widthIn ?? ''),
        heightIn: numOrUndefined(rec.heightIn ?? ''),
        depthIn: numOrUndefined(rec.depthIn ?? ''),
      },
    });
  });

  return { rows, skipped };
}

/** Quick structural check so a non-inventory CSV is rejected with a clear
 * message instead of silently importing garbage. */
export function looksLikeInventoryCsv(text: string): boolean {
  const rows = parseCsv(text);
  if (rows.length === 0) return false;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return header.includes('name') && header.includes('object');
}

// Re-exported for callers that just want the room/tag-independent id->label lookup.
export { cellName };
