'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DrawingHeader } from './drawing/DrawingHeader';
import {
  elementIntersectsBox,
  generateId,
  getElementBounds,
  hitTestElement,
  hitTestHandles,
  screenToWorld as toWorldPoint,
  worldToScreen as toScreenPoint,
} from './drawing/geometry';
import { exportDrawingToDataUrl, renderCanvasScene } from './drawing/renderer';
import { StyleInspector } from './drawing/StyleInspector';
import { ToolPalette } from './drawing/ToolPalette';
import type {
  Box,
  DrawingCanvasProps,
  DrawingElement,
  FillStyle,
  InteractionAction,
  Point,
  ResizeHandle,
  StrokeStyle,
  TextEditorState,
  ToolType,
} from './drawing/types';

export type {
  DrawingCanvasProps,
  DrawingElement,
  FillStyle,
  Point,
  StrokeStyle,
  ToolType,
} from './drawing/types';

export function DrawingCanvas({ onInsert, onClose }: DrawingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Tools & properties state
  const [tool, setTool] = useState<ToolType>('freedraw');
  const [strokeColor, setStrokeColor] = useState<string>('#1e1e1e');
  const [fillColor, setFillColor] = useState<string>('transparent');
  const [fillStyle, setFillStyle] = useState<FillStyle>('none');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid');
  const [opacity, setOpacity] = useState<number>(1);
  const [fontSize, setFontSize] = useState<number>(22);
  const [showPropertyPanel, setShowPropertyPanel] = useState<boolean>(true);

  // Canvas viewport: pan & zoom
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const isSpacePressedRef = useRef<boolean>(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });

  // Elements & History
  const [elements, setElements] = useState<DrawingElement[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<DrawingElement[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // Interaction State
  const [interactionAction, setInteractionAction] = useState<InteractionAction>('idle');
  const currentActionRef = useRef<InteractionAction>('idle');
  const activeHandleRef = useRef<ResizeHandle | null>(null);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 });
  const marqueeRef = useRef<Box | null>(null);

  // Stores original snapshot of moving elements
  const origElementsBoundsRef = useRef<
    Array<{ id: string; x: number; y: number; width: number; height: number; points?: Point[] }>
  >([]);

  // Current element being created
  const currentElementRef = useRef<DrawingElement | null>(null);

  // Text editor popup state
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedElements = elements.filter((e) => selectedIds.includes(e.id));
  const primarySelected = selectedElements[0] || null;

  const updateSelection = useCallback(
    (nextIds: string[], sourceElements: DrawingElement[] = elements) => {
      setSelectedIds(nextIds);
      const primary = sourceElements.find((e) => e.id === nextIds[0]);
      if (primary) {
        setStrokeColor(primary.strokeColor);
        setFillColor(primary.fillColor);
        setFillStyle(primary.fillStyle);
        setStrokeWidth(primary.strokeWidth);
        setStrokeStyle(primary.strokeStyle);
        setOpacity(primary.opacity);
        if (primary.fontSize) setFontSize(primary.fontSize);
      }
    },
    [elements]
  );

  const setActiveAction = useCallback((action: InteractionAction) => {
    currentActionRef.current = action;
    setInteractionAction(action);
  }, []);

  // Push new state to history
  const pushHistory = useCallback(
    (newElements: DrawingElement[]) => {
      setHistory((prev) => {
        const nextHistory = prev.slice(0, historyIndex + 1);
        nextHistory.push(newElements);
        if (nextHistory.length > 50) nextHistory.shift();
        return nextHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
      setElements(newElements);
    },
    [historyIndex]
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setElements(history[nextIndex]);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setElements(history[nextIndex]);
      setSelectedIds([]);
    }
  }, [history, historyIndex]);

  const clearCanvas = useCallback(() => {
    if (elements.length === 0) return;
    if (window.confirm('Clear the entire drawing canvas?')) {
      pushHistory([]);
      setSelectedIds([]);
    }
  }, [elements.length, pushHistory]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const nextElements = elements.filter((e) => !selectedIds.includes(e.id));
    pushHistory(nextElements);
    setSelectedIds([]);
  }, [selectedIds, elements, pushHistory]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const duplicates: DrawingElement[] = [];
    const newSelectedIds: string[] = [];

    elements.forEach((el) => {
      if (selectedIds.includes(el.id)) {
        const newId = generateId();
        newSelectedIds.push(newId);
        duplicates.push({
          ...el,
          id: newId,
          x: el.x + 20,
          y: el.y + 20,
          points: el.points ? el.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })) : undefined,
        });
      }
    });

    const next = [...elements, ...duplicates];
    pushHistory(next);
    updateSelection(newSelectedIds, next);
  }, [selectedIds, elements, pushHistory, updateSelection]);

  const updateSelectedProperty = useCallback(
    (patch: Partial<DrawingElement>) => {
      if (patch.strokeColor !== undefined) setStrokeColor(patch.strokeColor);
      if (patch.fillColor !== undefined) setFillColor(patch.fillColor);
      if (patch.fillStyle !== undefined) setFillStyle(patch.fillStyle);
      if (patch.strokeWidth !== undefined) setStrokeWidth(patch.strokeWidth);
      if (patch.strokeStyle !== undefined) setStrokeStyle(patch.strokeStyle);
      if (patch.fontSize !== undefined) setFontSize(patch.fontSize);
      if (patch.opacity !== undefined) setOpacity(patch.opacity);

      if (selectedIds.length === 0) return;
      const next = elements.map((e) => (selectedIds.includes(e.id) ? { ...e, ...patch } : e));
      pushHistory(next);
    },
    [selectedIds, elements, pushHistory]
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point =>
      toWorldPoint(clientX, clientY, canvasRef.current, pan, zoom),
    [pan, zoom]
  );

  const worldToScreen = useCallback(
    (worldX: number, worldY: number): Point => toScreenPoint(worldX, worldY, pan, zoom),
    [pan, zoom]
  );

  // Main Render Loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderCanvasScene({
      canvas,
      elements,
      currentElement: currentElementRef.current,
      selectedElements,
      selectedIds,
      marquee: marqueeRef.current,
      pan,
      zoom,
      editingTextId: textEditor?.id,
    });
  }, [elements, pan, zoom, selectedElements, selectedIds, textEditor]);

  // Resize canvas on mount/resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    render();
  }, [render]);

  useEffect(() => {
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [handleResize]);

  useEffect(() => {
    render();
  }, [render]);

  // Commit inline text element
  const commitText = useCallback(() => {
    if (!textEditor) return;
    const trimmed = textEditor.text.trim();
    if (trimmed) {
      const fSize = textEditor.fontSize;
      const lines = trimmed.split('\n');
      const maxLineLen = Math.max(...lines.map((l) => l.length));
      const width = Math.max(40, maxLineLen * (fSize * 0.6));
      const height = lines.length * (fSize * 1.3);

      if (textEditor.id) {
        const next = elements.map((el) =>
          el.id === textEditor.id
            ? {
                ...el,
                text: trimmed,
                width,
                height,
                strokeColor: textEditor.color,
                fontSize: fSize,
              }
            : el
        );
        pushHistory(next);
      } else {
        const newEl: DrawingElement = {
          id: generateId(),
          type: 'text',
          x: textEditor.worldX,
          y: textEditor.worldY,
          width,
          height,
          strokeColor: textEditor.color,
          fillColor: 'transparent',
          fillStyle: 'none',
          strokeWidth: 2,
          strokeStyle: 'solid',
          opacity: 1,
          text: trimmed,
          fontSize: fSize,
        };
        const next = [...elements, newEl];
        pushHistory(next);
        updateSelection([newEl.id], next);
      }
    } else if (textEditor.id) {
      const next = elements.filter((el) => el.id !== textEditor.id);
      pushHistory(next);
    }
    setTextEditor(null);
  }, [textEditor, elements, pushHistory, updateSelection]);

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (textEditor) {
        if (e.key === 'Escape') commitText();
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (selectedIds.length > 0) setSelectedIds([]);
        else setTool('select');
        return;
      }

      if (!ctrl && !e.altKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
          case '1':
            setTool('select');
            break;
          case 'p':
          case '2':
            setTool('freedraw');
            break;
          case 'e':
          case '3':
            setTool('eraser');
            break;
          case 'r':
          case '4':
            setTool('rectangle');
            break;
          case 'o':
          case '5':
            setTool('ellipse');
            break;
          case 'd':
          case '6':
            setTool('diamond');
            break;
          case 'l':
          case '7':
            setTool('line');
            break;
          case 'a':
          case '8':
            setTool('arrow');
            break;
          case 't':
          case '9':
            setTool('text');
            break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedIds, textEditor, undo, redo, deleteSelected, duplicateSelected, commitText]);

  // Pointer Down Handler
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (textEditor) commitText();

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const world = screenToWorld(e.clientX, e.clientY);
      dragStartRef.current = world;

      // Spacebar or Middle Click -> Pan
      if (isSpacePressedRef.current || e.button === 1) {
        panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        setActiveAction('panning');
        return;
      }

      // Eraser Mode
      if (tool === 'eraser') {
        setActiveAction('drawing');
        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));
        if (hit) {
          const next = elements.filter((el) => el.id !== hit.id);
          pushHistory(next);
          setSelectedIds((prev) => prev.filter((id) => id !== hit.id));
        }
        return;
      }

      // Select Mode
      if (tool === 'select') {
        if (selectedElements.length === 1) {
          const singleEl = selectedElements[0];
          const handle = hitTestHandles(world, singleEl, zoom);
          if (handle) {
            activeHandleRef.current = handle;
            origElementsBoundsRef.current = [
              {
                id: singleEl.id,
                x: singleEl.x,
                y: singleEl.y,
                width: singleEl.width,
                height: singleEl.height,
                points: singleEl.points ? [...singleEl.points] : undefined,
              },
            ];
            setActiveAction('resizing');
            return;
          }
        }

        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));
        if (hit) {
          let nextSelectedIds = [...selectedIds];
          if (e.shiftKey) {
            if (nextSelectedIds.includes(hit.id)) {
              nextSelectedIds = nextSelectedIds.filter((id) => id !== hit.id);
            } else {
              nextSelectedIds.push(hit.id);
            }
          } else if (!selectedIds.includes(hit.id)) {
            nextSelectedIds = [hit.id];
          }

          updateSelection(nextSelectedIds);
          setActiveAction('moving');

          const targets = elements.filter((el) => nextSelectedIds.includes(el.id));
          origElementsBoundsRef.current = targets.map((el) => ({
            id: el.id,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            points: el.points ? el.points.map((p) => ({ ...p })) : undefined,
          }));
        } else {
          if (!e.shiftKey) setSelectedIds([]);
          marqueeRef.current = { x: world.x, y: world.y, width: 0, height: 0 };
          setActiveAction('marquee');
          render();
        }
        return;
      }

      // Text Tool
      if (tool === 'text') {
        const screenPt = worldToScreen(world.x, world.y);
        setTextEditor({
          x: screenPt.x,
          y: screenPt.y,
          worldX: world.x,
          worldY: world.y,
          text: '',
          fontSize,
          color: strokeColor,
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
        return;
      }

      // Shape or Freehand Drawing Creation
      setActiveAction('drawing');
      const baseElement: DrawingElement = {
        id: generateId(),
        type: tool,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        strokeColor,
        fillColor,
        fillStyle,
        strokeWidth,
        strokeStyle,
        opacity,
        fontSize,
      };

      if (tool === 'freedraw') {
        baseElement.points = [world];
      } else if (tool === 'line' || tool === 'arrow') {
        baseElement.points = [world, world];
      }

      currentElementRef.current = baseElement;
      render();
    },
    [
      tool,
      selectedElements,
      selectedIds,
      elements,
      strokeColor,
      fillColor,
      fillStyle,
      strokeWidth,
      strokeStyle,
      opacity,
      fontSize,
      pan,
      zoom,
      textEditor,
      screenToWorld,
      worldToScreen,
      pushHistory,
      commitText,
      render,
      setActiveAction,
      updateSelection,
    ]
  );

  // Pointer Move Handler
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = screenToWorld(e.clientX, e.clientY);

      // Panning
      if (currentActionRef.current === 'panning') {
        setPan({
          x: e.clientX - panStartRef.current.x,
          y: e.clientY - panStartRef.current.y,
        });
        return;
      }

      // Marquee Area Selection Drag
      if (currentActionRef.current === 'marquee') {
        const mx = Math.min(dragStartRef.current.x, world.x);
        const my = Math.min(dragStartRef.current.y, world.y);
        const mw = Math.abs(world.x - dragStartRef.current.x);
        const mh = Math.abs(world.y - dragStartRef.current.y);

        marqueeRef.current = { x: mx, y: my, width: mw, height: mh };

        const enclosed = elements.filter((el) =>
          elementIntersectsBox(el, { x: mx, y: my, width: mw, height: mh })
        );
        updateSelection(enclosed.map((el) => el.id));
        render();
        return;
      }

      // Eraser Drag
      if (tool === 'eraser' && currentActionRef.current === 'drawing') {
        const hit = [...elements].reverse().find((el) => hitTestElement(world, el));
        if (hit) {
          const next = elements.filter((el) => el.id !== hit.id);
          pushHistory(next);
          setSelectedIds((prev) => prev.filter((id) => id !== hit.id));
        }
        return;
      }

      // Moving Selected Elements as a Group
      if (currentActionRef.current === 'moving' && selectedIds.length > 0) {
        const dx = world.x - dragStartRef.current.x;
        const dy = world.y - dragStartRef.current.y;
        const origMap = new Map(origElementsBoundsRef.current.map((item) => [item.id, item]));

        setElements((prev) =>
          prev.map((el) => {
            const orig = origMap.get(el.id);
            if (!orig) return el;

            if (el.type === 'freedraw') {
              const pts = orig.points
                ? orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
                : undefined;
              return { ...el, x: orig.x + dx, y: orig.y + dy, points: pts };
            }
            if (el.type === 'line' || el.type === 'arrow') {
              const pts = orig.points
                ? orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
                : undefined;
              return { ...el, points: pts };
            }
            return { ...el, x: orig.x + dx, y: orig.y + dy };
          })
        );
        return;
      }

      // Resizing Element (for single element)
      if (
        currentActionRef.current === 'resizing' &&
        selectedElements.length === 1 &&
        activeHandleRef.current
      ) {
        const handle = activeHandleRef.current;
        const orig = origElementsBoundsRef.current[0];
        if (!orig) return;

        const dx = world.x - dragStartRef.current.x;
        const dy = world.y - dragStartRef.current.y;

        setElements((prev) =>
          prev.map((el) => {
            if (el.id !== orig.id) return el;

            if (el.type === 'line' || el.type === 'arrow') {
              if (!orig.points) return el;
              const newPts = [...orig.points];
              if (handle === 'start') newPts[0] = world;
              if (handle === 'end') newPts[1] = world;
              return { ...el, points: newPts };
            }

            let newX = orig.x;
            let newY = orig.y;
            let newW = orig.width;
            let newH = orig.height;

            if (handle.includes('e')) newW = orig.width + dx;
            if (handle.includes('s')) newH = orig.height + dy;
            if (handle.includes('w')) {
              newX = orig.x + dx;
              newW = orig.width - dx;
            }
            if (handle.includes('n')) {
              newY = orig.y + dy;
              newH = orig.height - dy;
            }

            return {
              ...el,
              x: newX,
              y: newY,
              width: newW,
              height: newH,
            };
          })
        );
        return;
      }

      // Creating new element on drag
      if (currentActionRef.current === 'drawing' && currentElementRef.current) {
        const cur = currentElementRef.current;
        if (cur.type === 'freedraw') {
          cur.points = [...(cur.points || []), world];
        } else if (cur.type === 'line' || cur.type === 'arrow') {
          if (cur.points) cur.points[1] = world;
        } else {
          cur.x = Math.min(dragStartRef.current.x, world.x);
          cur.y = Math.min(dragStartRef.current.y, world.y);
          cur.width = Math.abs(world.x - dragStartRef.current.x);
          cur.height = Math.abs(world.y - dragStartRef.current.y);
        }
        render();
      }
    },
    [tool, selectedIds, selectedElements, elements, screenToWorld, pushHistory, render, updateSelection]
  );

  // Pointer Up Handler
  const handlePointerUp = useCallback(() => {
    if (currentActionRef.current === 'marquee') {
      marqueeRef.current = null;
      render();
    } else if (currentActionRef.current === 'drawing' && currentElementRef.current) {
      const created = currentElementRef.current;
      currentElementRef.current = null;

      const isValid =
        created.type === 'freedraw'
          ? (created.points?.length || 0) > 1
          : created.type === 'line' || created.type === 'arrow'
          ? Math.hypot(
              (created.points?.[1]?.x || 0) - (created.points?.[0]?.x || 0),
              (created.points?.[1]?.y || 0) - (created.points?.[0]?.y || 0)
            ) > 5
          : created.width > 5 || created.height > 5;

      if (isValid) {
        const next = [...elements, created];
        pushHistory(next);
      } else {
        render();
      }
    } else if (
      currentActionRef.current === 'moving' ||
      currentActionRef.current === 'resizing'
    ) {
      pushHistory(elements);
    }

    activeHandleRef.current = null;
    setActiveAction('idle');
  }, [elements, pushHistory, render, setActiveAction]);

  // Double Click Handler (for editing existing text element)
  const handleDoubleClick = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const world = screenToWorld(e.clientX, e.clientY);
      const hit = [...elements]
        .reverse()
        .find((el) => el.type === 'text' && hitTestElement(world, el));
      if (hit && hit.text) {
        const screenPt = worldToScreen(hit.x, hit.y);
        setTextEditor({
          x: screenPt.x,
          y: screenPt.y,
          worldX: hit.x,
          worldY: hit.y,
          text: hit.text,
          id: hit.id,
          fontSize: hit.fontSize || 22,
          color: hit.strokeColor,
        });
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    },
    [elements, screenToWorld, worldToScreen]
  );

  // Zoom Handling
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.min(3, Math.max(0.2, zoom * zoomFactor));

        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        setPan({
          x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
          y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
        });
        setZoom(newZoom);
      } else {
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    },
    [zoom, pan]
  );

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const fitToScreen = useCallback(() => {
    if (elements.length === 0) {
      resetZoom();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach((el) => {
      const b = getElementBounds(el);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    });

    const pad = 60;
    const boundingW = maxX - minX + pad * 2;
    const boundingH = maxY - minY + pad * 2;

    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;

    const fitZoom = Math.min(1.5, Math.max(0.3, Math.min(viewW / boundingW, viewH / boundingH)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(fitZoom);
    setPan({
      x: viewW / 2 - centerX * fitZoom,
      y: viewH / 2 - centerY * fitZoom,
    });
  }, [elements, resetZoom]);

  const handleInsertDrawing = useCallback(() => {
    const dataUrl = exportDrawingToDataUrl(elements);
    if (!dataUrl) {
      alert('Please draw something on the canvas before inserting.');
      return;
    }
    onInsert(dataUrl);
  }, [elements, onInsert]);

  const cursor =
    isSpacePressed || interactionAction === 'panning'
      ? 'grab'
      : tool === 'select'
      ? interactionAction === 'moving'
        ? 'move'
        : interactionAction === 'resizing' || interactionAction === 'marquee'
        ? 'crosshair'
        : 'default'
      : tool === 'eraser'
      ? 'cell'
      : tool === 'text'
      ? 'text'
      : 'crosshair';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '12px',
        animation: 'modalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(95vw, 1160px)',
          height: 'min(90vh, 790px)',
          minHeight: '520px',
          background: 'var(--bg-paper)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <DrawingHeader
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          hasElements={elements.length > 0}
          zoom={zoom}
          showPropertyPanel={showPropertyPanel}
          onUndo={undo}
          onRedo={redo}
          onClear={clearCanvas}
          onZoomIn={() => setZoom((z) => Math.min(3, z + 0.1))}
          onZoomOut={() => setZoom((z) => Math.max(0.2, z - 0.1))}
          onResetZoom={resetZoom}
          onFitToScreen={fitToScreen}
          onTogglePropertyPanel={() => setShowPropertyPanel((p) => !p)}
          onInsert={handleInsertDrawing}
          onClose={onClose}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>
          <ToolPalette
            tool={tool}
            onSelectTool={(nextTool) => {
              setTool(nextTool);
              if (nextTool !== 'select') setSelectedIds([]);
            }}
          />

          {showPropertyPanel && (
            <StyleInspector
              tool={tool}
              selectedIds={selectedIds}
              primarySelected={primarySelected}
              strokeColor={strokeColor}
              fillColor={fillColor}
              fillStyle={fillStyle}
              strokeWidth={strokeWidth}
              strokeStyle={strokeStyle}
              fontSize={fontSize}
              opacity={opacity}
              onUpdateProperty={updateSelectedProperty}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
            />
          )}

          <div
            ref={containerRef}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              position: 'relative',
              touchAction: 'none',
              background: '#ffffff',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                cursor,
                touchAction: 'none',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              onWheel={handleWheel}
            />

            {textEditor && (
              <textarea
                ref={textareaRef}
                value={textEditor.text}
                onChange={(e) => setTextEditor({ ...textEditor, text: e.target.value })}
                onBlur={commitText}
                placeholder="Type here..."
                style={{
                  position: 'absolute',
                  left: textEditor.x,
                  top: textEditor.y,
                  fontFamily: '"Inter", sans-serif',
                  fontSize: `${textEditor.fontSize * zoom}px`,
                  lineHeight: 1.3,
                  color: textEditor.color,
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1.5px solid #3b82f6',
                  borderRadius: 4,
                  padding: 4,
                  outline: 'none',
                  resize: 'both',
                  minWidth: 120,
                  minHeight: textEditor.fontSize * 1.5,
                  zIndex: 40,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                }}
              />
            )}

            <div
              style={{
                position: 'absolute',
                bottom: 12,
                right: 14,
                fontSize: 11,
                color: 'var(--ink-muted)',
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(4px)',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            >
              Select (V): Drag region to select multiple • Hold{' '}
              <kbd
                style={{
                  background: '#eee',
                  padding: '1px 4px',
                  borderRadius: 3,
                  border: '1px solid #ccc',
                }}
              >
                Space
              </kbd>{' '}
              to pan •{' '}
              <kbd
                style={{
                  background: '#eee',
                  padding: '1px 4px',
                  borderRadius: 3,
                  border: '1px solid #ccc',
                }}
              >
                Ctrl
              </kbd>{' '}
              + Scroll to zoom
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
