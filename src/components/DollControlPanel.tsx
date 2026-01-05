/**
 * DollControlPanel コンポーネント
 * ドールの位置とサイズを調整するコントロールパネル
 * タッチ/マウスで直接ドラッグ移動、ピンチでサイズ変更
 * ドール位置を基準点としてドラッグ
 */
import { useEffect, useRef, useCallback, type CSSProperties } from 'react';
import type { DollTransform } from '../types';

interface DollControlPanelProps {
  transform: DollTransform;
  onChange: (transform: DollTransform) => void;
  isVisible: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

export function DollControlPanel({
  transform,
  onChange,
  isVisible,
}: DollControlPanelProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastTouchDistance = useRef<number | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startTransform = useRef({ x: transform.x, y: transform.y });

  // 2点間の距離を計算
  const getTouchDistance = (touches: TouchList) => {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 位置を制限（背景領域外にもはみ出せるように広めに）
  const clampPosition = (x: number, y: number) => ({
    x: Math.max(-20, Math.min(120, x)),
    y: Math.max(-20, Math.min(120, y)),
  });

  // マウス/タッチ開始
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isVisible) return;
    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startTransform.current = { x: transform.x, y: transform.y };
    overlayRef.current?.setPointerCapture(e.pointerId);
  }, [isVisible, transform.x, transform.y]);

  // マウス/タッチ移動
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !isVisible) return;

    const deltaX = e.clientX - startPos.current.x;
    const deltaY = e.clientY - startPos.current.y;

    // ピクセルをパーセンテージに変換（オーバーレイ全体のサイズ基準）
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percentX = (deltaX / rect.width) * 100;
    const percentY = (deltaY / rect.height) * 100;

    const newPos = clampPosition(
      startTransform.current.x + percentX,
      startTransform.current.y + percentY
    );

    onChange({ ...transform, ...newPos });
  }, [isVisible, transform, onChange]);

  // マウス/タッチ終了
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    overlayRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  // タッチ開始（ピンチ検出用）
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isVisible) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      lastTouchDistance.current = getTouchDistance(e.touches);
    }
  }, [isVisible]);

  // タッチ移動（ピンチズーム）
  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isVisible) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      if (currentDistance !== null && lastTouchDistance.current !== null) {
        const scaleFactor = currentDistance / lastTouchDistance.current;
        const newScale = Math.max(0.3, Math.min(2.0, transform.scale * scaleFactor));
        onChange({ ...transform, scale: newScale });
        lastTouchDistance.current = currentDistance;
      }
    }
  }, [isVisible, transform, onChange]);

  // タッチ終了
  const handleTouchEnd = useCallback(() => {
    lastTouchDistance.current = null;
  }, []);

  // イベントリスナー登録
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !isVisible) return;

    overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    overlay.addEventListener('touchend', handleTouchEnd);

    return () => {
      overlay.removeEventListener('touchstart', handleTouchStart);
      overlay.removeEventListener('touchmove', handleTouchMove);
      overlay.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isVisible, handleTouchStart, handleTouchMove, handleTouchEnd]);

  if (!isVisible) return null;

  return (
    <div
      ref={overlayRef}
      style={styles.overlay}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 操作ガイド */}
      <div style={styles.guideTop}>
        <span style={styles.guideText}>ドラッグで移動 / ピンチでサイズ</span>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    cursor: 'move',
    touchAction: 'none',
    backgroundColor: 'transparent',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  guideTop: {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    padding: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: '8px',
    margin: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    alignSelf: 'center',
  },
  guideText: {
    fontSize: '12px',
    color: '#666',
    fontWeight: 'bold',
  },
};
