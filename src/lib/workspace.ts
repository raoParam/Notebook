import { db } from './db';
import { computeContentHash } from './hash';
import { deleteNoteWithTombstone } from './tombstones';
import type {
  CreateModuleInput,
  Module,
  Notebook,
  UpdateModuleInput,
} from '@/types/workspace';
import {
  DEFAULT_MODULE_ID,
  DEFAULT_MODULE_NAME,
  DEFAULT_MODULE_SLUG,
} from '@/types/workspace';

export function slugify(text: string): string {
  if (!text) return 'module';
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'module';
}

/**
 * Ensures that the default General module exists in the database.
 * Thread-safe and idempotent.
 */
export async function ensureDefaultModule(): Promise<Module> {
  const existing = await db.modules.get(DEFAULT_MODULE_ID);
  if (existing) return existing;

  const now = new Date().toISOString();
  const defaultMod: Module = {
    id: DEFAULT_MODULE_ID,
    name: DEFAULT_MODULE_NAME,
    slug: DEFAULT_MODULE_SLUG,
    description: 'Default workspace module',
    order: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.modules.put(defaultMod);
  } catch {}
  return (await db.modules.get(DEFAULT_MODULE_ID)) || defaultMod;
}

/**
 * Creates a new Module with auto-incremented order (if not provided),
 * unique slug, and persisted timestamp.
 */
export async function createModule(input: CreateModuleInput): Promise<Module> {
  if (!input || typeof input.name !== 'string' || input.name.trim() === '') {
    throw new Error('Module name cannot be empty');
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length > 100) {
    throw new Error('Module name cannot exceed 100 characters');
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const now = new Date().toISOString();

  // Generate unique slug
  let candidateSlug = input.slug?.trim() ? slugify(input.slug) : slugify(trimmedName);
  const existingModules = await db.modules.toArray();
  let disambiguator = 1;
  const originalSlug = candidateSlug;
  while (existingModules.some((m) => m.slug === candidateSlug && m.id !== id)) {
    candidateSlug = `${originalSlug}-${disambiguator++}`;
  }

  let order = input.order;
  if (order === undefined || typeof order !== 'number' || !Number.isFinite(order)) {
    const maxOrder = existingModules.reduce(
      (max, mod) =>
        Math.max(
          max,
          typeof mod.order === 'number' && Number.isFinite(mod.order) ? mod.order : -1
        ),
      -1
    );
    order = maxOrder + 1;
  }

  const newModule: Module = {
    id,
    name: trimmedName,
    slug: candidateSlug,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.color?.trim() ? { color: input.color.trim() } : {}),
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
    order,
    isArchived: input.isArchived ?? false,
    createdAt: now,
    updatedAt: now,
  };

  await db.modules.add(newModule);
  return newModule;
}

/**
 * Retrieves all modules sorted ascending by order, with createdAt as secondary sort.
 * Automatically guarantees that the default module exists if database is empty.
 */
