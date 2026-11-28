'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type BuiltInThemeId = 'light' | 'dark' | 'ocean' | 'dracula' | 'nord' | 'gruvbox';

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

export function cleanFont(val?: string): string {
  if (!val) return 'sans-serif';
  return val.replace(/['"]/g, '').trim();
}

export const DEFAULT_FONTS: FontSettings = {
  uiFont: "Poppins, sans-serif",
  serifFont: "Source Serif 4, serif",
  monoFont: "JetBrains Mono, monospace",
};

export const FONT_OPTIONS = {
  ui: [
    { label: 'Poppins (Professional Modern)', value: "Poppins, sans-serif" },
    { label: 'Plus Jakarta Sans', value: "Plus Jakarta Sans, sans-serif" },
    { label: 'Inter (Clean Tech)', value: "Inter, sans-serif" },
    { label: 'Roboto (Classic)', value: "Roboto, sans-serif" },
    { label: 'Outfit (Sleek Geometric)', value: "Outfit, sans-serif" },
    { label: 'System UI', value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif" },
  ],
  serif: [
    { label: 'Source Serif 4 (Classic Serif)', value: "Source Serif 4, serif" },
    { label: 'Lora (Editorial Elegance)', value: "Lora, serif" },
    { label: 'Poppins (Modern Clean)', value: "Poppins, sans-serif" },
    { label: 'Merriweather', value: "Merriweather, serif" },
    { label: 'Playfair Display', value: "Playfair Display, serif" },
    { label: 'Georgia', value: "Georgia, serif" },
  ],
  mono: [
    { label: 'JetBrains Mono (Default Code)', value: "JetBrains Mono, monospace" },
    { label: 'Fira Code (Developer)', value: "Fira Code, monospace" },
    { label: 'Space Mono (Modern Tech)', value: "Space Mono, monospace" },
    { label: 'Courier Prime (Typewriter)', value: "Courier Prime, monospace" },
    { label: 'Consolas', value: "Consolas, monospace" },
  ],
};

export interface ImportResult {
  success: boolean;
  error?: string;
  themeName?: string;
}

export interface ExportResult {
  jsonString: string;
  filename: string;
}

interface ThemeContextType {
  themeId: string;
  activeColors: ThemeColors;
  customColors: ThemeColors;
  customThemeName: string;
  savedCustomThemes: CustomTheme[];
  fonts: FontSettings;
  selectTheme: (id: string) => void;
  startCustomizingTheme: (id?: string) => void;
  updateCustomColor: (key: keyof ThemeColors, value: string) => void;
  setCustomThemeName: (name: string) => void;
  saveCustomTheme: (name?: string) => void;
  deleteCustomTheme: (id: string) => void;
  resetCustomTheme: () => void;
  importThemeFromJSON: (jsonString: string) => ImportResult;
  exportThemeToJSON: (targetId?: string) => ExportResult;
  updateFont: (key: keyof FontSettings, value: string) => void;
  resetFonts: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  themeId: 'light',
  activeColors: THEME_PRESETS.light.colors,
  customColors: THEME_PRESETS.light.colors,
  customThemeName: 'My Custom Theme',
  savedCustomThemes: [],
  fonts: DEFAULT_FONTS,
  selectTheme: () => {},
  startCustomizingTheme: () => {},
  updateCustomColor: () => {},
  setCustomThemeName: () => {},
  saveCustomTheme: () => {},
  deleteCustomTheme: () => {},
  resetCustomTheme: () => {},
  importThemeFromJSON: () => ({ success: false, error: 'Not implemented' }),
  exportThemeToJSON: () => ({ jsonString: '', filename: 'theme.json' }),
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
  root.style.setProperty('--ink', colors.ink);
  root.style.setProperty('--ink-soft', colors.inkSoft);
  root.style.setProperty('--ink-muted', colors.inkMuted);
  root.style.setProperty('--hover', colors.hover);
  root.style.setProperty('--danger', colors.danger);

  root.classList.toggle('dark', isDark);
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyFontsToDOM(fonts: FontSettings) {
  if (typeof document === 'undefined') return;
  const ui = cleanFont(fonts.uiFont);
  const serif = cleanFont(fonts.serifFont);
  const mono = cleanFont(fonts.monoFont);

  const root = document.documentElement;
  root.style.setProperty('--font', ui);
  root.style.setProperty('--serif-font', serif);
  root.style.setProperty('--mono-font', mono);
  document.body.style.fontFamily = ui;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>('light');
  const [savedCustomThemes, setSavedCustomThemes] = useState<CustomTheme[]>([]);
  const [customColors, setCustomColors] = useState<ThemeColors>(THEME_PRESETS.light.colors);
  const [customThemeName, setCustomThemeName] = useState<string>('My Custom Theme');
  const [fonts, setFonts] = useState<FontSettings>(DEFAULT_FONTS);

  // Helper to find colors and dark status for any given theme ID
  const getThemeData = (id: string, currentCustomColors: ThemeColors, customList: CustomTheme[]) => {
    if (id === 'custom-draft') {
      return { colors: currentCustomColors, isDark: isColorDark(currentCustomColors.bgApp) };
    }
    const saved = customList.find((t) => t.id === id);
    if (saved) {
      return { colors: saved.colors, isDark: saved.isDark };
    }
    if (THEME_PRESETS[id as BuiltInThemeId]) {
      const preset = THEME_PRESETS[id as BuiltInThemeId];
      return { colors: preset.colors, isDark: preset.isDark };
    }
    if (id === 'custom') {
      return { colors: currentCustomColors, isDark: isColorDark(currentCustomColors.bgApp) };
    }
    return { colors: THEME_PRESETS.light.colors, isDark: false };
  };

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const savedThemeId = localStorage.getItem('nb-theme-id') || 'light';
        const savedCustomColors = localStorage.getItem('nb-custom-colors');
        const savedCustomListStr = localStorage.getItem('nb-saved-custom-themes');
        const savedFonts = localStorage.getItem('nb-fonts');

        let loadedCustomList: CustomTheme[] = [];
        if (savedCustomListStr) {
          try {
            const parsedList: unknown = JSON.parse(savedCustomListStr);
            if (Array.isArray(parsedList)) {
              loadedCustomList = parsedList as CustomTheme[];
              setSavedCustomThemes(loadedCustomList);
            }
          } catch {}
        }

        let loadedCustomColors = THEME_PRESETS.light.colors;
        if (savedCustomColors) {
          try {
            const parsedColors: unknown = JSON.parse(savedCustomColors);
            if (isPlainRecord(parsedColors)) {
              loadedCustomColors = { ...THEME_PRESETS.light.colors, ...(parsedColors as Partial<ThemeColors>) };
              setCustomColors(loadedCustomColors);
            }
          } catch {}
        }

        let loadedFonts = DEFAULT_FONTS;
        if (savedFonts) {
          try {
            const parsedFonts: unknown = JSON.parse(savedFonts);
            if (isPlainRecord(parsedFonts)) {
              loadedFonts = {
                uiFont: cleanFont(typeof parsedFonts.uiFont === 'string' ? parsedFonts.uiFont : DEFAULT_FONTS.uiFont),
                serifFont: cleanFont(typeof parsedFonts.serifFont === 'string' ? parsedFonts.serifFont : DEFAULT_FONTS.serifFont),
                monoFont: cleanFont(typeof parsedFonts.monoFont === 'string' ? parsedFonts.monoFont : DEFAULT_FONTS.monoFont),
              };
              setFonts(loadedFonts);
            }
          } catch {}
        }

        setThemeId(savedThemeId);

        const activeSaved = loadedCustomList.find((t) => t.id === savedThemeId);
        if (activeSaved) {
          setCustomColors(activeSaved.colors);
          setCustomThemeName(activeSaved.name);
        } else if (THEME_PRESETS[savedThemeId as BuiltInThemeId]) {
          const p = THEME_PRESETS[savedThemeId as BuiltInThemeId];
          setCustomColors(p.colors);
          setCustomThemeName(`My ${p.name} Custom`);
        }

        const activeData = getThemeData(savedThemeId, loadedCustomColors, loadedCustomList);
        applyColorsToDOM(activeData.colors, activeData.isDark);
        applyFontsToDOM(loadedFonts);
      } catch {}
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeData = getThemeData(themeId, customColors, savedCustomThemes);
  const activeColors = activeData.colors;

  const selectTheme = (id: string) => {
    setThemeId(id);
    try {
      localStorage.setItem('nb-theme-id', id);
    } catch {}

    const data = getThemeData(id, customColors, savedCustomThemes);

    setCustomColors(data.colors);
    const preset = THEME_PRESETS[id as BuiltInThemeId];
    if (preset) {
      setCustomThemeName(`My ${preset.name} Custom`);
    } else {
      const saved = savedCustomThemes.find((t) => t.id === id);
      if (saved) setCustomThemeName(saved.name);
    }

    applyColorsToDOM(data.colors, data.isDark);
  };

  const startCustomizingTheme = (id?: string) => {
    const targetId = id || themeId;
    const data = getThemeData(targetId, customColors, savedCustomThemes);
    setCustomColors(data.colors);
    setThemeId('custom-draft');
    try {
      localStorage.setItem('nb-theme-id', 'custom-draft');
      localStorage.setItem('nb-custom-colors', JSON.stringify(data.colors));
    } catch {}
    applyColorsToDOM(data.colors, data.isDark);
  };

  const updateCustomColor = (key: keyof ThemeColors, value: string) => {
    let baseColors = customColors;
    if (themeId !== 'custom-draft' && THEME_PRESETS[themeId as BuiltInThemeId]) {
      baseColors = THEME_PRESETS[themeId as BuiltInThemeId].colors;
    } else if (themeId !== 'custom-draft') {
      const saved = savedCustomThemes.find((t) => t.id === themeId);
      if (saved) baseColors = saved.colors;
    }

    const updated = { ...baseColors, [key]: value };
    setCustomColors(updated);
    setThemeId('custom-draft');
    try {
      localStorage.setItem('nb-theme-id', 'custom-draft');
      localStorage.setItem('nb-custom-colors', JSON.stringify(updated));
    } catch {}
    applyColorsToDOM(updated, isColorDark(updated.bgApp));
  };

  const saveCustomTheme = (nameInput?: string) => {
    const finalName = (nameInput || customThemeName).trim() || 'My Custom Theme';
    setCustomThemeName(finalName);

    const isDark = isColorDark(customColors.bgApp);

    const existingIndex = savedCustomThemes.findIndex((t) => t.id === themeId);

    let updatedList: CustomTheme[];
    let newThemeId: string;

    if (existingIndex >= 0) {
      newThemeId = themeId;
      updatedList = [...savedCustomThemes];
      updatedList[existingIndex] = {
        id: newThemeId,
        name: finalName,
        isDark,
        colors: customColors,
      };
    } else {
      newThemeId = `custom-${Date.now()}`;
      const newTheme: CustomTheme = {
        id: newThemeId,
        name: finalName,
        isDark,
        colors: customColors,
      };
      updatedList = [newTheme, ...savedCustomThemes];
    }

    setSavedCustomThemes(updatedList);
    setThemeId(newThemeId);

    try {
      localStorage.setItem('nb-saved-custom-themes', JSON.stringify(updatedList));
      localStorage.setItem('nb-theme-id', newThemeId);
      localStorage.setItem('nb-custom-colors', JSON.stringify(customColors));
    } catch {}

    applyColorsToDOM(customColors, isDark);
  };

  const deleteCustomTheme = (id: string) => {
    const updatedList = savedCustomThemes.filter((t) => t.id !== id);
    setSavedCustomThemes(updatedList);
    try {
      localStorage.setItem('nb-saved-custom-themes', JSON.stringify(updatedList));
    } catch {}

    if (themeId === id) {
      selectTheme('light');
    }
  };

  const resetCustomTheme = () => {
    const resetVal = THEME_PRESETS.light.colors;
    setCustomColors(resetVal);
    setCustomThemeName('My Custom Theme');
    setThemeId('light');
    try {
      localStorage.setItem('nb-theme-id', 'light');
      localStorage.setItem('nb-custom-colors', JSON.stringify(resetVal));
    } catch {}
    applyColorsToDOM(resetVal, false);
  };

  const importThemeFromJSON = (jsonString: string): ImportResult => {
    if (!jsonString || !jsonString.trim()) {
      return {
        success: false,
        error: 'The uploaded file is empty. Please select a valid JSON theme file.',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return {
        success: false,
        error: 'The file contains invalid JSON formatting. Please verify the file structure and try again.',
      };
    }

    if (!isPlainRecord(parsed)) {
      return {
        success: false,
        error: 'The theme configuration structure is unrecognized. Please upload a valid theme file.',
      };
    }

    const colorsObj = isPlainRecord(parsed.colors) ? parsed.colors : parsed;

    const getVal = (primaryKey: string, altKey?: string): string => {
      const v = colorsObj[primaryKey] ?? (altKey ? colorsObj[altKey] : undefined);
      return typeof v === 'string' && v.trim() ? v.trim() : '';
    };

    const bgApp = getVal('bgApp', 'bg_app') || getVal('background', 'bg');
    const bgPaper = getVal('bgPaper', 'bg_paper') || getVal('surface', 'paper');
    const bgSidebar = getVal('bgSidebar', 'bg_sidebar') || getVal('sidebar');
    const accent = getVal('accent', 'primary');
    const accentSoft = getVal('accentSoft', 'accent_soft') || getVal('secondary');
    const gold = getVal('gold', 'accent_gold') || getVal('highlight');
    const border = getVal('border', 'border_color');
    const ink = getVal('ink', 'text') || getVal('foreground');
    const inkSoft = getVal('inkSoft', 'ink_soft') || getVal('text_secondary');
    const inkMuted = getVal('inkMuted', 'ink_muted') || getVal('text_muted');
    const hover = getVal('hover', 'hover_bg');
    const danger = getVal('danger', 'error');

    if (!bgApp || !accent || !ink) {
      return {
        success: false,
        error: 'The theme file is missing essential color definitions (App Background, Accent, or Text color). Please select a complete theme file.',
      };
    }

    const defaultBase = isColorDark(bgApp) ? THEME_PRESETS.dark.colors : THEME_PRESETS.light.colors;

    const colors: ThemeColors = {
      bgApp,
      bgPaper: bgPaper || defaultBase.bgPaper,
      bgSidebar: bgSidebar || defaultBase.bgSidebar,
      accent,
      accentSoft: accentSoft || defaultBase.accentSoft,
      gold: gold || defaultBase.gold,
      border: border || defaultBase.border,
      ink,
      inkSoft: inkSoft || defaultBase.inkSoft,
      inkMuted: inkMuted || defaultBase.inkMuted,
      hover: hover || defaultBase.hover,
      danger: danger || defaultBase.danger,
    };

    const themeName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Imported Custom Theme';
    const isDark = typeof parsed.isDark === 'boolean' ? parsed.isDark : isColorDark(colors.bgApp);

    const newId = `custom-${Date.now()}`;
    const newCustomTheme: CustomTheme = {
      id: newId,
      name: themeName,
      isDark,
      colors,
    };

    const updatedList = [newCustomTheme, ...savedCustomThemes];
    setSavedCustomThemes(updatedList);
    setCustomColors(colors);
    setCustomThemeName(themeName);
    setThemeId(newId);

    try {
      localStorage.setItem('nb-saved-custom-themes', JSON.stringify(updatedList));
      localStorage.setItem('nb-theme-id', newId);
      localStorage.setItem('nb-custom-colors', JSON.stringify(colors));
    } catch {}

    applyColorsToDOM(colors, isDark);

    return { success: true, themeName };
  };

  const exportThemeToJSON = (targetId?: string): ExportResult => {
    const idToExport = targetId || themeId;
    let exportName = customThemeName;
    let colorsToExport = customColors;
    let darkStatus = isColorDark(customColors.bgApp);

    if (THEME_PRESETS[idToExport as BuiltInThemeId]) {
      const preset = THEME_PRESETS[idToExport as BuiltInThemeId];
      exportName = preset.name;
      colorsToExport = preset.colors;
      darkStatus = preset.isDark;
    } else {
      const saved = savedCustomThemes.find((t) => t.id === idToExport);
      if (saved) {
        exportName = saved.name;
        colorsToExport = saved.colors;
        darkStatus = saved.isDark;
      }
    }

    const payload = {
      name: exportName,
      isDark: darkStatus,
      colors: colorsToExport,
    };

    const safeName = exportName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';

    return {
      jsonString: JSON.stringify(payload, null, 2),
      filename: `${safeName}-theme.json`,
    };
  };

  const updateFont = (key: keyof FontSettings, value: string) => {
    const cleaned = cleanFont(value);
    const updated = { ...fonts, [key]: cleaned };
    setFonts(updated);
    writeStorage('nb-fonts', JSON.stringify(updated));
    applyFontsToDOM(updated);
  };

  const resetFonts = () => {
    setFonts(DEFAULT_FONTS);
    writeStorage('nb-fonts', JSON.stringify(DEFAULT_FONTS));
    applyFontsToDOM(DEFAULT_FONTS);
  };

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        activeColors,
        customColors,
        customThemeName,
        savedCustomThemes,
        fonts,
        selectTheme,
        startCustomizingTheme,
        updateCustomColor,
        setCustomThemeName,
        saveCustomTheme,
        deleteCustomTheme,
        resetCustomTheme,
        importThemeFromJSON,
        exportThemeToJSON,
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
