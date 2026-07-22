import { useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { formatLengthLong, parseLength } from '../lib/units';

interface Props {
  label?: string;
  /** Current length, in inches. */
  valueIn: number;
  unit: Unit;
  onCommit: (inches: number) => void;
  className?: string;
}

/**
 * A free-text length input that accepts exact measurements in whatever form
 * is natural to type — "12 ft 6 in", "150 inches", "3.5 meters", or a plain
 * number in the room's current display unit — and always shows the
 * builder-style composite format when not focused. Mirrors NumberField's
 * draft/commit pattern so clearing the field to retype never fights back.
 */
export default function LengthField({ label, valueIn, unit, onCommit, className }: Props) {
  const [draft, setDraft] = useState(() => formatLengthLong(valueIn, unit));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatLengthLong(valueIn, unit));
  }, [valueIn, unit]);

  const commit = () => {
    const parsed = parseLength(draft, unit);
    if (parsed !== null && parsed > 0) {
      onCommit(parsed);
      setDraft(formatLengthLong(parsed, unit));
    } else {
      setDraft(formatLengthLong(valueIn, unit));
    }
  };

  const input = (
    <input
      className={`field${className ? ` ${className}` : ''}`}
      type="text"
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );

  if (!label) return input;
  return (
    <label className="num-field">
      <span className="label">{label}</span>
      {input}
    </label>
  );
}
