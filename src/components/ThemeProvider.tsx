'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  BuiltInThemeId,
  CustomTheme,
  INK_COLORS,
  LEGACY_THEME_FALLBACKS,
  PAPER_COLORS,
  THEME_COLOR_VARS,
  THEME_PRESETS,
  ThemeColors,
  resolveThemeId,
} from '@/design-system/theme';
import { isColorDark, isValidColorValue } from '@/design-system/color-validator';

export type { BuiltInThemeId, CustomTheme, ThemeColors };
export {
  INK_COLORS,
  LEGACY_THEME_FALLBACKS,
  PAPER_COLORS,
  THEME_COLOR_VARS,
  THEME_PRESETS,
  resolveThemeId,
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
  uiFont: 'Inter, sans-serif',
  serifFont: 'Source Serif 4, Georgia, serif',
  monoFont: 'JetBrains Mono, monospace',
};

export const FONT_OPTIONS = {
  ui: [
    { label: 'Inter (Design System Default)', value: 'Inter, sans-serif' },
    { label: 'Poppins (Modern Clean)', value: 'Poppins, sans-serif' },
    { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans, sans-serif' },
    { label: 'Roboto (Classic)', value: 'Roboto, sans-serif' },
    { label: 'Outfit (Geometric)', value: 'Outfit, sans-serif' },
    { label: 'System UI', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
  ],
  serif: [
    { label: 'Source Serif 4 (Design System Serif)', value: 'Source Serif 4, Georgia, serif' },
    { label: 'Lora (Editorial)', value: 'Lora, serif' },
    { label: 'Merriweather', value: 'Merriweather, serif' },
    { label: 'Playfair Display', value: 'Playfair Display, serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
  ],
  mono: [
    { label: 'JetBrains Mono (Design System Mono)', value: 'JetBrains Mono, monospace' },
    { label: 'Fira Code', value: 'Fira Code, monospace' },
    { label: 'Space Mono', value: 'Space Mono, monospace' },
    { label: 'Courier Prime', value: 'Courier Prime, monospace' },
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
  themeId: 'paper',
  activeColors: PAPER_COLORS,
  customColors: PAPER_COLORS,
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

/**
 * Applies theme colors to the document root element.
 * For built-in themes (paper/ink), inline style overrides are removed so tokens.css
 * remains the centralized single source of truth.
 * For custom themes, individual CSS variables are set on the document element.
 */
function applyColorsToDOM(colors: ThemeColors, isDark: boolean, isBuiltIn: boolean = false) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (isBuiltIn) {
    // Clear inline property overrides so tokens.css controls the presentation
    (Object.values(THEME_COLOR_VARS) as string[]).forEach((cssVar) => {
      root.style.removeProperty(cssVar);
    });
    root.style.removeProperty('--color-action-primary-text');
  } else {
    // Apply each custom color to its respective CSS variable
    (Object.entries(THEME_COLOR_VARS) as [keyof ThemeColors, string][]).forEach(([key, cssVar]) => {
      const value = colors[key];
      if (isValidColorValue(value)) {
        root.style.setProperty(cssVar, value);
      }
    });
    // Set contrast text for primary button
    root.style.setProperty('--color-action-primary-text', isDark ? '#191B18' : '#FFFFFF');
  }

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
  const [themeId, setThemeId] = useState<string>('paper');
  const [savedCustomThemes, setSavedCustomThemes] = useState<CustomTheme[]>([]);
  const [customColors, setCustomColors] = useState<ThemeColors>(PAPER_COLORS);
  const [customThemeName, setCustomThemeName] = useState<string>('My Custom Theme');
  const [fonts, setFonts] = useState<FontSettings>(DEFAULT_FONTS);

  /**
   * Helper to retrieve colors, dark state, and built-in status for any theme ID.
   * Gracefully resolves legacy IDs (light/dark/ocean/etc.).
   */
  const getThemeData = (
    id: string,
    currentCustomColors: ThemeColors,
    customList: CustomTheme[]
  ): { colors: ThemeColors; isDark: boolean; isBuiltIn: boolean; resolvedId: string } => {
    const resolved = resolveThemeId(id);

    if (resolved === 'custom-draft') {
      return {
        colors: currentCustomColors,
        isDark: isColorDark(currentCustomColors.bgApp),
        isBuiltIn: false,
        resolvedId: 'custom-draft',
      };
    }

    const saved = customList.find((t) => t.id === resolved);
    if (saved) {
      return { colors: saved.colors, isDark: saved.isDark, isBuiltIn: false, resolvedId: saved.id };
    }

    if (resolved === 'ink') {
      return { colors: INK_COLORS, isDark: true, isBuiltIn: true, resolvedId: 'ink' };
    }

    // Default to paper
    return { colors: PAPER_COLORS, isDark: false, isBuiltIn: true, resolvedId: 'paper' };
  };

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const rawSavedThemeId = localStorage.getItem('nb-theme-id') || 'paper';
        const savedCustomColors = localStorage.getItem('nb-custom-colors');
        const savedCustomListStr = localStorage.getItem('nb-saved-custom-themes');
        const savedFonts = localStorage.getItem('nb-fonts');

        let loadedCustomList: CustomTheme[] = [];
        if (savedCustomListStr) {
          try {
            const parsedList: unknown = JSON.parse(savedCustomListStr);
            if (Array.isArray(parsedList)) {
              // Sanitize and validate custom themes
              loadedCustomList = parsedList
                .filter((item): item is CustomTheme => {
                  if (!isPlainRecord(item)) return false;
                  if (typeof item.id !== 'string' || typeof item.name !== 'string') return false;
                  if (!isPlainRecord(item.colors)) return false;
                  return true;
                })
                .map((theme) => {
                  const sanitizedColors: Partial<ThemeColors> = {};
                  (Object.keys(PAPER_COLORS) as (keyof ThemeColors)[]).forEach((k) => {
                    const rawVal = theme.colors[k];
                    sanitizedColors[k] =
                      isValidColorValue(rawVal) ? (rawVal as string) : PAPER_COLORS[k];
                  });
                  return {
                    ...theme,
                    colors: sanitizedColors as ThemeColors,
                  };
                });
              setSavedCustomThemes(loadedCustomList);
            }
          } catch {}
        }

        let loadedCustomColors: ThemeColors = PAPER_COLORS;
        if (savedCustomColors) {
          try {
            const parsedColors: unknown = JSON.parse(savedCustomColors);
            if (isPlainRecord(parsedColors)) {
              const sanitized: Partial<ThemeColors> = {};
              (Object.keys(PAPER_COLORS) as (keyof ThemeColors)[]).forEach((k) => {
                const rawVal = parsedColors[k];
                sanitized[k] =
                  isValidColorValue(rawVal) ? (rawVal as string) : PAPER_COLORS[k];
              });
              loadedCustomColors = { ...PAPER_COLORS, ...sanitized };
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

        const activeData = getThemeData(rawSavedThemeId, loadedCustomColors, loadedCustomList);
        setThemeId(activeData.resolvedId);

        const activeSaved = loadedCustomList.find((t) => t.id === activeData.resolvedId);
        if (activeSaved) {
          setCustomColors(activeSaved.colors);
          setCustomThemeName(activeSaved.name);
        } else if (THEME_PRESETS[activeData.resolvedId as BuiltInThemeId]) {
          const p = THEME_PRESETS[activeData.resolvedId as BuiltInThemeId];
          setCustomColors(p.colors);
          setCustomThemeName(`My ${p.name} Custom`);
        }

        applyColorsToDOM(activeData.colors, activeData.isDark, activeData.isBuiltIn);
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
    const data = getThemeData(id, customColors, savedCustomThemes);
    const targetId = data.resolvedId;

    setThemeId(targetId);
    writeStorage('nb-theme-id', targetId);

    setCustomColors(data.colors);
    const preset = THEME_PRESETS[targetId as BuiltInThemeId];
    if (preset) {
      setCustomThemeName(`My ${preset.name} Custom`);
    } else {
      const saved = savedCustomThemes.find((t) => t.id === targetId);
      if (saved) setCustomThemeName(saved.name);
    }

    applyColorsToDOM(data.colors, data.isDark, data.isBuiltIn);
  };

  const startCustomizingTheme = (id?: string) => {
    const targetId = id || themeId;
    const data = getThemeData(targetId, customColors, savedCustomThemes);
    setCustomColors(data.colors);
    setThemeId('custom-draft');
    writeStorage('nb-theme-id', 'custom-draft');
    writeStorage('nb-custom-colors', JSON.stringify(data.colors));
    applyColorsToDOM(data.colors, data.isDark, false);
  };

  const updateCustomColor = (key: keyof ThemeColors, value: string) => {
    if (!isValidColorValue(value)) {
      return;
    }

    let baseColors = customColors;
    if (themeId !== 'custom-draft' && THEME_PRESETS[themeId as BuiltInThemeId]) {
      baseColors = THEME_PRESETS[themeId as BuiltInThemeId].colors;
    } else if (themeId !== 'custom-draft') {
      const saved = savedCustomThemes.find((t) => t.id === themeId);
      if (saved) baseColors = saved.colors;
    }

    const updated: ThemeColors = { ...baseColors, [key]: value };
    setCustomColors(updated);
    setThemeId('custom-draft');
    writeStorage('nb-theme-id', 'custom-draft');
    writeStorage('nb-custom-colors', JSON.stringify(updated));
    applyColorsToDOM(updated, isColorDark(updated.bgApp), false);
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

    writeStorage('nb-saved-custom-themes', JSON.stringify(updatedList));
    writeStorage('nb-theme-id', newThemeId);
    writeStorage('nb-custom-colors', JSON.stringify(customColors));

    applyColorsToDOM(customColors, isDark, false);
  };

  const deleteCustomTheme = (id: string) => {
    const updatedList = savedCustomThemes.filter((t) => t.id !== id);
    setSavedCustomThemes(updatedList);
    writeStorage('nb-saved-custom-themes', JSON.stringify(updatedList));

    if (themeId === id) {
      selectTheme('paper');
    }
  };

  const resetCustomTheme = () => {
    const resetVal = PAPER_COLORS;
    setCustomColors(resetVal);
    setCustomThemeName('My Custom Theme');
    setThemeId('paper');
    writeStorage('nb-theme-id', 'paper');
    writeStorage('nb-custom-colors', JSON.stringify(resetVal));
    applyColorsToDOM(resetVal, false, true);
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

    // Strict validation of required color properties
    if (!bgApp || !accent || !ink) {
      return {
        success: false,
        error: 'The theme file is missing essential color definitions (App Background, Accent, or Text color).',
      };
    }

    const rawValues = [bgApp, bgPaper, bgSidebar, accent, accentSoft, gold, border, ink, inkSoft, inkMuted, hover, danger].filter(Boolean);
    const hasInvalidColor = rawValues.some((val) => !isValidColorValue(val));
    if (hasInvalidColor) {
      return {
        success: false,
        error: 'The theme file contains invalid or unsafe color values. Please check format (e.g. #RRGGBB).',
      };
    }

    const defaultBase = isColorDark(bgApp) ? INK_COLORS : PAPER_COLORS;

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

    const rawName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Imported Custom Theme';
    // Sanitize theme name
    const themeName = rawName.slice(0, 40).replace(/[<>]/g, '');
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

    writeStorage('nb-saved-custom-themes', JSON.stringify(updatedList));
    writeStorage('nb-theme-id', newId);
    writeStorage('nb-custom-colors', JSON.stringify(colors));

    applyColorsToDOM(colors, isDark, false);

    return { success: true, themeName };
  };

  const exportThemeToJSON = (targetId?: string): ExportResult => {
    const idToExport = targetId || themeId;
    let exportName = customThemeName;
    let colorsToExport = customColors;
    let darkStatus = isColorDark(customColors.bgApp);

    const resolved = resolveThemeId(idToExport);
    if (THEME_PRESETS[resolved as BuiltInThemeId]) {
      const preset = THEME_PRESETS[resolved as BuiltInThemeId];
      exportName = preset.name;
      colorsToExport = preset.colors;
      darkStatus = preset.isDark;
    } else {
      const saved = savedCustomThemes.find((t) => t.id === resolved);
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
