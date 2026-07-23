import type { Item, Tag, SortMode, Checkout } from '../types';

export function itemsInLocation(
  items: Record<string, Item>,
  objectId: string,
  cellKey: string,
): Item[] {
  return Object.values(items).filter((i) => i.objectId === objectId && i.cellKey === cellKey);
}

/** Whether an item matches a free-text query (name, tags, notes, serial). */
export function itemMatches(item: Item, query: string, tags: Record<string, Tag>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.notes?.toLowerCase().includes(q)) return true;
  if (item.serial?.toLowerCase().includes(q)) return true;
  for (const t of item.tagIds) {
    if (tags[t]?.name.toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Object ids that contain at least one item matching the query. */
export function objectsMatchingSearch(
  items: Record<string, Item>,
  query: string,
  tags: Record<string, Tag>,
): Set<string> {
  const set = new Set<string>();
  if (!query.trim()) return set;
  for (const it of Object.values(items)) {
    if (itemMatches(it, query, tags)) set.add(it.objectId);
  }
  return set;
}

/** Every checkout (across all rooms) for a given item, regardless of who holds it. */
export function checkoutsForItem(checkouts: Record<string, Checkout>, itemId: string): Checkout[] {
  return Object.values(checkouts).filter((c) => c.itemId === itemId);
}

/** Every checkout a given user currently holds, across all rooms — their personal inventory. */
export function checkoutsForUser(checkouts: Record<string, Checkout>, userId: string): Checkout[] {
  return Object.values(checkouts).filter((c) => c.userId === userId);
}

export function sortItems(items: Item[], mode: SortMode, tags: Record<string, Tag>): Item[] {
  const arr = [...items];
  switch (mode) {
    case 'alpha':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'recent-added':
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    case 'recent-used':
      return arr.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    case 'quantity':
      return arr.sort((a, b) => b.quantity - a.quantity);
    case 'color': {
      const key = (i: Item) => tags[i.tagIds[0]]?.color ?? '~';
      return arr.sort((a, b) => key(a).localeCompare(key(b)));
    }
    case 'manual':
    default:
      return arr.sort((a, b) => a.order - b.order);
  }
}
