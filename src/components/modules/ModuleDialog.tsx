'use client';

import React, { useEffect, useState } from 'react';
import type { Module } from '@/types/workspace';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CheckIcon } from '@/components/ui/icons';

export const EARTHY_COLOR_PALETTE = [
  { label: 'Terracotta', value: 'var(--accent)' },
  { label: 'Ochre Gold', value: 'var(--gold)' },
  { label: 'Forest Sage', value: 'var(--success)' },
  { label: 'Warm Amber', value: 'var(--warning)' },
  { label: 'Muted Slate', value: 'var(--info)' },
  { label: 'Soft Terracotta', value: 'var(--accent-soft)' },
  { label: 'Charcoal', value: 'var(--ink-soft)' },
];

export interface CreateModuleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; color?: string }) => Promise<void> | void;
}

export function CreateModuleDialog({ isOpen, onClose, onSubmit }: CreateModuleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(EARTHY_COLOR_PALETTE[0].value);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setColor(EARTHY_COLOR_PALETTE[0].value);
      setError('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Module name is required');
      return;
    }
    if (trimmed.length > 100) {
      setError('Module name cannot exceed 100 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        name: trimmed,
        description: description.trim() || undefined,
        color,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create module');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Module"
      description="Group notebooks into a focused collection or subject."
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSubmitting}>
            Create Module
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Input
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. Work Projects, Research, Philosophy..."
            error={error}
            autoFocus
            required
            maxLength={100}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label
            style={{
              fontSize: 'var(--font-size-xs, 12px)',
              fontWeight: 500,
              color: 'var(--ink-soft)',
              fontFamily: 'var(--font)',
            }}
          >
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this module for?"
            rows={3}
            className="nb-focus-ring"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontFamily: 'var(--font)',
              fontSize: 'var(--font-size-sm, 13px)',
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-control)',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label
            style={{
              fontSize: 'var(--font-size-xs, 12px)',
              fontWeight: 500,
              color: 'var(--ink-soft)',
              fontFamily: 'var(--font)',
            }}
          >
            Module Color
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {EARTHY_COLOR_PALETTE.map((palette) => {
              const isSelected = color === palette.value;
              return (
                <button
                  key={palette.label}
                  type="button"
                  title={palette.label}
                  onClick={() => setColor(palette.value)}
                  className="nb-focus-ring"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: palette.value,
                    border: isSelected ? '2px solid var(--ink)' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    padding: 0,
                    boxShadow: 'var(--shadow-sm)',
                    transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.15s ease, border-color 0.15s ease',
                  }}
                  aria-label={`Select ${palette.label} color`}
                  aria-pressed={isSelected}
                >
                  {isSelected && <CheckIcon size={13} />}
                </button>
              );
            })}
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export interface RenameModuleDialogProps {
  module: Module | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, name: string) => Promise<void> | void;
}

export function RenameModuleDialog({
  module,
  isOpen,
  onClose,
  onSubmit,
}: RenameModuleDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && module) {
      setName(module.name);
      setError('');
      setIsSubmitting(false);
    }
  }, [isOpen, module]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!module) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Module name is required');
      return;
    }
    if (trimmed.length > 100) {
      setError('Module name cannot exceed 100 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit(module.id, trimmed);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rename module');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen && Boolean(module)}
      onClose={onClose}
      title="Rename Module"
      description={`Enter a new name for "${module?.name}".`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSubmitting}>
            Save Changes
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input
          label="Module Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          error={error}
          autoFocus
          required
          maxLength={100}
        />
      </form>
    </Dialog>
  );
}
