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

/**
 * Format an inch value the way a builder would say it out loud: composite
 * feet+inches for `ft` (e.g. "12 ft 6 in"), a single rounded value with a
 * space before the unit for everything else (e.g. "150 in", "3.5 m").
 */
export function formatLengthLong(inches: number, unit: Unit): string {
  if (unit === 'ft') {
    const totalIn = Math.round(inches * 8) / 8; // nearest 1/8 in
    const feet = Math.floor(totalIn / 12);
    const remIn = Number((totalIn - feet * 12).toFixed(2));
    if (remIn <= 0) return `${feet} ft`;
    const remRounded = Number(remIn.toFixed(remIn % 1 === 0 ? 0 : 1));
    return `${feet} ft ${remRounded} in`;
  }
  const v = fromInches(inches, unit);
  const decimals = unit === 'in' || unit === 'cm' ? 1 : 2;
  const rounded = Number(v.toFixed(decimals));
  return `${rounded} ${UNIT_LABEL[unit]}`;
}

/** Parse a user-entered length string into inches. Accepts a plain number
 * (interpreted in the given display unit), an explicit unit suffix
 * (`"150 inches"`, `"3.5 meters"`, `"12ft"`), or a composite feet+inches
 * form (`"12 ft 6 in"`, `"12' 6\""`, `"12'6"`). Returns null if unparsable. */
export function parseLength(input: string, fallbackUnit: Unit): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const feetInchesMatch = s.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")?)?$/,
  );
  if (feetInchesMatch) {
    const feet = parseFloat(feetInchesMatch[1]);
    const inches = feetInchesMatch[2] ? parseFloat(feetInchesMatch[2]) : 0;
    return toInches(feet, 'ft') + inches;
  }

  const unitMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*(in|inch|inches|"|ft|feet|foot|'|cm|centimeters?|m|meters?)$/);
  if (unitMatch) {
    const value = parseFloat(unitMatch[1]);
    const rawUnit = unitMatch[2];
    const unit: Unit = rawUnit.startsWith('ft') || rawUnit.startsWith('feet') || rawUnit.startsWith('foot') || rawUnit === "'"
      ? 'ft'
      : rawUnit.startsWith('cm') || rawUnit.startsWith('centimeter')
        ? 'cm'
        : rawUnit === 'm' || rawUnit.startsWith('meter')
          ? 'm'
          : 'in';
    return toInches(value, unit);
  }

  const plain = parseFloat(s);
  if (Number.isFinite(plain)) return toInches(plain, fallbackUnit);
  return null;
}
