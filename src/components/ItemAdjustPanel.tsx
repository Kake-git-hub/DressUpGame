/**
 * アイテム調整パネル
 * 位置・大きさ・傾きをスライダーで調整
 */
import { useCallback, useState, useEffect, useRef } from 'react';
import type { EquippedItem } from '../types';
import type { ItemAdjustment } from '../hooks/useDressUp';

interface ItemAdjustPanelProps {
  item: EquippedItem;
  onAdjust: (adjustment: ItemAdjustment) => void;
  onClose: () => void;
  canvasWidth: number;
  canvasHeight: number;
}

export function ItemAdjustPanel({
  item,
  onAdjust,
  onClose,
  canvasWidth,
  canvasHeight,
}: ItemAdjustPanelProps) {
  // 現在の調整値（ローカルステート）
  const [offsetX, setOffsetX] = useState(item.adjustOffsetX ?? 0);
  const [offsetY, setOffsetY] = useState(item.adjustOffsetY ?? 0);
  const [scale, setScale] = useState(item.adjustScale ?? 1.0);
  const [rotation, setRotation] = useState(item.adjustRotation ?? 0);

  // ドラッグ状態
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // アイテムが変わったらリセット
  useEffect(() => {
    setOffsetX(item.adjustOffsetX ?? 0);
    setOffsetY(item.adjustOffsetY ?? 0);
    setScale(item.adjustScale ?? 1.0);
    setRotation(item.adjustRotation ?? 0);
  }, [item.id, item.adjustOffsetX, item.adjustOffsetY, item.adjustScale, item.adjustRotation]);

  // 値が変わったら親に通知
  useEffect(() => {
    onAdjust({
      adjustOffsetX: offsetX,
      adjustOffsetY: offsetY,
      adjustScale: scale,
      adjustRotation: rotation,
    });
  }, [offsetX, offsetY, scale, rotation, onAdjust]);

  // 位置の範囲（キャンバスサイズの50%まで）
  const maxOffset = Math.min(canvasWidth, canvasHeight) * 0.5;

  // スケールのリセット
  const handleResetScale = useCallback(() => {
    setScale(1.0);
  }, []);

  // 回転のリセット
  const handleResetRotation = useCallback(() => {
    setRotation(0);
  }, []);

  // 全リセット
  const handleResetAll = useCallback(() => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(1.0);
    setRotation(0);
  }, []);

  // ドラッグ開始
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX,
      offsetY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offsetX, offsetY]);

  // ドラッグ中
  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, dragStartRef.current.offsetX + deltaX));
    const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, dragStartRef.current.offsetY + deltaY));
    
    setOffsetX(newOffsetX);
    setOffsetY(newOffsetY);
  }, [isDragging, maxOffset]);

  // ドラッグ終了
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  return (
    <div className="item-adjust-panel">
      <div className="item-adjust-header">
        <span className="item-adjust-title">📍 {item.name}</span>
        <button className="item-adjust-close" onClick={onClose} title="閉じる">
          ✓
        </button>
      </div>

      {/* ドラッグエリア（位置調整用） */}
      <div
        className="item-adjust-drag-area"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <span>↔️ ドラッグで位置調整</span>
        <span className="drag-hint">
          X: {Math.round(offsetX)}px / Y: {Math.round(offsetY)}px
        </span>
      </div>

      {/* スケールスライダー */}
      <div className="item-adjust-slider-group">
        <label>
          <span>📐 大きさ: {(scale * 100).toFixed(0)}%</span>
          <button className="slider-reset" onClick={handleResetScale} title="リセット">
            ↺
          </button>
        </label>
        <input
          type="range"
          min="50"
          max="200"
          step="5"
          value={scale * 100}
          onChange={(e) => setScale(Number(e.target.value) / 100)}
        />
      </div>

      {/* 回転スライダー */}
      <div className="item-adjust-slider-group">
        <label>
          <span>🔄 傾き: {rotation.toFixed(0)}°</span>
          <button className="slider-reset" onClick={handleResetRotation} title="リセット">
            ↺
          </button>
        </label>
        <input
          type="range"
          min="-180"
          max="180"
          step="5"
          value={rotation}
          onChange={(e) => setRotation(Number(e.target.value))}
        />
      </div>

      {/* リセットボタン */}
      <button className="item-adjust-reset-all" onClick={handleResetAll}>
        🔄 すべてリセット
      </button>
    </div>
  );
}
