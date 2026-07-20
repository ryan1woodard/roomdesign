import { Package } from 'lucide-react';
import type { Item, Tag } from '../types';
import { formatLength } from '../lib/units';
import type { Unit } from '../types';

interface Props {
  item: Item;
  tags: Record<string, Tag>;
  units: Unit;
  highlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

export default function ItemCard({ item, tags, units, highlighted, onClick, onDragStart }: Props) {
  const itemTags = item.tagIds.map((id) => tags[id]).filter(Boolean) as Tag[];
  const accent = itemTags[0]?.color ?? '#4f8cff';

  const dims =
    item.widthIn && item.heightIn
      ? `${formatLength(item.widthIn, units)} × ${formatLength(item.heightIn, units)}`
      : null;

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

      {/* Hover detail overlay */}
      <div className="card-hover glass">
        <div className="ch-name">{item.name}</div>
        <div className="ch-row">Qty: {item.quantity}</div>
        {itemTags.length > 0 && <div className="ch-row">{itemTags.map((t) => t.name).join(', ')}</div>}
        {dims && <div className="ch-row">{dims}</div>}
        {item.value != null && <div className="ch-row">${item.value}</div>}
        {item.purchaseDate && <div className="ch-row">Bought {item.purchaseDate}</div>}
        {item.notes && <div className="ch-note">{item.notes}</div>}
      </div>
    </div>
  );
}
