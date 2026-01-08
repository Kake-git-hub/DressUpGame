/**
 * お絵描きキャンバス
 * ドールエリアに自由に描画できる
 */
import { useRef, useEffect, useCallback, useState } from 'react';

interface DrawingCanvasProps {
  width: number;
  height: number;
  isActive: boolean;
  brushColor?: string;
  brushSize?: number;
  onClose: () => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function DrawingCanvas({
  width,
  height,
  isActive,
  brushColor = '#ff69b4',
  brushSize = 8,
  onClose,
  canvasRef: externalCanvasRef,
}: DrawingCanvasProps) {
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef || internalCanvasRef;
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // 現在の色とサイズ
  const [currentColor, setCurrentColor] = useState(brushColor);
  const [currentSize, setCurrentSize] = useState(brushSize);

  // キャンバス初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctxRef.current = ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [canvasRef]);

  // 座標取得（タッチ/マウス共通）
  const getPosition = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, [canvasRef]);

  // 描画開始
  const startDrawing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = getPosition(e);
    if (!pos || !ctxRef.current) return;

    isDrawingRef.current = true;
    lastPosRef.current = pos;

    // 点を打つ
    ctxRef.current.beginPath();
    ctxRef.current.arc(pos.x, pos.y, currentSize / 2, 0, Math.PI * 2);
    ctxRef.current.fillStyle = currentColor;
    ctxRef.current.fill();
  }, [getPosition, currentColor, currentSize]);

  // 描画中
  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawingRef.current || !ctxRef.current || !lastPosRef.current) return;

    const pos = getPosition(e);
    if (!pos) return;

    ctxRef.current.beginPath();
    ctxRef.current.strokeStyle = currentColor;
    ctxRef.current.lineWidth = currentSize;
    ctxRef.current.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctxRef.current.lineTo(pos.x, pos.y);
    ctxRef.current.stroke();

    lastPosRef.current = pos;
  }, [getPosition, currentColor, currentSize]);

  // 描画終了
  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  // 全消去
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  // カラーパレット
  const colors = ['#ff69b4', '#ff0000', '#ff8c00', '#ffd700', '#32cd32', '#00bfff', '#9370db', '#000000', '#ffffff'];
  const sizes = [4, 8, 16, 24];

  if (!isActive) return null;

  return (
    <div className="drawing-overlay">
      {/* 描画キャンバス */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="drawing-canvas"
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        onTouchCancel={stopDrawing}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />

      {/* ツールバー */}
      <div className="drawing-toolbar">
        {/* カラー選択 */}
        <div className="drawing-colors">
          {colors.map((color) => (
            <button
              key={color}
              className={`drawing-color-btn ${currentColor === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setCurrentColor(color)}
            />
          ))}
        </div>

        {/* サイズ選択 */}
        <div className="drawing-sizes">
          {sizes.map((size) => (
            <button
              key={size}
              className={`drawing-size-btn ${currentSize === size ? 'active' : ''}`}
              onClick={() => setCurrentSize(size)}
            >
              <span style={{ width: size, height: size, backgroundColor: currentColor, borderRadius: '50%', display: 'inline-block' }} />
            </button>
          ))}
        </div>

        {/* アクションボタン */}
        <div className="drawing-actions">
          <button className="drawing-clear-btn" onClick={clearCanvas}>
            🗑️
          </button>
          <button className="drawing-done-btn" onClick={onClose}>
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}
