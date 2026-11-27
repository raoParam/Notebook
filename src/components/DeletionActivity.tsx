'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DeletionDeliveryStatus } from '@/lib/db';
import {
  loadDeletionActivity,
  type DeletionActivityEntry,
} from '@/lib/tombstones';

const STATUS_META: Record<
  DeletionDeliveryStatus,
  { label: string; description: string; dotColor: string; textColor: string; bg: string }
> = {
  accepted: {
    label: 'Confirmed',
    description: 'Deletion confirmed on this device',
    dotColor: '#16a34a',
    textColor: 'var(--ink)',
    bg: 'rgba(34, 197, 94, 0.14)',
  },
  failed: {
    label: 'Not confirmed',
    description: 'Deletion not confirmed; device may still have a copy',
    dotColor: 'var(--danger)',
    textColor: 'var(--danger)',
    bg: 'rgba(239, 68, 68, 0.12)',
  },
  superseded: {
    label: 'Newer copy kept',
    description: 'A newer version existed; that copy was kept',
    dotColor: 'var(--gold)',
    textColor: 'var(--ink)',
    bg: 'rgba(245, 158, 11, 0.15)',
  },
  pending: {
    label: 'Pending',
    description: 'Waiting for confirmation',
    dotColor: 'var(--accent)',
    textColor: 'var(--accent)',
    bg: 'var(--bg-sidebar)',
  },
};

function formatDeletionDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeOutcome(entry: DeletionActivityEntry): string | null {
  if (entry.recipients.length === 0) {
    return entry.origin === 'local'
      ? 'No connected devices'
      : 'Received from paired device';
  }
  if (entry.recipients.length === 1) {
    return null;
  }

  let accepted = 0;
  let failed = 0;
  let superseded = 0;
  let pending = 0;
  for (const r of entry.recipients) {
    if (r.status === 'accepted') accepted++;
    else if (r.status === 'failed') failed++;
    else if (r.status === 'superseded') superseded++;
    else pending++;
  }

  const total = entry.recipients.length;
  if (accepted === total) return `Confirmed on all ${total} devices`;
  if (failed === total) return `Not confirmed on ${total} devices`;
  if (superseded === total) return `Newer copy kept on ${total} devices`;
  if (pending === total) return `Waiting on ${total} devices`;

  const parts: string[] = [];
  if (accepted > 0) parts.push(`${accepted} confirmed`);
  if (failed > 0) parts.push(`${failed} not confirmed`);
  if (superseded > 0) parts.push(`${superseded} newer copy kept`);
  if (pending > 0) parts.push(`${pending} pending`);
  return parts.join(' · ');
}

export function DeletionActivity() {
  const [entries, setEntries] = useState<DeletionActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await loadDeletionActivity();
      setEntries(next);
    } catch {
      setError('Unable to load deletion activity.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadDeletionActivity();
        if (!cancelled) {
          setEntries(next);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load deletion activity.');
        }
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

  return (
    <section aria-labelledby="deletion-activity-heading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3
            id="deletion-activity-heading"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}
          >
            Deletion Activity
          </h3>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.45 }}>
            Recent note deletions and whether connected paired devices confirmed them.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading}
          style={{
            padding: '6px 11px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--ink-soft)',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.65 : 1,
            flexShrink: 0,
          }}
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '12px 14px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 12.5,
            color: 'var(--ink-soft)',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!error && isLoading && entries.length === 0 && (
        <div
          style={{
            padding: '16px 14px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12.5,
            color: 'var(--ink-muted)',
          }}
        >
          Loading deletion activity…
        </div>
      )}

      {!error && !isLoading && entries.length === 0 && (
        <div
          style={{
            padding: '16px 14px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            No recent deletions
          </div>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.45 }}>
            When you delete a note, delivery feedback for connected paired devices will appear here.
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-app)',
            overflow: 'hidden',
          }}
        >
          {entries.map((entry, index) => {
            const summary = summarizeOutcome(entry);
            return (
              <div
                key={entry.id}
                data-testid="deletion-activity-item"
                style={{
                  padding: '12px 14px',
                  borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '4px 12px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--serif-font)',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {entry.noteTitle}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', flexShrink: 0 }}>
                    {formatDeletionDateTime(entry.deletedAt)}
                  </div>
                </div>

                {summary && (
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-soft)' }}>
                    {summary}
                  </div>
                )}

                {entry.recipients.length === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-soft)',
                      lineHeight: 1.45,
                      padding: '8px 10px',
                      background: 'var(--bg-paper)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {entry.origin === 'local'
                      ? 'No paired devices were connected when this note was deleted. Offline devices may still retain their copies.'
                      : 'Deleted on a paired device and removed from this device.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {entry.recipients.map((recipient) => {
                      const meta = STATUS_META[recipient.status];
                      return (
                        <div
                          key={recipient.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '4px 10px',
                            padding: '7px 10px',
                            background: 'var(--bg-paper)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 7,
                              minWidth: 0,
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: meta.dotColor,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: recipient.pairingMissing ? 'var(--ink-soft)' : 'var(--ink)',
                              }}
                            >
                              {recipient.deviceName}
                            </span>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: 999,
                                background: meta.bg,
                                color: meta.textColor,
                                flexShrink: 0,
                              }}
                            >
                              {meta.label}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                              {meta.description}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
