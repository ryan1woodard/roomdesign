import type { Unit } from '../types';

// Canonical internal unit is the inch. These are inches-per-display-unit.
const PER_INCH: Record<Unit, number> = {
  in: 1,
  ft: 12,
  cm: 1 / 2.54,
  m: 100 / 2.54,
};

export const UNIT_LABEL: Record<Unit, string> = {
  in: 'in',
  ft: 'ft',
  cm: 'cm',
  m: 'm',
};

export const ALL_UNITS: Unit[] = ['in', 'ft', 'cm', 'm'];

/** Convert a value stored in inches to the given display unit. */
export function fromInches(inches: number, unit: Unit): number {
  return inches / PER_INCH[unit];
}

/** Convert a display-unit value back to inches for storage. */
export function toInches(value: number, unit: Unit): number {
  return value * PER_INCH[unit];
}

/** Format an inch value for display, rounded sensibly for the unit. */
export function formatLength(inches: number, unit: Unit): string {
  const v = fromInches(inches, unit);
  const decimals = unit === 'in' || unit === 'cm' ? 1 : 2;
  const rounded = Number(v.toFixed(decimals));
  return `${rounded}${UNIT_LABEL[unit]}`;
}
