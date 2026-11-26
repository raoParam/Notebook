'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Pairing } from '@/lib/db';
import type { PeerNotePreview, PeerNoteRelation } from '@/lib/sync';
import type { ManualPreviewState, PeerState, SyncStatus } from '@/hooks/useSync';

export interface SyncDialogProps {
  pairings: Pairing[];
  connectedPeers: PeerState[];
  manualPreview: ManualPreviewState;
  syncStatus: SyncStatus;
  autoSyncEnabled: boolean;
  peerAutoSync: Record<string, boolean>;
  onSelectPairing: (pairingId: string) => void;
  onRefreshManifest: (pairingId: string) => void;
  onSyncAll: (pairingId: string) => void;
  onSyncSelected: (pairingId: string, noteIds: string[]) => void;
  onDeny: () => void;
  onOpenPairDevice: () => void;
}

const RELATION_META: Record<
  PeerNoteRelation,
  { label: string; bg: string; color: string }
> = {
  new: { label: 'New', bg: 'rgba(34, 197, 94, 0.14)', color: '#15803d' },
  updated: { label: 'Updated', bg: 'rgba(59, 130, 246, 0.14)', color: '#1d4ed8' },
  identical: { label: 'Identical', bg: 'rgba(148, 163, 184, 0.16)', color: 'var(--ink-muted)' },
  'local-newer': { label: 'Local newer', bg: 'rgba(245, 158, 11, 0.16)', color: '#b45309' },
  conflict: { label: 'Conflict', bg: 'rgba(239, 68, 68, 0.14)', color: 'var(--danger)' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SyncDialog({
  pairings,
  connectedPeers,
  manualPreview,
  syncStatus,
  autoSyncEnabled,
  peerAutoSync,
  onSelectPairing,
  onRefreshManifest,
  onSyncAll,
  onSyncSelected,
  onDeny,
  onOpenPairDevice,
}: SyncDialogProps) {
  const initialPairingId = useMemo(() => {
    const firstOnline = pairings.find((p) =>
      connectedPeers.some((c) => c.pairingId === p.id)
    );
    return firstOnline?.id ?? pairings[0]?.id ?? '';
  }, [connectedPeers, pairings]);

  const [selectedPairingId, setSelectedPairingId] = useState<string>(initialPairingId);
  const [showSelectiveList, setShowSelectiveList] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activePairingId = pairings.some((p) => p.id === selectedPairingId)
    ? selectedPairingId
    : initialPairingId;

  useEffect(() => {
    if (activePairingId) {
      onSelectPairing(activePairingId);
    }
    // Request fresh manifest when the selected pairing changes or dialogue opens.
  }, [activePairingId, onSelectPairing]);

  const activeConnectedPeer = connectedPeers.find((p) => p.pairingId === activePairingId) ?? null;
  const isPeerOnline = activeConnectedPeer !== null;
  const peerKey = activeConnectedPeer
    ? `${activeConnectedPeer.pairingId}\x00${activeConnectedPeer.peerId}`
    : '';
  const bothAutoSyncEnabled = Boolean(
    autoSyncEnabled && peerKey && peerAutoSync[peerKey] === true
  );

  const isSyncBusy =
    syncStatus.stage === 'connecting' ||
    syncStatus.stage === 'exchanging' ||
    syncStatus.stage === 'transferring';

  const readyNotes: PeerNotePreview[] = useMemo(
    () =>
      manualPreview.stage === 'ready' && manualPreview.pairingId === activePairingId
        ? manualPreview.notes
        : [],
    [activePairingId, manualPreview]
  );

  const isPreviewReady =
    manualPreview.stage === 'ready' && manualPreview.pairingId === activePairingId;

  const newCount = readyNotes.filter((n) => n.relation === 'new').length;
  const updatedCount = readyNotes.filter((n) => n.relation === 'updated').length;

  const toggleNoteSelection = (noteId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const selectAllNotes = () => {
    setSelectedIds(new Set(readyNotes.map((n) => n.noteId)));
  };

  const selectNewAndUpdated = () => {
    setSelectedIds(
      new Set(
        readyNotes
          .filter((n) => n.relation === 'new' || n.relation === 'updated')
          .map((n) => n.noteId)
      )
    );
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handlePairingChange = (nextId: string) => {
    setSelectedPairingId(nextId);
    setSelectedIds(new Set());
    setShowSelectiveList(false);
  };

  const handleToggleSelective = () => {
    setShowSelectiveList((prev) => {
      const next = !prev;
      if (next && selectedIds.size === 0 && readyNotes.length > 0) {
        const actionable = readyNotes
          .filter((n) => n.relation === 'new' || n.relation === 'updated')
          .map((n) => n.noteId);
        if (actionable.length > 0) {
          setSelectedIds(new Set(actionable));
        }
      }
      return next;
    });
  };

  const selectedArray = Array.from(selectedIds).filter((id) =>
    readyNotes.some((n) => n.noteId === id)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-dialog-title"
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSyncBusy) {
          onDeny();
        }
      }}
    >
      <div style={panelStyle} className="animate-fade-in">
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              id="sync-dialog-title"
              style={{
                fontFamily: 'var(--serif-font)',
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--accent)',
              }}
            >
              Sync with Paired Device
            </h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
              Inspect available notes on the peer before transferring.
            </p>
          </div>
          <button
            type="button"
            onClick={onDeny}
            disabled={isSyncBusy}
            title="Close"
            aria-label="Close sync dialogue"
            style={closeBtnStyle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Empty pairings state */}
        {pairings.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              background: 'var(--bg-sidebar)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              textAlign: 'center',
            }}
          >
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
              No paired devices yet. Pair a device first to synchronize notes.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" onClick={onDeny} style={secondaryBtnStyle}>
                Deny sync
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeny();
                  onOpenPairDevice();
                }}
                style={primaryBtnStyle}
              >
                Pair Device
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Device selector & status */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--bg-sidebar)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
              }}
            >
              <label
                htmlFor="sync-device-select"
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}
              >
                Device:
              </label>
              <select
                id="sync-device-select"
                value={activePairingId}
                onChange={(e) => handlePairingChange(e.target.value)}
                disabled={isSyncBusy}
                style={{
                  flex: 1,
                  minWidth: 160,
                  padding: '6px 8px',
                  fontSize: 13,
                  background: 'var(--bg-paper)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                }}
              >
                {pairings.map((p) => {
                  const online = connectedPeers.some((c) => c.pairingId === p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.label} ({online ? 'Online' : 'Offline'})
                    </option>
                  );
                })}
              </select>

              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: isPeerOnline ? 'rgba(34, 197, 94, 0.14)' : 'rgba(148, 163, 184, 0.16)',
                  color: isPeerOnline ? '#15803d' : 'var(--ink-muted)',
                }}
              >
                {isPeerOnline ? 'Online' : 'Offline'}
              </span>

              {bothAutoSyncEnabled && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '3px 8px',
                    borderRadius: 999,
                    background: 'var(--bg-paper)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent)',
                  }}
                >
                  Auto-sync active
                </span>
              )}

              <button
                type="button"
                onClick={() => onRefreshManifest(activePairingId)}
                disabled={isSyncBusy || manualPreview.stage === 'loading'}
                title="Refresh peer note list"
                style={{
                  ...secondaryBtnStyle,
                  padding: '5px 10px',
                  fontSize: 12,
                }}
              >
                Refresh
              </button>
            </div>

            {/* Active sync progress / result banner */}
            {syncStatus.stage !== 'idle' && (
              <div
                role="status"
                style={{
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background:
                    syncStatus.stage === 'done'
                      ? 'rgba(34, 197, 94, 0.12)'
                      : syncStatus.stage === 'error'
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'var(--bg-app)',
                  color:
                    syncStatus.stage === 'done'
                      ? '#15803d'
                      : syncStatus.stage === 'error'
                      ? 'var(--danger)'
                      : 'var(--ink-soft)',
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                {syncStatus.stage === 'connecting' && 'Connecting to peer…'}
                {syncStatus.stage === 'exchanging' && 'Exchanging manifests…'}
                {syncStatus.stage === 'transferring' &&
                  (syncStatus.total > 0
                    ? `Transferring notes (${syncStatus.progress}/${syncStatus.total})…`
                    : 'Transferring notes…')}
                {syncStatus.stage === 'done' &&
                  `Sync complete: ${syncStatus.result.received} received · ${syncStatus.result.sent} sent · ${syncStatus.result.unchanged} unchanged`}
                {syncStatus.stage === 'error' && syncStatus.message}
              </div>
            )}

            {/* Peer manifest states */}
            {manualPreview.stage === 'loading' && (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                }}
              >
                Requesting fresh note list from peer…
              </div>
            )}

            {(manualPreview.stage === 'disconnected' || manualPreview.stage === 'error') && (
              <div
                style={{
                  padding: '16px',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  borderLeft: '3px solid var(--danger)',
                  fontSize: 13,
                  color: 'var(--ink-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span>{manualPreview.message}</span>
                <button
                  type="button"
                  onClick={() => onRefreshManifest(activePairingId)}
                  style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }}
                >
                  Retry
                </button>
              </div>
            )}

            {isPreviewReady && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {readyNotes.length === 0
                      ? 'Peer has no notes'
                      : `${readyNotes.length} note${readyNotes.length === 1 ? '' : 's'} on peer`}
                  </span>
                  {readyNotes.length > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      {newCount} new · {updatedCount} updated
                    </span>
                  )}
                </div>

                {/* Compact preview summary (when selective dropdown is collapsed) */}
                {readyNotes.length > 0 && !showSelectiveList && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                    {readyNotes.map((item) => {
                      const badge = RELATION_META[item.relation];
                      return (
                        <div
                          key={item.noteId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '6px 8px',
                            background: 'var(--bg-paper)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)',
                            fontSize: 12.5,
                          }}
                        >
                          <span
                            style={{
                              color: 'var(--ink)',
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.title}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 7px',
                              borderRadius: 999,
                              background: badge.bg,
                              color: badge.color,
                              flexShrink: 0,
                            }}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Expandable selective sync dropdown/list */}
                {showSelectiveList && readyNotes.length > 0 && (
                  <div
                    data-testid="selective-notes-panel"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      borderTop: '1px solid var(--border)',
                      paddingTop: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 500 }}>
                        Selected: {selectedArray.length} of {readyNotes.length}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={selectNewAndUpdated}
                          style={tinyBtnStyle}
                        >
                          New &amp; updated
                        </button>
                        <button type="button" onClick={selectAllNotes} style={tinyBtnStyle}>
                          Select all
                        </button>
                        <button type="button" onClick={clearSelection} style={tinyBtnStyle}>
                          Clear
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        maxHeight: 220,
                        overflowY: 'auto',
                      }}
                    >
                      {readyNotes.map((item) => {
                        const checked = selectedIds.has(item.noteId);
                        const badge = RELATION_META[item.relation];
                        return (
                          <label
                            key={item.noteId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '7px 9px',
                              background: 'var(--bg-paper)',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleNoteSelection(item.noteId)}
                              disabled={isSyncBusy}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 500,
                                  color: 'var(--ink)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.title}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                                {formatDateTime(item.updatedAt)}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: 999,
                                background: badge.bg,
                                color: badge.color,
                                flexShrink: 0,
                              }}
                            >
                              {badge.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSyncSelected(activePairingId, selectedArray)}
                      disabled={selectedArray.length === 0 || !isPeerOnline || isSyncBusy}
                      style={{
                        ...primaryBtnStyle,
                        opacity:
                          selectedArray.length === 0 || !isPeerOnline || isSyncBusy ? 0.55 : 1,
                        cursor:
                          selectedArray.length === 0 || !isPeerOnline || isSyncBusy
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      Transfer selected ({selectedArray.length})
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Primary action bar: Sync all | Sync selected notes | Deny sync */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'flex-end',
                borderTop: '1px solid var(--border)',
                paddingTop: 12,
              }}
            >
              <button
                type="button"
                onClick={onDeny}
                disabled={isSyncBusy}
                style={{
                  ...secondaryBtnStyle,
                  color: 'var(--danger)',
                }}
              >
                Deny sync
              </button>

              <button
                type="button"
                aria-expanded={showSelectiveList}
                onClick={handleToggleSelective}
                disabled={!isPreviewReady || readyNotes.length === 0 || !isPeerOnline || isSyncBusy}
                style={{
                  ...secondaryBtnStyle,
                  opacity:
                    !isPreviewReady || readyNotes.length === 0 || !isPeerOnline || isSyncBusy
                      ? 0.55
                      : 1,
                  cursor:
                    !isPreviewReady || readyNotes.length === 0 || !isPeerOnline || isSyncBusy
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {showSelectiveList ? 'Hide note selection' : 'Sync selected notes'}
              </button>

              <button
                type="button"
                onClick={() => onSyncAll(activePairingId)}
                disabled={!isPeerOnline || isSyncBusy}
                style={{
                  ...primaryBtnStyle,
                  opacity: !isPeerOnline || isSyncBusy ? 0.55 : 1,
                  cursor: !isPeerOnline || isSyncBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Sync all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(32, 36, 42, 0.45)',
  backdropFilter: 'blur(3px)',
  zIndex: 210,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-paper)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow)',
  padding: '20px 22px',
  width: '100%',
  maxWidth: 520,
  maxHeight: '88vh',
  overflowY: 'auto',
  border: '1px solid var(--border)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 6,
  color: 'var(--ink-soft)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'var(--bg-sidebar)',
  color: 'var(--ink-soft)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

const tinyBtnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 500,
  background: 'var(--bg-paper)',
  color: 'var(--ink-soft)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
};
