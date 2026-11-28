import type { ThemeColors } from '@/components/ThemeProvider';

export interface SettingsModalProps {
  onClose: () => void;
  autoSyncEnabled?: boolean;
  onToggleAutoSync?: (enabled: boolean) => void;
}

export type SettingsTab = 'appearance' | 'sync';
export type ImportMode = 'file' | 'text';

export interface ColorFieldDefinition {
  key: keyof ThemeColors;
  label: string;
  cssVar: string;
}

export const COLOR_FIELDS: ColorFieldDefinition[] = [
  { key: 'bgApp', label: 'App Background', cssVar: '--bg-app' },
  { key: 'bgPaper', label: 'Surface / Card', cssVar: '--bg-paper' },
  { key: 'bgSidebar', label: 'Sidebar Background', cssVar: '--bg-sidebar' },
  { key: 'accent', label: 'Primary Color', cssVar: '--accent' },
  { key: 'accentSoft', label: 'Secondary Color', cssVar: '--accent-soft' },
  { key: 'gold', label: 'Accent Color', cssVar: '--gold' },
  { key: 'border', label: 'Border Color', cssVar: '--border' },
  { key: 'ink', label: 'Primary Text', cssVar: '--ink' },
  { key: 'inkSoft', label: 'Secondary Text', cssVar: '--ink-soft' },
  { key: 'inkMuted', label: 'Muted Text', cssVar: '--ink-muted' },
  { key: 'hover', label: 'Hover Background', cssVar: '--hover' },
  { key: 'danger', label: 'Danger Color', cssVar: '--danger' },
];
