import { useMemo } from 'react';
import { Search, X, MapPin } from 'lucide-react';
import { useStore } from '../store/store';
import { itemMatches } from '../lib/selectors';
import { cellName } from '../lib/shelf';

export default function SearchBar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const items = useStore((s) => s.items);
  const objects = useStore((s) => s.objects);
  const tags = useStore((s) => s.tags);
  const open = useStore((s) => s.open);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    return Object.values(items)
      .filter((i) => itemMatches(i, search, tags))
      .slice(0, 8);
  }, [items, search, tags]);

  return (
    <div className="searchbar-wrap">
      <div className="searchbar glass">
        <Search size={16} className="search-icon" />
        <input
          className="search-input"
          placeholder="Search anything — items, tags, notes…"
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
          {results.map((it) => {
            const obj = objects[it.objectId];
            const where = obj ? `${obj.name} · ${cellName(obj, it.cellKey)}` : 'Unknown';
            return (
              <button
                key={it.id}
                className="search-result"
                onClick={() => open({ objectId: it.objectId, cellKey: it.cellKey })}
              >
                <div className="sr-thumb">
                  {it.image ? <img src={it.image} alt="" /> : it.name.slice(0, 1)}
                </div>
                <div className="sr-body">
                  <div className="sr-name">{it.name}</div>
                  <div className="sr-where">
                    <MapPin size={11} /> {where}
                  </div>
                </div>
                <div className="sr-qty">×{it.quantity}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
