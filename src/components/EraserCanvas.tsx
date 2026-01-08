/**
 * 消しゴムキャンバス
 * 背景以外（ドール・服・お絵描き）を消せる修正ペン機能
 */
import { useRef, useEffect, useCallback, useState } from 'react';

interface EraserCanvasProps {
  width: number;
  height: number;
  isActive: boolean;
  onClose: () => void;
  // 消しゴムで消したマスクを取得
  onMaskUpdate?: (maskDataUrl: string | null) => void;
}

export function EraserCanvas({
  width,
  height,
  isActive,
  onClose,
  onMaskUpdate,
}: EraserCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isErasingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // 消しゴムサイズ
  const [eraserSize, setEraserSize] = useState(24);

  // キャンバス初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctxRef.current = ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  // マスク更新を通知
  const notifyMaskUpdate = useCallback(() => {
    if (!canvasRef.current || !onMaskUpdate) return;
    
    const ctx = ctxRef.current;
    if (!ctx) return;
    
    // キャンバスに何か描かれているか確認
    const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    const hasContent = imageData.data.some((val, idx) => idx % 4 === 3 && val > 0);
    
    if (hasContent) {
      onMaskUpdate(canvasRef.current.toDataURL('image/png'));
    } else {
      onMaskUpdate(null);
    }
  }, [onMaskUpdate]);

  // 座標取得
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
  }, []);

  // 消しゴム開始
  const startErasing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = getPosition(e);
    if (!pos || !ctxRef.current) return;

    isErasingRef.current = true;
    lastPosRef.current = pos;

    // 白い円を描く（マスク用）
    ctxRef.current.beginPath();
    ctxRef.current.arc(pos.x, pos.y, eraserSize / 2, 0, Math.PI * 2);
    ctxRef.current.fillStyle = 'white';
    ctxRef.current.fill();
  }, [getPosition, eraserSize]);

  // 消しゴム中
  const erase = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isErasingRef.current || !ctxRef.current || !lastPosRef.current) return;

    const pos = getPosition(e);
    if (!pos) return;

    // 白い線を描く
    ctxRef.current.beginPath();
    ctxRef.current.strokeStyle = 'white';
    ctxRef.current.lineWidth = eraserSize;
    ctxRef.current.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctxRef.current.lineTo(pos.x, pos.y);
    ctxRef.current.stroke();

    lastPosRef.current = pos;
  }, [getPosition, eraserSize]);

  // 消しゴム終了
  const stopErasing = useCallback(() => {
    if (isErasingRef.current) {
      isErasingRef.current = false;
      lastPosRef.current = null;
      notifyMaskUpdate();
    }
  }, [notifyMaskUpdate]);

  // 全消去（マスクをリセット）
  const clearMask = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onMaskUpdate?.(null);
  }, [onMaskUpdate]);

  // サイズオプション
  const sizes = [12, 24, 36, 48];

  if (!isActive) return null;

  return (
    <div className="eraser-overlay">
      {/* 消しゴムキャンバス（半透明で表示） */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="eraser-canvas"
        onTouchStart={startErasing}
        onTouchMove={erase}
        onTouchEnd={stopErasing}
        onTouchCancel={stopErasing}
        onMouseDown={startErasing}
        onMouseMove={erase}
        onMouseUp={stopErasing}
        onMouseLeave={stopErasing}
      />

      {/* ツールバー */}
      <div className="eraser-toolbar">
        {/* サイズ選択 */}
        <div className="eraser-sizes">
          {sizes.map((size) => (
            <button
              key={size}
              className={`eraser-size-btn ${eraserSize === size ? 'active' : ''}`}
              onClick={() => setEraserSize(size)}
            >
              <span 
                style={{ 
                  width: Math.min(size, 32), 
                  height: Math.min(size, 32), 
                  backgroundColor: '#ff69b4', 
                  borderRadius: '50%', 
                  display: 'inline-block',
                  opacity: 0.5,
                }} 
              />
            </button>
          ))}
        </div>

        {/* アクションボタン */}
        <div className="eraser-actions">
          <button className="eraser-clear-btn" onClick={clearMask} title="けす範囲をリセット">
            ↺
          </button>
          <button className="eraser-done-btn" onClick={onClose} title="完了">
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}
