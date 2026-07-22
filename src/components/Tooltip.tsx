import { useState, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
  /** Side the bubble appears on, relative to the trigger. Defaults to below. */
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/** A hover label that always appears immediately and consistently — unlike
 * the native `title` attribute, which browsers delay and can skip on quick
 * mouse movement. */
export default function Tooltip({ label, children, side = 'bottom' }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="tooltip-wrap" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && <span className={`tooltip-bubble ${side}`}>{label}</span>}
    </span>
  );
}
