/**
 * アイテム調整パネル
 * タッチジェスチャーで位置・大きさ・傾きを調整
 * - 一本指タッチ: 位置移動
 * - ピンチ: 拡大縮小
 * - 二本指回転: 傾き
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

// タッチポイントの型
interface TouchPoint {
  clientX: number;
  clientY: number;
}

// 2点間の距離を計算
function getDistance(touch1: TouchPoint, touch2: TouchPoint): number {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// 2点間の角度を計算（度）
function getAngle(touch1: TouchPoint, touch2: TouchPoint): number {
  const dx = touch2.clientX - touch1.clientX;
  const dy = touch2.clientY - touch1.clientY;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
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

  // タッチ状態
  const touchStartRef = useRef<{
    // 一本指用
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    // 二本指用
    initialDistance: number;
    initialScale: number;
    initialAngle: number;
    initialRotation: number;
  } | null>(null);
  const [touchCount, setTouchCount] = useState(0);

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

  // 全リセット
  const handleResetAll = useCallback(() => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(1.0);
    setRotation(0);
  }, []);

  // タッチ開始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    setTouchCount(touches.length);

    if (touches.length === 1) {
      // 一本指: 位置移動開始
      touchStartRef.current = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        offsetX,
        offsetY,
        initialDistance: 0,
        initialScale: scale,
        initialAngle: 0,
        initialRotation: rotation,
      };
    } else if (touches.length === 2) {
      // 二本指: ピンチ・回転開始
      const distance = getDistance(touches[0], touches[1]);
      const angle = getAngle(touches[0], touches[1]);
      touchStartRef.current = {
        x: 0,
        y: 0,
        offsetX,
        offsetY,
        initialDistance: distance,
        initialScale: scale,
        initialAngle: angle,
        initialRotation: rotation,
      };
    }
  }, [offsetX, offsetY, scale, rotation]);

  // タッチ移動
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    if (!touchStartRef.current) return;

    if (touches.length === 1 && touchCount === 1) {
      // 一本指: 位置移動
      const deltaX = touches[0].clientX - touchStartRef.current.x;
      const deltaY = touches[0].clientY - touchStartRef.current.y;
      
      const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetX + deltaX));
      const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetY + deltaY));
      
      setOffsetX(newOffsetX);
      setOffsetY(newOffsetY);
    } else if (touches.length === 2) {
      // 二本指: ピンチ（スケール）と回転
      const currentDistance = getDistance(touches[0], touches[1]);
      const currentAngle = getAngle(touches[0], touches[1]);

      // スケール変更（ピンチ）
      if (touchStartRef.current.initialDistance > 0) {
        const scaleRatio = currentDistance / touchStartRef.current.initialDistance;
        const newScale = Math.max(0.5, Math.min(2.0, touchStartRef.current.initialScale * scaleRatio));
        setScale(newScale);
      }

      // 回転変更
      const angleDelta = currentAngle - touchStartRef.current.initialAngle;
      let newRotation = touchStartRef.current.initialRotation + angleDelta;
      // -180〜180の範囲に正規化
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;
      setRotation(newRotation);
    }
  }, [maxOffset, touchCount]);

  // タッチ終了
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    setTouchCount(touches.length);

    if (touches.length === 0) {
      touchStartRef.current = null;
    } else if (touches.length === 1) {
      // 二本指から一本指に戻った場合、一本指モードに切り替え
      touchStartRef.current = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        offsetX,
        offsetY,
        initialDistance: 0,
        initialScale: scale,
        initialAngle: 0,
        initialRotation: rotation,
      };
    }
  }, [offsetX, offsetY, scale, rotation]);

  // マウス操作（PC用）
  const [isMouseDragging, setIsMouseDragging] = useState(false);
  const mouseStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // ボタンクリックは無視
    if ((e.target as HTMLElement).closest('button')) return;
    
    setIsMouseDragging(true);
    mouseStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX,
      offsetY,
    };
  }, [offsetX, offsetY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDragging || !mouseStartRef.current) return;

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;

    const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetX + deltaX));
    const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetY + deltaY));

    setOffsetX(newOffsetX);
    setOffsetY(newOffsetY);
  }, [isMouseDragging, maxOffset]);

  const handleMouseUp = useCallback(() => {
    setIsMouseDragging(false);
    mouseStartRef.current = null;
  }, []);

  // ホイールでスケール・回転（Shift押しながらで回転）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift + ホイール: 回転
      const delta = e.deltaY > 0 ? 5 : -5;
      setRotation((prev) => {
        let newRotation = prev + delta;
        while (newRotation > 180) newRotation -= 360;
        while (newRotation < -180) newRotation += 360;
        return newRotation;
      });
    } else {
      // ホイール: スケール
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setScale((prev) => Math.max(0.5, Math.min(2.0, prev + delta)));
    }
  }, []);

  return (
    <div
      className="item-adjust-overlay"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isMouseDragging ? 'grabbing' : 'grab' }}
    >
      {/* 操作ガイド */}
      <div className="item-adjust-guide">
        <div className="guide-item">👆 一本指ドラッグ: 位置移動</div>
        <div className="guide-item">🤏 ピンチ: 大きさ変更</div>
        <div className="guide-item">🔄 二本指回転: 傾き変更</div>
        <div className="guide-values">
          位置: ({Math.round(offsetX)}, {Math.round(offsetY)}) / 
          大きさ: {(scale * 100).toFixed(0)}% / 
          傾き: {rotation.toFixed(0)}°
        </div>
      </div>

      {/* 下部ボタン */}
      <div className="item-adjust-buttons">
        <button className="item-adjust-reset-btn" onClick={handleResetAll}>
          ↺ リセット
        </button>
        <button className="item-adjust-done-btn" onClick={onClose}>
          ✓ 完了
        </button>
      </div>
    </div>
  );
}
