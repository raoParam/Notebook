/**
 * Validates CSS color values to prevent arbitrary unsafe CSS injection.
 * Supports:
 * - Hex colors: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 * - RGB / RGBA: rgb(...) / rgba(...)
 * - HSL / HSLA: hsl(...) / hsla(...)
 * - Standard safe keyword: 'transparent'
 */

const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_REGEX = /^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
const HSL_REGEX = /^hsla?\(\s*(?:[0-9]|[1-9]\d|[12]\d\d|3[0-5]\d|360)(?:deg)?\s*,\s*(?:100|\d{1,2})%\s*,\s*(?:100|\d{1,2})%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;

// Disallowed patterns that could signify CSS injection or script execution
const UNSAFE_PATTERN = /[;{}\\<>"'/*]|url\s*\(|expression\s*\(|javascript\s*:/i;

export function isValidColorValue(color: unknown): boolean {
  if (typeof color !== 'string') return false;
  const trimmed = color.trim();
  if (!trimmed || trimmed.length > 50) return false;
  if (UNSAFE_PATTERN.test(trimmed)) return false;

  if (trimmed.toLowerCase() === 'transparent') return true;
  if (HEX_REGEX.test(trimmed)) return true;
  if (RGB_REGEX.test(trimmed)) return true;
  if (HSL_REGEX.test(trimmed)) return true;

  return false;
}

/**
 * Calculates perceived brightness (luma) of a color to determine if it is dark.
 * Supports hex formats (#RGB, #RRGGBB).
 */
export function isColorDark(color: string): boolean {
  if (!color || typeof color !== 'string') return false;
  const trimmed = color.trim();
  if (!trimmed.startsWith('#')) return false;

  let hex = trimmed.substring(1);
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  if (hex.length === 4) {
    hex = hex.substring(0, 3).split('').map((c) => c + c).join('');
  }
  if (hex.length >= 6) {
    hex = hex.substring(0, 6);
  }

  const rgb = parseInt(hex, 16);
  if (isNaN(rgb)) return false;

  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 128;
}
