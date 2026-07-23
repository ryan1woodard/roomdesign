import { useMemo } from 'react';
import { Search, X, MapPin, PackageCheck } from 'lucide-react';
import { useStore } from '../store/store';
import { itemMatches, checkoutsForItem } from '../lib/selectors';
import { cellName } from '../lib/shelf';
import type { Item, Room } from '../types';

interface CrossRoomHit {
  item: Item;
  room: Room;
  objectName: string;
  cellLabel: string;
  /** e.g. "2 with Alice, 1 with Bob" — so a searcher knows who to ask
   * even when the physical stock is checked out. */
  checkoutNote: string;
}

export default function SearchBar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const rooms = useStore((s) => s.rooms);
  const roomOrder = useStore((s) => s.roomOrder);
  const tags = useStore((s) => s.tags);
  const checkouts = useStore((s) => s.checkouts);
  const open = useStore((s) => s.open);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const activeRoomId = useStore((s) => s.activeRoomId);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const hits: CrossRoomHit[] = [];
    for (const roomId of roomOrder) {
      const room = rooms[roomId];
      for (const it of Object.values(room.items)) {
        if (!itemMatches(it, search, tags)) continue;
        const obj = room.objects[it.objectId];
        const takenBy = checkoutsForItem(checkouts, it.id);
        hits.push({
          item: it,
          room,
          objectName: obj?.name ?? 'Unknown',
          cellLabel: obj ? cellName(obj, it.cellKey) : '',
          checkoutNote: takenBy.map((c) => `${c.quantity} with ${c.userName}`).join(', '),
        });
      }
    }
    return hits.slice(0, 8);
  }, [rooms, roomOrder, search, tags, checkouts]);

  const goTo = (hit: CrossRoomHit) => {
    if (hit.room.id !== activeRoomId) setActiveRoom(hit.room.id);
    open({ objectId: hit.item.objectId, cellKey: hit.item.cellKey });
  };

  return (
    <div className="searchbar-wrap">
      <div className="searchbar glass">
        <Search size={16} className="search-icon" />
        <input
          id="global-search-input"
          className="search-input"
          placeholder="Search anything…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="btn icon" onClick={() => setSearch('')}>
            <X size={15} />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="search-results glass">
          {results.map((hit) => (
            <button key={hit.item.id} className="search-result" onClick={() => goTo(hit)}>
              <div className="sr-thumb">
                {hit.item.image ? <img src={hit.item.image} alt="" /> : hit.item.name.slice(0, 1)}
              </div>
              <div className="sr-body">
                <div className="sr-name">{hit.item.name}</div>
                <div className="sr-where">
                  <MapPin size={11} /> {hit.room.name} · {hit.objectName} · {hit.cellLabel}
                </div>
                {hit.checkoutNote && (
                  <div className="sr-checkout">
                    <PackageCheck size={11} /> {hit.checkoutNote}
                  </div>
                )}
              </div>
              <div className="sr-qty">×{hit.item.quantity}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
