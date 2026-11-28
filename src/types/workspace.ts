/**
 * Workspace Data Architecture Types
 * Defines Modules and Notebooks with complete backward compatibility for existing Note records.
 */

export const DEFAULT_MODULE_ID = 'default-module';
export const DEFAULT_MODULE_NAME = 'General';
export const DEFAULT_MODULE_SLUG = 'general';

export interface AttachmentEntry {
  name: string;
  data: string; // base64 data URL
  createdAt: string;
}

export interface Module {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  icon?: string;
  order: number;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_MODULE: Module = {
  id: DEFAULT_MODULE_ID,
  name: DEFAULT_MODULE_NAME,
  slug: DEFAULT_MODULE_SLUG,
  description: 'Default workspace module',
  order: 0,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export interface Notebook {
  id: string;
  title: string;
  content: string;
  /** attachment id → base64 data URL */
  attachments: Record<string, AttachmentEntry>;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 hex of content + serialized attachments */
  contentHash: string;
  moduleId?: string;
  slug?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  order?: number;
}

/**
 * 100% backward-compatible alias for existing consumers.
 * Every Note is a Notebook and vice versa.
 */
export type Note = Notebook;

export interface CreateModuleInput {
  name: string;
  slug?: string;
  description?: string;
  color?: string;
  icon?: string;
  order?: number;
  isArchived?: boolean;
}

export interface UpdateModuleInput {
  name?: string;
  slug?: string;
  description?: string;
  color?: string;
  icon?: string;
  order?: number;
  isArchived?: boolean;
}

export interface CreateNotebookInput {
  title?: string;
  content?: string;
  attachments?: Record<string, AttachmentEntry>;
  moduleId?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  order?: number;
}

export interface UpdateNotebookInput {
  title?: string;
  content?: string;
  attachments?: Record<string, AttachmentEntry>;
  moduleId?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  order?: number;
}
