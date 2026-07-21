import { Package } from 'lucide-react';
import type { Item, Tag } from '../types';

interface Props {
  item: Item;
  tags: Record<string, Tag>;
  highlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

export default function ItemCard({ item, tags, highlighted, onClick, onDragStart }: Props) {
  const itemTags = item.tagIds.map((id) => tags[id]).filter(Boolean) as Tag[];
  const accent = itemTags[0]?.color ?? '#4f8cff';

  return (
    <div
      className={`item-card ${highlighted ? 'hit' : ''}`}
      style={{ ['--card-accent' as string]: accent }}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={item.name}
    >
      <div className="card-thumb">
        {item.image ? <img src={item.image} alt={item.name} /> : <Package size={26} strokeWidth={1.4} />}
        <span className="card-qty">×{item.quantity}</span>
      </div>
      <div className="card-body">
        <div className="card-name">{item.name}</div>
        <div className="card-tags">
          {itemTags.slice(0, 3).map((t) => (
            <span key={t.id} className="tag-chip" style={{ background: `${t.color}22`, color: t.color }}>
              <span className="dot" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