export async function getModules(includeArchived = true): Promise<Module[]> {
  let modules = await db.modules.toArray();
  if (modules.length === 0) {
    const defaultMod = await ensureDefaultModule();
    modules = [defaultMod];
  }

  const filtered = includeArchived ? modules : modules.filter((m) => !m.isArchived);
  return filtered.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Retrieves a single module by ID.
 */
export async function getModule(id: string): Promise<Module | undefined> {
  if (!id || typeof id !== 'string') {
    return undefined;
  }
  return await db.modules.get(id);
}

/**
 * Retrieves a module by either its slug or its id.
 */
export async function getModuleBySlugOrId(identifier: string): Promise<Module | undefined> {
  if (!identifier || typeof identifier !== 'string') {
    return undefined;
  }

  const clean = identifier.trim().toLowerCase();
  if (clean === DEFAULT_MODULE_ID || clean === DEFAULT_MODULE_SLUG) {
    return await ensureDefaultModule();
  }

  const all = await getModules(true);
  return (
    all.find(
      (m) =>
        m.id === identifier ||
        m.slug?.toLowerCase() === clean ||
        slugify(m.name) === clean
    ) || undefined
  );
}

/**
 * Updates an existing module safely inside a transaction.
 */
export async function updateModule(
  id: string,
  updates: UpdateModuleInput
): Promise<Module> {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid module id');
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.trim() === '') {
      throw new Error('Module name cannot be empty');
    }
    if (updates.name.trim().length > 100) {
      throw new Error('Module name cannot exceed 100 characters');
    }
  }

  return await db.transaction('rw', db.modules, async () => {
    const existing = await db.modules.get(id);
    if (!existing) {
      throw new Error(`Module with id "${id}" not found`);
    }

    let newSlug = existing.slug;
    if (updates.slug !== undefined || updates.name !== undefined) {
      const targetSlug = updates.slug?.trim() ? slugify(updates.slug) : updates.name ? slugify(updates.name) : existing.slug;
      if (targetSlug && targetSlug !== existing.slug) {
        const others = await db.modules.toArray();
        let disambiguator = 1;
        newSlug = targetSlug;
        while (others.some((m) => m.id !== id && m.slug === newSlug)) {
          newSlug = `${targetSlug}-${disambiguator++}`;
        }
      }
    }

    const updatedModule: Module = {
      ...existing,
      ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
      ...(newSlug ? { slug: newSlug } : {}),
      ...(updates.description !== undefined
        ? updates.description.trim()
          ? { description: updates.description.trim() }
          : { description: undefined }
        : {}),
      ...(updates.color !== undefined
        ? updates.color.trim()
          ? { color: updates.color.trim() }
          : { color: undefined }
        : {}),
      ...(updates.icon !== undefined
        ? updates.icon.trim()
          ? { icon: updates.icon.trim() }
          : { icon: undefined }
        : {}),
      ...(typeof updates.order === 'number' && Number.isFinite(updates.order)
        ? { order: updates.order }
        : {}),
      ...(typeof updates.isArchived === 'boolean'
        ? { isArchived: updates.isArchived }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    if (updatedModule.description === undefined) delete updatedModule.description;
    if (updatedModule.color === undefined) delete updatedModule.color;
    if (updatedModule.icon === undefined) delete updatedModule.icon;

    await db.modules.put(updatedModule);
    return updatedModule;
  });
}

/**
 * Archives or unarchives a module.
 */
export async function archiveModule(id: string, isArchived = true): Promise<Module> {
  return await updateModule(id, { isArchived });
}

/**
 * Deletes a module. All associated notebooks are either reassigned to `reassignToModuleId`
 * (defaults to DEFAULT_MODULE_ID) or unassigned atomically.
 * Prevents deleting DEFAULT_MODULE_ID.
 * Automatically prunes deleted module from recent modules localStorage.
 */
export async function deleteModule(
  id: string,
  reassignToModuleId: string = DEFAULT_MODULE_ID
): Promise<void> {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid module id');
  }

  if (id === DEFAULT_MODULE_ID) {
    throw new Error('Cannot delete the default module');
  }

  const cleanReassignId = reassignToModuleId?.trim() ? reassignToModuleId.trim() : DEFAULT_MODULE_ID;

  if (cleanReassignId === id) {
    throw new Error('Cannot reassign notebooks to the module being deleted');
  }

  await db.transaction('rw', [db.modules, db.notes], async () => {
    const existing = await db.modules.get(id);
    if (!existing) {
      throw new Error(`Module with id "${id}" not found`);
    }

    const target = await db.modules.get(cleanReassignId);
    if (!target) {
      // Ensure default module exists if target is DEFAULT_MODULE_ID
      if (cleanReassignId === DEFAULT_MODULE_ID) {
        await db.modules.put({
          id: DEFAULT_MODULE_ID,
          name: DEFAULT_MODULE_NAME,
          slug: DEFAULT_MODULE_SLUG,
          description: 'Default workspace module',
          order: 0,
          isArchived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        throw new Error(`Target module "${cleanReassignId}" not found`);
      }
    }

    const now = new Date().toISOString();
    const affectedNotebooks = await db.notes.where('moduleId').equals(id).toArray();

    for (const notebook of affectedNotebooks) {
      notebook.moduleId = cleanReassignId;
      notebook.updatedAt = now;
      await db.notes.put(notebook);
    }

    await db.modules.delete(id);
  });

  pruneRecentModule(id);
}

/**
 * Retrieves notebooks belonging to a specific module.
 */
export async function getNotebooksByModule(
  moduleId: string,
  includeArchived = false
): Promise<Notebook[]> {
  if (!moduleId) return [];
  const cleanId = moduleId.trim();

  let notebooks = await db.notes.where('moduleId').equals(cleanId).toArray();

  // If asking for default module, also include any orphaned notes without moduleId
  if (cleanId === DEFAULT_MODULE_ID) {
    const all = await db.notes.toArray();
    const orphans = all.filter((n) => !n.moduleId || n.moduleId.trim() === '');
    const map = new Map<string, Notebook>();
    notebooks.forEach((n) => map.set(n.id, n));
    orphans.forEach((n) => map.set(n.id, n));
    notebooks = Array.from(map.values());
  }

  if (!includeArchived) {
    notebooks = notebooks.filter((n) => !n.isArchived);
  }

  return notebooks.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
      return a.order - b.order;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/**
 * Derives a human-readable URL slug for a notebook.
 */
export function getNotebookSlug(notebook: Notebook): string {
  if (notebook.slug?.trim()) return slugify(notebook.slug);
  if (notebook.title?.trim()) return slugify(notebook.title);
  return notebook.id;
}

/**
 * Retrieves a notebook by either its ID or slug within a module.
 * Internal IDs remain the primary source of truth.
 */
export async function getNotebookBySlugOrId(
  moduleId: string,
  identifier: string
): Promise<Notebook | undefined> {
  if (!identifier) return undefined;
  const clean = decodeURIComponent(identifier).trim().toLowerCase();

  // 1. Internal ID lookup first
  const byId = await db.notes.get(identifier);
  if (byId) return byId;

  // 2. Lookup in module by slug or slugified title
  const notesInModule = await getNotebooksByModule(moduleId, true);
  const bySlug = notesInModule.find(
    (n) =>
      n.id === identifier ||
      n.slug?.toLowerCase() === clean ||
      slugify(n.title) === clean
  );
  if (bySlug) return bySlug;

  // 3. Fallback across all notes in database
  const allNotes = await db.notes.toArray();
  return (
    allNotes.find(
      (n) =>
        n.id === identifier ||
        n.slug?.toLowerCase() === clean ||
        slugify(n.title) === clean
    ) || undefined
  );
}

/**
 * Resolves module and notebook by their respective slugs or IDs.
 */
export async function getModuleAndNotebookBySlugs(
  moduleSlug: string,
  notebookSlug: string
): Promise<{ module: Module | undefined; notebook: Notebook | undefined }> {
  const mod = await getModuleBySlugOrId(moduleSlug);
  if (!mod) {
    // If module not found by slug, maybe notebook exists by ID globally?
    const notebook = await getNotebookBySlugOrId(DEFAULT_MODULE_ID, notebookSlug);
    if (notebook) {
      const parentMod = notebook.moduleId ? await getModule(notebook.moduleId) : await ensureDefaultModule();
      return { module: parentMod, notebook };
    }
    return { module: undefined, notebook: undefined };
  }

  const notebook = await getNotebookBySlugOrId(mod.id, notebookSlug);
  if (notebook) {
    // If notebook exists and its actual parent module differs from requested module, resolve its true module
    if (notebook.moduleId && notebook.moduleId !== mod.id) {
      const parentMod = await getModule(notebook.moduleId);
      return { module: parentMod || mod, notebook };
    }
    return { module: mod, notebook };
  }

  return { module: mod, notebook: undefined };
}

/**
 * Creates a new notebook inside a specific module.
 */
export async function createNotebookInModule(
  moduleId: string,
  input?: { title?: string; content?: string }
): Promise<Notebook> {
  const targetModuleId = moduleId?.trim() || DEFAULT_MODULE_ID;
  const now = new Date().toISOString();
  const content = input?.content ?? '';
  const title = input?.title?.trim() ?? '';
  const attachments = {};
  const contentHash = await computeContentHash(content, attachments);

  const notebook: Notebook = {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    title,
    content,
    attachments,
    createdAt: now,
    updatedAt: now,
    contentHash,
    moduleId: targetModuleId,
    isArchived: false,
    isPinned: false,
  };

  await db.notes.add(notebook);
  return notebook;
}

/**
 * Renames a notebook.
 */
export async function renameNotebook(
  notebookId: string,
  title: string
): Promise<Notebook> {
  if (!notebookId) throw new Error('Invalid notebook id');
  return await db.transaction('rw', db.notes, async () => {
    const notebook = await db.notes.get(notebookId);
    if (!notebook) throw new Error(`Notebook with id "${notebookId}" not found`);
    notebook.title = title.trim();
    notebook.updatedAt = new Date().toISOString();
    await db.notes.put(notebook);
    return notebook;
  });
}

/**
 * Deletes a notebook with tombstone support.
 */
export async function deleteNotebook(notebookId: string): Promise<void> {
  if (!notebookId) throw new Error('Invalid notebook id');
  await deleteNoteWithTombstone(notebookId, db);
}

/**
 * Moves a notebook to a different module.
 */
export async function moveNotebookToModule(
  notebookId: string,
  targetModuleId: string
): Promise<void> {
  if (!notebookId || typeof notebookId !== 'string') {
    throw new Error('Invalid notebook id');
  }

  const cleanModuleId = targetModuleId?.trim() ? targetModuleId.trim() : DEFAULT_MODULE_ID;

  await db.transaction('rw', [db.modules, db.notes], async () => {
    const notebook = await db.notes.get(notebookId);
    if (!notebook) {
      throw new Error(`Notebook with id "${notebookId}" not found`);
    }

    const targetModule = await db.modules.get(cleanModuleId);
    if (!targetModule) {
      throw new Error(`Module with id "${cleanModuleId}" not found`);
    }

    notebook.moduleId = cleanModuleId;
    notebook.updatedAt = new Date().toISOString();
    await db.notes.put(notebook);
  });
}

/**
 * Sets the order of modules in bulk based on an ordered list of module IDs.
 */
export async function reorderModules(orderedIds: string[]): Promise<void> {
  if (!Array.isArray(orderedIds)) return;

  await db.transaction('rw', db.modules, async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const mod = await db.modules.get(id);
      if (mod && mod.order !== i) {
        mod.order = i;
        mod.updatedAt = now;
        await db.modules.put(mod);
      }
    }
  });
}

/**
 * Toggles or sets notebook archive status.
 */
export async function archiveNotebook(
  notebookId: string,
  isArchived = true
): Promise<void> {
  if (!notebookId) throw new Error('Invalid notebook id');
  await db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(notebookId);
    if (!note) throw new Error(`Notebook with id "${notebookId}" not found`);
    note.isArchived = isArchived;
    note.updatedAt = new Date().toISOString();
    await db.notes.put(note);
  });
}

