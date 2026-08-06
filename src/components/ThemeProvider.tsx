'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type BuiltInThemeId = 'light' | 'dark' | 'ocean' | 'dracula' | 'nord' | 'gruvbox';
export type ThemeId = BuiltInThemeId | 'custom';

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

export const THEME_PRESETS: Record<BuiltInThemeId, { name: string; isDark: boolean; colors: ThemeColors }> = {
  light: {
    name: 'Light',
    isDark: false,
    colors: {
      bgApp: '#F5F4F0',
      bgPaper: '#FFFFFF',
      bgSidebar: '#EFEDE7',
      accent: '#16324F',
      accentSoft: '#3D5A78',
      gold: '#AD8A4E',
      border: '#DEDAD0',
      ink: '#20242A',
      inkSoft: '#5B6169',
      inkMuted: '#858177',
      hover: '#E6E2D9',
      danger: '#A23B2E',
    },
  },
  dark: {
    name: 'Dark',
    isDark: true,
    colors: {
      bgApp: '#14171C',
      bgPaper: '#1B1F26',
      bgSidebar: '#101317',
      accent: '#7FA8CC',
      accentSoft: '#9CC0E0',
      gold: '#D4AF6A',
      border: '#2A2F37',
      ink: '#E7E5DE',
      inkSoft: '#9BA1AA',
      inkMuted: '#6E747C',
      hover: '#22262E',
      danger: '#E0796A',
    },
  },
  ocean: {
    name: 'Ocean',
    isDark: true,
    colors: {
      bgApp: '#0F172A',
      bgPaper: '#1E293B',
      bgSidebar: '#0B132B',
      accent: '#38BDF8',
      accentSoft: '#0EA5E9',
      gold: '#2DD4BF',
      border: '#334155',
      ink: '#F1F5F9',
      inkSoft: '#94A3B8',
      inkMuted: '#64748B',
      hover: '#1E293B',
      danger: '#F43F5E',
    },
  },
  dracula: {
    name: 'Dracula',
    isDark: true,
    colors: {
      bgApp: '#282A36',
      bgPaper: '#343746',
      bgSidebar: '#21222C',
      accent: '#BD93F9',
      accentSoft: '#FF79C6',
      gold: '#F1FA8C',
      border: '#44475A',
      ink: '#F8F8F2',
      inkSoft: '#6272A4',
      inkMuted: '#8BE9FD',
      hover: '#44475A',
      danger: '#FF5555',
    },
  },
  nord: {
    name: 'Nord',
    isDark: true,
    colors: {
      bgApp: '#2E3440',
      bgPaper: '#3B4252',
      bgSidebar: '#272C36',
      accent: '#88C0D0',
      accentSoft: '#81A1C1',
      gold: '#EBCB8B',
      border: '#4C566A',
      ink: '#ECEFF4',
      inkSoft: '#D8DEE9',
      inkMuted: '#7B88A1',
      hover: '#434C5E',
      danger: '#BF616A',
    },
  },
  gruvbox: {
    name: 'Gruvbox',
    isDark: true,
    colors: {
      bgApp: '#282828',
      bgPaper: '#3C3836',
      bgSidebar: '#1D2021',
      accent: '#FE8019',
      accentSoft: '#FABD2F',
      gold: '#8EC07C',
      border: '#504945',
      ink: '#EBDBB2',
      inkSoft: '#BDAE93',
      inkMuted: '#928374',
      hover: '#504945',
      danger: '#FB4934',
    },
  },
};

export interface FontSettings {
  uiFont: string;
  serifFont: string;
  monoFont: string;
}

export const DEFAULT_FONTS: FontSettings = {
  uiFont: "'Poppins', sans-serif",
  serifFont: "'Source Serif 4', serif",
  monoFont: "'JetBrains Mono', monospace",
};

