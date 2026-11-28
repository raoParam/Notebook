'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Module } from '@/types/workspace';
import { DEFAULT_MODULE_ID } from '@/types/workspace';
import {
  getModules,
  getRecentModules,
  recordModuleOpen,
  createModule,
  updateModule,
  archiveModule,
  deleteModule,
} from '@/lib/workspace';
import { db } from '@/lib/db';
import { SearchInput } from '@/components/ui/SearchInput';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SpinnerIcon, ChevronDownIcon } from '@/components/ui/icons';
import { ModulesHeader } from '@/components/modules/ModulesHeader';
import { ModuleCard } from '@/components/modules/ModuleCard';
import {
  CreateModuleDialog,
  RenameModuleDialog,
} from '@/components/modules/ModuleDialog';
import { DeleteModuleDialog } from '@/components/modules/DeleteModuleDialog';
import {
  FolderIcon,
  SortIcon,
  ClockIcon,
  GridIcon,
} from '@/components/modules/icons';

type SortOption = 'order' | 'name' | 'updated';
type FilterTab = 'all' | 'active' | 'archived';

export default function ModulesPage() {
  const router = useRouter();

  // State
  const [modules, setModules] = useState<Module[]>([]);
  const [recentModules, setRecentModules] = useState<Module[]>([]);
  const [notebookCounts, setNotebookCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<SortOption>('order');

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [moduleToRename, setModuleToRename] = useState<Module | null>(null);
  const [moduleToDelete, setModuleToDelete] = useState<Module | null>(null);

  // Load modules and notebook counts
  const loadData = useCallback(async () => {
    try {
      const [allMods, recents, allNotes] = await Promise.all([
        getModules(true),
        getRecentModules(4),
        db.notes.toArray(),
      ]);

      // Calculate notebook counts per module
      const counts: Record<string, number> = {};
      for (const note of allNotes) {
        const modId = note.moduleId || DEFAULT_MODULE_ID;
        counts[modId] = (counts[modId] || 0) + 1;
      }

      setModules(allMods);
      setRecentModules(recents);
      setNotebookCounts(counts);
    } catch (err) {
      console.error('Failed to load workspace modules:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [allMods, recents, allNotes] = await Promise.all([
          getModules(true),
          getRecentModules(4),
          db.notes.toArray(),
        ]);
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const note of allNotes) {
          const modId = note.moduleId || DEFAULT_MODULE_ID;
          counts[modId] = (counts[modId] || 0) + 1;
        }
        setModules(allMods);
        setRecentModules(recents);
        setNotebookCounts(counts);
      } catch (err) {
        console.error('Failed to load workspace modules:', err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Open module action
  const handleOpenModule = useCallback(
    (module: Module) => {
      recordModuleOpen(module.id);
      const targetSlug = module.slug || module.id;
      router.push(`/${targetSlug}`);
    },
    [router]
  );

  // Create module action
  const handleCreateModule = async (data: {
    name: string;
    description?: string;
    color?: string;
  }) => {
    const newMod = await createModule(data);
    recordModuleOpen(newMod.id);
    await loadData();
  };

  // Rename module action
  const handleRenameModule = async (id: string, name: string) => {
    await updateModule(id, { name });
    await loadData();
  };

  // Archive / unarchive module action
  const handleToggleArchive = async (module: Module) => {
    await archiveModule(module.id, !module.isArchived);
    await loadData();
  };

  // Delete module action
  const handleDeleteModule = async (id: string) => {
    await deleteModule(id, DEFAULT_MODULE_ID);
    await loadData();
  };

  // Tab definitions with counts
  const activeCount = useMemo(
    () => modules.filter((m) => !m.isArchived).length,
    [modules]
  );
  const archivedCount = useMemo(
    () => modules.filter((m) => m.isArchived).length,
    [modules]
  );

  const filterTabs: TabItem[] = useMemo(
    () => [
      { id: 'all', label: 'All', badge: modules.length },
      { id: 'active', label: 'Active', badge: activeCount },
      { id: 'archived', label: 'Archived', badge: archivedCount },
    ],
    [modules.length, activeCount, archivedCount]
  );

  // Sort label display
  const sortLabelMap: Record<SortOption, string> = {
    order: 'Order',
    name: 'Name (A–Z)',
    updated: 'Recently Updated',
  };

  const sortItems: DropdownItem[] = [
    {
      id: 'order',
      label: 'Order',
      onClick: () => setSortBy('order'),
    },
    {
      id: 'name',
      label: 'Name (A–Z)',
      onClick: () => setSortBy('name'),
    },
    {
      id: 'updated',
      label: 'Recently Updated',
      onClick: () => setSortBy('updated'),
    },
  ];

  // Filter and sort modules
  const processedModules = useMemo(() => {
    let result = [...modules];

    // Filter by tab
    if (filterTab === 'active') {
      result = result.filter((m) => !m.isArchived);
    } else if (filterTab === 'archived') {
      result = result.filter((m) => m.isArchived);
    }

    // Filter by search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q) ||
          m.slug?.toLowerCase().includes(q)
      );
    }

    // Sort modules
    result.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'updated') {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      }
      // Default: order
      if (a.order !== b.order) {
        return (a.order ?? 0) - (b.order ?? 0);
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    return result;
  }, [modules, filterTab, searchQuery, sortBy]);

  // Determine if Recently Opened section should be displayed
  const showRecentSection =
    recentModules.length > 0 &&
    searchQuery.trim() === '' &&
    filterTab !== 'archived';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-app)',
        color: 'var(--ink)',
        overflow: 'hidden',
      }}
    >
      {/* Top Header */}
      <ModulesHeader
        totalModules={modules.length}
        onNewModule={() => setIsCreateOpen(true)}
      />

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 24px 64px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: 1120 }}>
          {/* Loading state */}
          {isLoading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '80px 0',
                color: 'var(--ink-soft)',
                gap: 12,
              }}
            >
              <SpinnerIcon size={24} />
              <span style={{ fontSize: 'var(--font-size-sm, 13px)' }}>
                Loading modules…
              </span>
            </div>
          ) : (
            <>
              {/* Recently Opened Section */}
              {showRecentSection && (
                <section style={{ marginBottom: 36 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 14,
                    }}
                  >
                    <ClockIcon size={15} style={{ color: 'var(--ink-muted)' }} />
                    <h2
                      style={{
                        fontFamily: 'var(--serif-font)',
                        fontSize: 'var(--font-size-base, 16px)',
                        fontWeight: 600,
                        color: 'var(--ink-soft)',
                        letterSpacing: '-0.01em',
                        margin: 0,
                      }}
                    >
                      Recently Opened
                    </h2>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                      gap: 12,
                    }}
                  >
                    {recentModules.map((mod) => (
                      <ModuleCard
                        key={`recent-${mod.id}`}
                        module={mod}
                        notebookCount={notebookCounts[mod.id] || 0}
                        variant="compact"
                        onOpen={handleOpenModule}
                        onRename={(m) => setModuleToRename(m)}
                        onToggleArchive={handleToggleArchive}
                        onDelete={(m) => setModuleToDelete(m)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* All Modules Section */}
              <section>
                {/* Section Header & Toolbar */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <GridIcon size={16} style={{ color: 'var(--ink-muted)' }} />
                      <h2
                        style={{
                          fontFamily: 'var(--serif-font)',
                          fontSize: 'var(--font-size-lg, 18px)',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          margin: 0,
                        }}
                      >
                        All Modules
                      </h2>
                    </div>

                    {/* Filter Tabs */}
                    <div style={{ width: 'auto' }}>
                      <Tabs
                        variant="contained"
                        items={filterTabs}
                        activeTab={filterTab}
                        onChange={(id) => setFilterTab(id as FilterTab)}
                        aria-label="Filter modules"
                      />
                    </div>
                  </div>

                  {/* Search and Sort Toolbar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    {/* Search Input */}
                    <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
                      <SearchInput
                        placeholder="Search modules by name or description…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClear={() => setSearchQuery('')}
                      />
                    </div>

                    {/* Sort Dropdown */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 'var(--font-size-xs, 12px)',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        Sort by:
                      </span>
                      <Dropdown
                        align="right"
                        trigger={
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<SortIcon size={13} />}
                            rightIcon={<ChevronDownIcon size={12} />}
                          >
                            {sortLabelMap[sortBy]}
                          </Button>
                        }
                        items={sortItems}
                      />
                    </div>
                  </div>
                </div>

                {/* Modules Grid or Empty State */}
                {processedModules.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: 16,
                    }}
                  >
                    {processedModules.map((mod) => (
                      <ModuleCard
                        key={mod.id}
                        module={mod}
                        notebookCount={notebookCounts[mod.id] || 0}
                        variant="standard"
                        onOpen={handleOpenModule}
                        onRename={(m) => setModuleToRename(m)}
                        onToggleArchive={handleToggleArchive}
                        onDelete={(m) => setModuleToDelete(m)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      background: 'var(--bg-paper)',
                      borderRadius: 'var(--radius-panel, 12px)',
                      border: '1px solid var(--border)',
                      marginTop: 8,
                    }}
                  >
                    {searchQuery.trim() ? (
                      <EmptyState
                        icon={<FolderIcon size={24} />}
                        title="No matching modules"
                        description={`No modules found matching "${searchQuery}". Check the spelling or try another search.`}
                        action={{
                          label: 'Clear search',
                          onClick: () => setSearchQuery(''),
                          variant: 'secondary',
                        }}
                      />
                    ) : filterTab === 'archived' ? (
                      <EmptyState
                        icon={<FolderIcon size={24} />}
                        title="No archived modules"
                        description="Modules you archive will be stored here safely until you choose to restore them."
                      />
                    ) : (
                      <EmptyState
                        icon={<FolderIcon size={24} />}
                        title="No modules found"
                        description="Create your first module to organize your notebooks into structured subjects."
                        action={{
                          label: 'Create Module',
                          onClick: () => setIsCreateOpen(true),
                          variant: 'primary',
                        }}
                      />
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Dialogs */}
      <CreateModuleDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateModule}
      />

      <RenameModuleDialog
        module={moduleToRename}
        isOpen={Boolean(moduleToRename)}
        onClose={() => setModuleToRename(null)}
        onSubmit={handleRenameModule}
      />

      <DeleteModuleDialog
        module={moduleToDelete}
        notebookCount={moduleToDelete ? notebookCounts[moduleToDelete.id] || 0 : 0}
        isOpen={Boolean(moduleToDelete)}
        onClose={() => setModuleToDelete(null)}
        onConfirm={handleDeleteModule}
      />
    </div>
  );
}
