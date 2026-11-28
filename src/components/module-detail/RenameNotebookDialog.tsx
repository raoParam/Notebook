'use client';

import React, { useEffect, useState } from 'react';
import type { Notebook } from '@/types/workspace';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface RenameNotebookDialogProps {
  isOpen: boolean;
  notebook: Notebook | null;
  onClose: () => void;
  onSave: (id: string, newTitle: string) => Promise<void>;
}

export function RenameNotebookDialog({
  isOpen,
  notebook,
  onClose,
  onSave,
}: RenameNotebookDialogProps) {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (notebook) {
      setTitle(notebook.title || '');
      setError(null);
    }
  }, [notebook, isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!notebook) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await onSave(notebook.id, title.trim());
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rename notebook');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Notebook"
      description="Update the display title of this notebook."
      maxWidth={440}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSubmit()}
            isLoading={isSubmitting}
          >
            Save
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input
          label="Notebook Title"
          placeholder="e.g. Project Roadmap"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          error={error || undefined}
          autoFocus
        />
      </form>
    </Dialog>
  );
}