export const FONT_OPTIONS = {
  ui: [
    { label: 'Poppins (Professional Modern)', value: "'Poppins', sans-serif" },
    { label: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif" },
    { label: 'Inter (Clean Tech)', value: "'Inter', sans-serif" },
    { label: 'Roboto (Classic)', value: "'Roboto', sans-serif" },
    { label: 'Outfit (Sleek Geometric)', value: "'Outfit', sans-serif" },
    { label: 'System UI', value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" },
  ],
  serif: [
    { label: 'Source Serif 4 (Classic Serif)', value: "'Source Serif 4', serif" },
    { label: 'Lora (Editorial Elegance)', value: "'Lora', serif" },
    { label: 'Poppins (Modern Clean)', value: "'Poppins', sans-serif" },
    { label: 'Merriweather', value: "'Merriweather', serif" },
    { label: 'Playfair Display', value: "'Playfair Display', serif" },
    { label: 'Georgia', value: "Georgia, serif" },
  ],
  mono: [
    { label: 'JetBrains Mono (Default Code)', value: "'JetBrains Mono', monospace" },
    { label: 'Fira Code (Developer)', value: "'Fira Code', monospace" },
    { label: 'Space Mono (Modern Tech)', value: "'Space Mono', monospace" },
    { label: 'Courier Prime (Typewriter)', value: "'Courier Prime', monospace" },
    { label: 'Consolas', value: "Consolas, monospace" },
  ],
};

interface ThemeContextType {
  themeId: ThemeId;
  activeColors: ThemeColors;
  customColors: ThemeColors;
  fonts: FontSettings;
  selectTheme: (id: ThemeId) => void;
  updateCustomColor: (key: keyof ThemeColors, value: string) => void;
  saveCustomTheme: () => void;
  resetCustomTheme: () => void;
  updateFont: (key: keyof FontSettings, value: string) => void;
  resetFonts: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeId: 'light',
  activeColors: THEME_PRESETS.light.colors,
  customColors: THEME_PRESETS.light.colors,
  fonts: DEFAULT_FONTS,
  selectTheme: () => {},
  updateCustomColor: () => {},
  saveCustomTheme: () => {},
  resetCustomTheme: () => {},
  updateFont: () => {},
  resetFonts: () => {},
});

function applyColorsToDOM(colors: ThemeColors, isDark: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--bg-app', colors.bgApp);
  root.style.setProperty('--bg-paper', colors.bgPaper);
  root.style.setProperty('--bg-sidebar', colors.bgSidebar);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-soft', colors.accentSoft);
  root.style.setProperty('--gold', colors.gold);
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--border-light', colors.border);
  root.style.setProperty('--ink', colors.ink);
  root.style.setProperty('--ink-soft', colors.inkSoft);
  root.style.setProperty('--ink-muted', colors.inkMuted);
  root.style.setProperty('--hover', colors.hover);
  root.style.setProperty('--danger', colors.danger);

  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function applyFontsToDOM(fonts: FontSettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--font', fonts.uiFont);
  root.style.setProperty('--serif-font', fonts.serifFont);
  root.style.setProperty('--mono-font', fonts.monoFont);
  document.body.style.fontFamily = fonts.uiFont;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('light');
  const [customColors, setCustomColors] = useState<ThemeColors>(THEME_PRESETS.light.colors);
  const [fonts, setFonts] = useState<FontSettings>(DEFAULT_FONTS);

  useEffect(() => {
    try {
      const savedThemeId = localStorage.getItem('nb-theme-id') as ThemeId | null;
      const savedCustom = localStorage.getItem('nb-custom-colors');
      const savedFonts = localStorage.getItem('nb-fonts');
      
      let loadedCustom = THEME_PRESETS.light.colors;
      if (savedCustom) {
        try {
          loadedCustom = { ...THEME_PRESETS.light.colors, ...JSON.parse(savedCustom) };
          setCustomColors(loadedCustom);
        } catch {}
      }

      let loadedFonts = DEFAULT_FONTS;
      if (savedFonts) {
        try {
          loadedFonts = { ...DEFAULT_FONTS, ...JSON.parse(savedFonts) };
          setFonts(loadedFonts);
        } catch {}
      }

      const activeId: ThemeId = savedThemeId || 'light';
      setThemeId(activeId);

      let targetColors: ThemeColors;
      let targetDark = false;

      if (activeId === 'custom') {
        targetColors = loadedCustom;
        targetDark = isColorDark(loadedCustom.bgApp);
      } else if (THEME_PRESETS[activeId as BuiltInThemeId]) {
        targetColors = THEME_PRESETS[activeId as BuiltInThemeId].colors;
        targetDark = THEME_PRESETS[activeId as BuiltInThemeId].isDark;
      } else {
        targetColors = THEME_PRESETS.light.colors;
        targetDark = false;
      }

      applyColorsToDOM(targetColors, targetDark);
      applyFontsToDOM(loadedFonts);
    } catch {}
  }, []);

  const getActiveColors = (id: ThemeId, custom: ThemeColors): ThemeColors => {
    if (id === 'custom') return custom;
    return THEME_PRESETS[id as BuiltInThemeId]?.colors || THEME_PRESETS.light.colors;
  };

  const activeColors = getActiveColors(themeId, customColors);

  const selectTheme = (id: ThemeId) => {
    setThemeId(id);
    try {
      localStorage.setItem('nb-theme-id', id);
    } catch {}

    const colors = getActiveColors(id, customColors);
    const isDark = id === 'custom' ? isColorDark(colors.bgApp) : THEME_PRESETS[id as BuiltInThemeId]?.isDark || false;
    applyColorsToDOM(colors, isDark);
  };

  const updateCustomColor = (key: keyof ThemeColors, value: string) => {
    const updated = { ...customColors, [key]: value };
    setCustomColors(updated);
    setThemeId('custom');
    try {
      localStorage.setItem('nb-theme-id', 'custom');
      localStorage.setItem('nb-custom-colors', JSON.stringify(updated));
    } catch {}
    applyColorsToDOM(updated, isColorDark(updated.bgApp));
  };

  const saveCustomTheme = () => {
    setThemeId('custom');
    try {
      localStorage.setItem('nb-theme-id', 'custom');
      localStorage.setItem('nb-custom-colors', JSON.stringify(customColors));
    } catch {}
    applyColorsToDOM(customColors, isColorDark(customColors.bgApp));
  };

  const resetCustomTheme = () => {
    const resetVal = THEME_PRESETS.light.colors;
    setCustomColors(resetVal);
    setThemeId('light');
    try {
      localStorage.setItem('nb-theme-id', 'light');
      localStorage.setItem('nb-custom-colors', JSON.stringify(resetVal));
    } catch {}
    applyColorsToDOM(resetVal, false);
  };

  const updateFont = (key: keyof FontSettings, value: string) => {
    const updated = { ...fonts, [key]: value };
    setFonts(updated);
    try {
      localStorage.setItem('nb-fonts', JSON.stringify(updated));
    } catch {}
    applyFontsToDOM(updated);
  };

  const resetFonts = () => {
    setFonts(DEFAULT_FONTS);
    try {
      localStorage.setItem('nb-fonts', JSON.stringify(DEFAULT_FONTS));
    } catch {}
    applyFontsToDOM(DEFAULT_FONTS);
  };

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        activeColors,
        customColors,
        fonts,
        selectTheme,
        updateCustomColor,
        saveCustomTheme,
        resetCustomTheme,
        updateFont,
        resetFonts,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

function isColorDark(hex: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  const c = hex.substring(1);
  const rgb = parseInt(c, 16);
  if (isNaN(rgb)) return false;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 128;
}
