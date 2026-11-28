'use client';

import React, { useState } from 'react';
import type { Notebook } from '@/types/workspace';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

export interface DeleteNotebookDialogProps {
  isOpen: boolean;
  notebook: Notebook | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteNotebookDialog({
  isOpen,
  notebook,
  onClose,
  onConfirm,
}: DeleteNotebookDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!notebook) return;
    try {
      setIsDeleting(true);
      setError(null);
      await onConfirm(notebook.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete notebook');
    } finally {
      setIsDeleting(false);
    }
  };

  const notebookTitle = notebook?.title?.trim() || 'Untitled';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Notebook"
      maxWidth={440}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={isDeleting}
          >
            Delete
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p
          style={{
            fontFamily: 'var(--font)',
            fontSize: 'var(--font-size-sm, 13.5px)',
            color: 'var(--ink-soft)',
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Are you sure you want to delete <strong>&ldquo;{notebookTitle}&rdquo;</strong>? This will remove the notebook and sync the deletion across your paired devices.
        </p>

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
      </div>
    </Dialog>
  );
}
