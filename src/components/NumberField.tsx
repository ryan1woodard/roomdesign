import { useEffect, useRef, useState } from 'react';

interface Props {
  label?: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  unitLabel?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  title?: string;
  /** When true, clearing the field and blurring commits `undefined` (the
   * field becomes "unset"). When false (default), clearing and blurring
   * just reverts the displayed text back to the current value — nothing
   * about the underlying data changes. */
  optional?: boolean;
}

function formatNum(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

/**
 * A number input that never fights the user while they're typing.
 *
 * A plain controlled `<input type="number">` whose value is derived from a
 * committed number breaks the moment you clear the field to retype it: the
 * empty string parses to NaN (or gets coerced to 0), that 0 gets committed
 * and fed back in as the new `value`, and the next keystroke lands after
 * the phantom "0" — clearing a field to type "90" ends up as "090".
 *
 * The fix is to keep the input's displayed text as local draft state,
 * independent of the committed value while focused, and only reconcile
 * the two on blur: a valid number gets normalized and committed one last
 * time, and an empty/invalid draft either reverts to the last real value
 * or — for genuinely optional fields — commits `undefined`.
 */
export default function NumberField({
  label,
  value,
  onCommit,
  unitLabel,
  step = 1,
  min,
  max,
  placeholder,
  className,
  title,
  optional = false,
}: Props) {
  const [draft, setDraft] = useState(() => formatNum(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatNum(value));
  }, [value]);

  const input = (
    <div className="num-input-wrap">
      <input
        className={`field${className ? ` ${className}` : ''}`}
        type="number"
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        title={title}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parseFloat(raw);
          if (Number.isFinite(parsed)) onCommit(parsed);
        }}
        onBlur={() => {
          focused.current = false;
          const parsed = parseFloat(draft);
          if (Number.isFinite(parsed)) {
            setDraft(formatNum(parsed));
          } else if (optional) {
            onCommit(undefined);
            setDraft('');
          } else {
            setDraft(formatNum(value));
          }
        }}
      />
      {unitLabel && <span className="num-unit">{unitLabel}</span>}
    </div>
  );

  if (!label) return input;
  return (
    <label className="num-field">
      <span className="label">{label}</span>
      {input}
    </label>
  );
}
