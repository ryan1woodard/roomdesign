import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package } from 'lucide-react';
import type { Item, Tag } from '../types';

interface Props {
  item: Item;
  tags: Record<string, Tag>;
  highlighted: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

const TOOLTIP_GAP = 10;
const VIEWPORT_MARGIN = 8;

/** Walks up from a node to find the nearest scrollable ancestor (e.g. the
 * drawer's card grid) and returns its top edge. Without this, a card near
 * the top of a scrollable panel would get its tooltip placed "above" it in
 * viewport terms while actually overlapping that panel's own fixed header. */
function getScrollBoundaryTop(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node.getBoundingClientRect().top;
    node = node.parentElement;
  }
  return 0;
}

/** Floating tooltip that tracks the card, flips above/below to stay in
 * view, and never leaves the horizontal viewport bounds. Rendered via a
 * portal so it can't be clipped by a scrolling drawer/shelf container. */
function ItemHoverTooltip({
  anchorRef,
  visible,
  item,
  itemTags,
}: {
  anchorRef: React.RefObject<HTMLElement>;
  visible: boolean;
  item: Item;
  itemTags: Tag[];
}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      const tip = tipRef.current;
      if (!anchor || !tip) return;
      const a = anchor.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const topBound = Math.max(VIEWPORT_MARGIN, getScrollBoundaryTop(anchor) + VIEWPORT_MARGIN);
      const spaceAbove = a.top - topBound;
      const spaceBelow = window.innerHeight - a.bottom;
      const placeAbove = spaceAbove >= t.height + TOOLTIP_GAP || spaceAbove >= spaceBelow;
      const top = placeAbove ? a.top - t.height - TOOLTIP_GAP : a.bottom + TOOLTIP_GAP;
      const left = a.left + a.width / 2 - t.width / 2;
      setPos({
        top: Math.max(topBound, Math.min(top, window.innerHeight - t.height - VIEWPORT_MARGIN)),
        left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - t.width - VIEWPORT_MARGIN)),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return createPortal(
    <div
      ref={tipRef}
      className="item-hover-tip glass"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        opacity: pos ? 1 : 0,
      }}
    >
      <div className="iht-name">{item.name}</div>
      <div className="iht-qty">Qty: {item.quantity}</div>
      {itemTags.length > 0 && (
        <div className="iht-tags">
          {itemTags.map((t) => (
            <span key={t.id} className="tag-chip" style={{ background: `${t.color}22`, color: t.color }}>
              <span className="dot" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default function ItemCard({ item, tags, highlighted, onClick, onDragStart }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hoverMounted, setHoverMounted] = useState(false);
  const [hoverVisible, setHoverVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const itemTags = item.tagIds.map((id) => tags[id]).filter(Boolean) as Tag[];
  const accent = itemTags[0]?.color ?? '#4f8cff';

  const onEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHoverMounted(true);
    requestAnimationFrame(() => setHoverVisible(true));
  };
  const onLeave = () => {
    setHoverVisible(false);
    hideTimer.current = setTimeout(() => setHoverMounted(false), 150);
  };

  return (
    <div
      ref={cardRef}
      className={`item-card ${highlighted ? 'hit' : ''}`}
      style={{ ['--card-accent' as string]: accent }}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
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

      {hoverMounted && <ItemHoverTooltip anchorRef={cardRef} visible={hoverVisible} item={item} itemTags={itemTags} />}
    </div>
  );
}
