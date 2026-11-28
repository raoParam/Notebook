'use client';

import React, { useState } from 'react';
import type { Module } from '@/types/workspace';
import { DEFAULT_MODULE_ID } from '@/types/workspace';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

export interface DeleteModuleDialogProps {
  module: Module | null;
  notebookCount?: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void> | void;
}

export function DeleteModuleDialog({
  module,
  notebookCount = 0,
  isOpen,
  onClose,
  onConfirm,
}: DeleteModuleDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!module) return null;

  const isDefault = module.id === DEFAULT_MODULE_ID;

  const handleConfirm = async () => {
    if (isDefault) return;
    try {
      setIsSubmitting(true);
      setError('');
      await onConfirm(module.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete module');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isDefault) {
    return (
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title="Cannot Delete Default Module"
        description="The General module is the default module of the workspace and cannot be deleted."
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="secondary" onClick={onClose}>
              Dismiss
            </Button>
          </div>
        }
      >
        <p style={{ fontSize: 'var(--font-size-sm, 13px)', color: 'var(--ink-soft)', margin: 0 }}>
          This module is used to safely hold orphan notes and notebooks when other modules are deleted.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Module"
      description={`Are you sure you want to delete "${module.name}"?`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} isLoading={isSubmitting}>
            Delete Module
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p
          style={{
            fontSize: 'var(--font-size-sm, 13px)',
            color: 'var(--ink)',
            lineHeight: '1.5',
            margin: 0,
          }}
        >
          {notebookCount > 0 ? (
            <>
              This module contains{' '}
              <strong>
                {notebookCount} {notebookCount === 1 ? 'notebook' : 'notebooks'}
              </strong>
              . Deleting this module will <strong>not</strong> delete your notes. They will be
              automatically and safely reassigned to the <strong>General</strong> module.
            </>
          ) : (
            <>This module is currently empty. Deleting it will permanently remove it from your workspace.</>
          )}
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
