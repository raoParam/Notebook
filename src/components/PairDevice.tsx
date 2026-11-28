'use client';

import React, { useEffect, useRef, useState } from 'react';
import { generateRoomCode } from '@/lib/hash';
import type { Pairing } from '@/lib/db';

interface PairDeviceProps {
  pairings: Pairing[];
  connectedPeerIds: string[];
  onAddPairing: (id: string, label: string) => Promise<unknown>;
  onRemovePairing: (id: string) => Promise<void>;
  onClose: () => void;
}

type PairView = 'menu' | 'generate' | 'enter';

export function PairDevice({
  pairings,
  connectedPeerIds,
  onAddPairing,
  onRemovePairing,
  onClose,
}: PairDeviceProps) {
  const [view, setView] = useState<PairView>('menu');
  const [generatedCode, setGeneratedCode] = useState('');
  const [label, setLabel] = useState('');
  const [enterCode, setEnterCode] = useState('');
  const [enterLabel, setEnterLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  function switchView(nextView: PairView) {
    setMsg('');
    setView(nextView);
  }

  function scheduleReturnToMenu() {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setMsg('');
      setView('menu');
    }, 2500);
  }

  function handleGenerate() {
    setGeneratedCode(generateRoomCode());
    setLabel('');
    switchView('generate');
  }

  async function handleSaveGenerated() {
    if (!label.trim()) { setMsg('Please enter a name for this device pair.'); return; }
    setLoading(true);
    try {
      await onAddPairing(generatedCode, label.trim());
      setMsg('Pairing saved! Share the code with the other device.');
      setLabel('');
      scheduleReturnToMenu();
    } catch {
      setMsg('Failed to save pairing.');
    } finally {
      setLoading(false);
    }
  }

  async function handleEnterCode() {
    const code = enterCode.trim().toLowerCase();
    if (code.length !== 12) { setMsg('Code must be exactly 12 characters.'); return; }
    if (!enterLabel.trim()) { setMsg('Please give this pairing a name.'); return; }
    if (pairings.some((p) => p.id === code)) { setMsg('This code is already saved.'); return; }
    setLoading(true);
    try {
      await onAddPairing(code, enterLabel.trim());
      setMsg('Connected! Pairing saved.');
      setEnterCode('');
      setEnterLabel('');
      scheduleReturnToMenu();
    } catch {
      setMsg('Failed to save pairing.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={panelStyle} className="animate-fade-in">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--serif-font)', fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>
            Device Pairing
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Sync notice */}
        <div style={{
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--gold)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--ink-soft)',
          marginBottom: 20,
          lineHeight: 1.5,
        }}>
          ⚠️ Sync only works when both devices are online at the same time. There is no offline queue.
        </div>

        {view === 'menu' && (
          <>
            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              <PairBtn onClick={handleGenerate} icon="📱">
                Generate Code<br />
                <small style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>This device starts pairing</small>
              </PairBtn>
              <PairBtn onClick={() => switchView('enter')} icon="🔑">
                Enter Code<br />
                <small style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>Join an existing pairing</small>
              </PairBtn>
            </div>

            {/* Existing pairings */}
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Paired Devices
            </h3>
            {pairings.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center', padding: '12px 0' }}>
                No paired devices yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pairings.map((p) => {
                  const isConnected = connectedPeerIds.length > 0;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: 'var(--bg-sidebar)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: isConnected ? '#22c55e' : 'var(--gold)',
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</span>
                          <span style={{ fontSize: 11, color: isConnected ? '#22c55e' : 'var(--ink-soft)' }}>
                            ({isConnected ? 'Online' : 'Waiting for connection'})
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--mono-font)', marginTop: 2, paddingLeft: 14 }}>
                          {p.id}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Unpair "${p.label}"? This only removes the local record.`)) {
                            onRemovePairing(p.id);
                          }
                        }}
                        title="Unpair"
                        style={{ ...closeBtnStyle, color: 'var(--danger)' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === 'generate' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              Share this code with the other device. It only needs to be entered once.
            </p>
            <div style={{
              textAlign: 'center',
              padding: '16px',
              background: 'var(--bg-sidebar)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontFamily: 'var(--mono-font)', fontSize: 24, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--accent)' }}>
                {generatedCode}
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(generatedCode); }}
                style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Copy to clipboard
              </button>
            </div>
            <label style={labelStyle}>
              Name this pairing (e.g. &ldquo;My Phone&rdquo;)
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveGenerated()}
                placeholder="My Phone"
                style={inputStyle}
                autoFocus
              />
            </label>
            {msg && <p style={{ fontSize: 12, color: msg.includes('saved') ? '#22c55e' : 'var(--danger)' }}>{msg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => switchView('menu')} style={cancelBtnStyle}>Back</button>
              <button onClick={handleSaveGenerated} disabled={loading} style={primaryBtnStyle}>
                {loading ? 'Saving…' : 'Save Pairing'}
              </button>
            </div>
          </div>
        )}

        {view === 'enter' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
              Enter the 12-character code shown on the other device.
            </p>
            <label style={labelStyle}>
              Pairing Code
              <input
                value={enterCode}
                onChange={(e) => setEnterCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                placeholder="abc123def456"
                maxLength={12}
                style={{ ...inputStyle, fontFamily: 'var(--mono-font)', letterSpacing: '0.1em' }}
                autoFocus
              />
            </label>
            <label style={labelStyle}>
              Device Name
              <input
                value={enterLabel}
                onChange={(e) => setEnterLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEnterCode()}
                placeholder="My Laptop"
                style={inputStyle}
              />
            </label>
            {msg && <p style={{ fontSize: 12, color: msg.includes('saved') || msg.includes('Connected') ? '#22c55e' : 'var(--danger)' }}>{msg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => switchView('menu')} style={cancelBtnStyle}>Back</button>
              <button onClick={handleEnterCode} disabled={loading} style={primaryBtnStyle}>
                {loading ? 'Joining…' : 'Join Room'}
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
  background: 'rgba(32, 36, 42, 0.4)',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-paper)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow)',
  padding: '24px 24px 20px',
  width: '100%',
  maxWidth: 440,
  maxHeight: '90vh',
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
  flex: 1,
  padding: '9px 16px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  transition: 'background 0.15s',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '9px 14px',
  background: 'var(--bg-sidebar)',
  color: 'var(--ink-soft)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-sidebar)',
  color: 'var(--ink)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 13,
  fontFamily: 'var(--font)',
  outline: 'none',
  marginTop: 5,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--ink-soft)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

function PairBtn({
  children,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '14px 12px',
        background: 'var(--bg-sidebar)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--ink)',
        fontFamily: 'var(--font)',
        lineHeight: 1.5,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      {children}
    </button>
  );
}
