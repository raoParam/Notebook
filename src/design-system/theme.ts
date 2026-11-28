/**
 * Notebook Design Tokens & Themes
 * Central source of truth for palette values established in tokens.css.
 */

export interface ThemeColors {
  bgApp: string;
  bgPaper: string;
  bgSidebar: string;
  accent: string;
  accentSoft: string;
  gold: string;
  border: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  hover: string;
  danger: string;
}

export interface CustomTheme {
  id: string;
  name: string;
  isDark: boolean;
  colors: ThemeColors;
}

export type BuiltInThemeId = 'paper' | 'ink';

/**
 * Paper palette (professional light) — exact values from tokens.css
 */
export const PAPER_COLORS: Readonly<ThemeColors> = Object.freeze({
  bgApp: '#F6F4EF',
  bgPaper: '#FFFFFF',
  bgSidebar: '#EAE7DF',
  ink: '#24241F',
  inkSoft: '#5D5B53',
  inkMuted: '#817D72',
  accent: '#A65338',
  accentSoft: '#C17A59',
  gold: '#A58A55',
  border: '#DAD6CC',
  danger: '#A63D32',
  hover: '#E9E5DC',
});

/**
 * Ink palette (professional dark) — exact values from tokens.css
 */
export const INK_COLORS: Readonly<ThemeColors> = Object.freeze({
  bgApp: '#191B18',
  bgPaper: '#22251F',
  bgSidebar: '#30342D',
  ink: '#F0EEE7',
  inkSoft: '#C0BDB2',
  inkMuted: '#969489',
  accent: '#C17A59',
  accentSoft: '#D39473',
  gold: '#C0A36B',
  border: '#41443B',
  danger: '#E08A7E',
  hover: '#383B33',
});

/**
 * Default built-in themes: Paper (light) and Ink (dark).
 */
export const THEME_PRESETS: Record<BuiltInThemeId, { name: string; isDark: boolean; colors: ThemeColors }> = {
  paper: {
    name: 'Paper',
    isDark: false,
    colors: PAPER_COLORS,
  },
  ink: {
    name: 'Ink',
    isDark: true,
    colors: INK_COLORS,
  },
};

/**
 * Fallback mapping for legacy theme IDs saved in localStorage.
 */
export const LEGACY_THEME_FALLBACKS: Readonly<Record<string, BuiltInThemeId>> = Object.freeze({
  light: 'paper',
  dark: 'ink',
  ocean: 'ink',
  dracula: 'ink',
  nord: 'ink',
  gruvbox: 'ink',
});

/**
 * Mapping from ThemeColors keys to CSS variable names defined in tokens.css.
 */
export const THEME_COLOR_VARS: Readonly<Record<keyof ThemeColors, string>> = Object.freeze({
  bgApp: '--bg-app',
  bgPaper: '--bg-paper',
  bgSidebar: '--bg-sidebar',
  accent: '--accent',
  accentSoft: '--accent-soft',
  gold: '--gold',
  border: '--border',
  ink: '--ink',
  inkSoft: '--ink-soft',
  inkMuted: '--ink-muted',
  hover: '--hover',
  danger: '--danger',
});

/**
 * Resolve any theme ID string (including legacy ones) to a safe theme ID.
 */
export function resolveThemeId(id: string | null | undefined): string {
  if (!id) return 'paper';
  if (id in THEME_PRESETS) return id;
  if (id in LEGACY_THEME_FALLBACKS) return LEGACY_THEME_FALLBACKS[id];
  return id;
}
