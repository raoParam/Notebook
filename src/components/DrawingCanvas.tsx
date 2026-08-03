'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface DrawingCanvasProps {
  onInsert: (dataUrl: string) => void;
  onClose: () => void;
}

export function DrawingCanvas({ onInsert, onClose }: DrawingCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const hasMarksRef = useRef(false);

  const [mode, setMode] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(4);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;

    // Save existing drawing
    const prev = canvas.width && canvas.height ? canvas.toDataURL('image/png') : null;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctxRef.current = ctx;

    if (prev && hasMarksRef.current) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(resize, 0);
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [resize]);

  const getPos = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!ctxRef.current) resize();
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pos = getPos(e);
    drawingRef.current = true;
    pointerIdRef.current = e.pointerId;
    hasMarksRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }, [resize, getPos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || e.pointerId !== pointerIdRef.current || !ctxRef.current) return;
    const pos = getPos(e);
    const ctx = ctxRef.current;
    ctx.strokeStyle = mode === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth = mode === 'eraser' ? Math.max(8, size * 2) : size;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  }, [mode, color, size, getPos]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || e.pointerId !== pointerIdRef.current) return;
    drawingRef.current = false;
    pointerIdRef.current = null;
    ctxRef.current?.closePath();
    e.preventDefault();
  }, []);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    hasMarksRef.current = false;
  }, []);

  const handleInsert = useCallback(() => {
    if (!hasMarksRef.current) { alert('Draw something first.'); return; }
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    onInsert(dataUrl);
  }, [onInsert]);

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--accent)' : 'var(--bg-paper)',
    color: active ? '#fff' : 'var(--ink-soft)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'var(--font)',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    transition: 'all 0.12s',
  });

  return (
    <div
      style={{
        padding: '10px 20px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-sidebar)',
        flexShrink: 0,
      }}
    >
      {/* Drawing controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {/* Color */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-soft)' }}>
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 28, height: 26, border: '1px solid var(--border)', borderRadius: 4, padding: 2, background: 'var(--bg-paper)', cursor: 'pointer' }}
          />
        </label>
        {/* Size */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-soft)' }}>
          Size
          <input
            type="range"
            min={1}
            max={24}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>
        {/* Pen / Eraser */}
        <button style={btnStyle(mode === 'pen')} onClick={() => setMode('pen')}>Pen</button>
        <button style={btnStyle(mode === 'eraser')} onClick={() => setMode('eraser')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 21H8"/><path d="M5.5 16.5 3 14l9-9a2.121 2.121 0 0 1 3 0l4 4a2.121 2.121 0 0 1 0 3l-7.5 7.5"/>
          </svg>
          Eraser
        </button>
        <button style={btnStyle(false)} onClick={handleClear}>Clear</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleInsert}
          style={{ ...btnStyle(false), background: 'var(--gold)', borderColor: 'var(--gold)', color: '#fff' }}
        >
          Insert Drawing
        </button>
        <button style={btnStyle(false)} onClick={onClose}>✕ Close</button>
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          height: 220,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: '#fff',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', cursor: mode === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