/**
 * Toggles or sets notebook pinned status.
 */
export async function pinNotebook(
  notebookId: string,
  isPinned = true
): Promise<void> {
  if (!notebookId) throw new Error('Invalid notebook id');
  await db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(notebookId);
    if (!note) throw new Error(`Notebook with id "${notebookId}" not found`);
    note.isPinned = isPinned;
    note.updatedAt = new Date().toISOString();
    await db.notes.put(note);
  });
}

/**
 * Sets the order of notebooks in bulk based on an ordered list of notebook IDs.
 */
export async function reorderNotebooks(orderedNotebookIds: string[]): Promise<void> {
  if (!Array.isArray(orderedNotebookIds)) return;

  await db.transaction('rw', db.notes, async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedNotebookIds.length; i++) {
      const id = orderedNotebookIds[i];
      const note = await db.notes.get(id);
      if (note && note.order !== i) {
        note.order = i;
        note.updatedAt = now;
        await db.notes.put(note);
      }
    }
  });
}

const RECENT_MODULES_KEY = 'nb-recent-modules';

/**
 * Prunes a module ID from local storage history.
 */
export function pruneRecentModule(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const raw = localStorage.getItem(RECENT_MODULES_KEY);
    if (raw) {
      const existing: unknown = JSON.parse(raw);
      if (Array.isArray(existing)) {
        const updated = existing.filter((item) => item !== id);
        localStorage.setItem(RECENT_MODULES_KEY, JSON.stringify(updated));
      }
    }
  } catch {}
}

