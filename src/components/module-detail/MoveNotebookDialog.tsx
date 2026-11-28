'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Module, Notebook } from '@/types/workspace';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

export interface MoveNotebookDialogProps {
  isOpen: boolean;
  notebook: Notebook | null;
  currentModuleId: string;
  modules: Module[];
  onClose: () => void;
  onMove: (notebookId: string, targetModuleId: string) => Promise<void>;
}

export function MoveNotebookDialog({
  isOpen,
  notebook,
  currentModuleId,
  modules,
  onClose,
  onMove,
}: MoveNotebookDialogProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Available modules to move to (excluding or highlighting current)
  const availableModules = useMemo(
    () => modules.filter((m) => !m.isArchived),
    [modules]
  );

  useEffect(() => {
    if (isOpen) {
      // Pick the first available module that isn't the current module
      const otherModule = availableModules.find((m) => m.id !== currentModuleId);
      setSelectedModuleId(otherModule ? otherModule.id : currentModuleId);
      setError(null);
    }
  }, [isOpen, currentModuleId, availableModules]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!notebook) return;

    if (!selectedModuleId || selectedModuleId === currentModuleId) {
      setError('Please select a different module to move this notebook to.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onMove(notebook.id, selectedModuleId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to move notebook');
    } finally {
      setIsSubmitting(false);
    }
  };

  const notebookTitle = notebook?.title?.trim() || 'Untitled';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Move Notebook"
      description={`Move "${notebookTitle}" to another workspace module.`}
      maxWidth={460}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSubmit()}
            isLoading={isSubmitting}
            disabled={!selectedModuleId || selectedModuleId === currentModuleId}
          >
            Move Notebook
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="target-module-select"
            style={{
              fontSize: 'var(--font-size-xs, 12px)',
              fontWeight: 500,
              color: 'var(--ink-soft)',
              fontFamily: 'var(--font)',
            }}
          >
            Target Module
          </label>

          <select
            id="target-module-select"
            value={selectedModuleId}
            onChange={(e) => {
              setSelectedModuleId(e.target.value);
              if (error) setError(null);
            }}
            className="nb-focus-ring"
            style={{
              height: 38,
              padding: '0 12px',
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-paper)',
              color: 'var(--ink)',
              border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
              fontSize: 'var(--font-size-sm, 13.5px)',
              fontFamily: 'var(--font)',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {availableModules.map((m) => (
              <option key={m.id} value={m.id} disabled={m.id === currentModuleId}>
                {m.name} {m.id === currentModuleId ? ' (Current)' : ''}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p
            style={{
              fontSize: 'var(--font-size-xs, 12px)',
              color: 'var(--danger)',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