/**
 * Records that a module was opened in local storage history.
 */
export function recordModuleOpen(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const raw = localStorage.getItem(RECENT_MODULES_KEY);
    const existing: unknown = raw ? JSON.parse(raw) : [];
    const validArray: string[] = Array.isArray(existing)
      ? existing.filter((item): item is string => typeof item === 'string')
      : [];
    const updated = [id, ...validArray.filter((item) => item !== id)].slice(0, 10);
    localStorage.setItem(RECENT_MODULES_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Retrieves recently opened modules.
 * Automatically prunes invalid, deleted, or archived module IDs from localStorage (self-healing).
 */
export async function getRecentModules(limit = 4): Promise<Module[]> {
  let ids: string[] = [];
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(RECENT_MODULES_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          ids = parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
        }
      }
    } catch {}
  }

  const all = await getModules(false);
  const byId = new Map(all.map((m) => [m.id, m]));

  // Filter out any IDs that no longer exist or are archived
  const validIds = ids.filter((id) => byId.has(id));

  // Self-heal localStorage if any invalid/deleted IDs were found
  if (validIds.length !== ids.length && typeof window !== 'undefined') {
    try {
      localStorage.setItem(RECENT_MODULES_KEY, JSON.stringify(validIds));
    } catch {}
  }

  const recent: Module[] = [];
  for (const id of validIds) {
    const mod = byId.get(id);
    if (mod) {
      recent.push(mod);
      if (recent.length >= limit) break;
    }
  }

  // If no recent ones stored yet, return the first few non-archived modules
  if (recent.length === 0) {
    return all.slice(0, limit);
  }

  return recent;
}
