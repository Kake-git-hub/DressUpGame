/**
 * DraggableClothingItem コンポーネント
 * ドラッグ＆ドロップで服を着せるコンポーネント
 * iPad（Apple Pencil）対応
 */
import { useCallback, useState, useRef, useEffect } from 'react';
import type { ClothingItemData, Position } from '../types';

interface DraggableClothingItemProps {
  item: ClothingItemData;
  onDropOnTarget: (item: ClothingItemData) => void;
  dropTargetId: string; // ドロップ先のdata-testid
  disabled?: boolean;
}

// 服タイプに応じた色を返す
const getColorByType = (type: ClothingItemData['type']): string => {
  const colors: Record<ClothingItemData['type'], string> = {
    underwear_top: '#FFFFFF',
    underwear_bottom: '#FFFFFF',
    top: '#6495ED',
    bottom: '#FF69B4',
    dress: '#9370DB',
    shoes: '#8B4513',
    accessory: '#FF1493',
  };
  return colors[type];
};

// 服タイプに応じた絵文字を返す
const getEmojiByType = (type: ClothingItemData['type']): string => {
  const emojis: Record<ClothingItemData['type'], string> = {
    underwear_top: '🩱',
    underwear_bottom: '🩲',
    top: '👕',
    bottom: '👖',
    dress: '👗',
    shoes: '👟',
    accessory: '🎀',
  };
  return emojis[type];
};

// 服タイプに応じたラベルを返す
const getLabelByType = (type: ClothingItemData['type']): string => {
  const labels: Record<ClothingItemData['type'], string> = {
    underwear_top: 'したぎ(うえ)',
    underwear_bottom: 'したぎ(した)',
    top: 'トップス',
    bottom: 'ボトムス',
    dress: 'ワンピース',
    shoes: 'くつ',
    accessory: 'アクセサリー',
  };
  return labels[type];
};

export function DraggableClothingItem({
  item,
  onDropOnTarget,
  dropTargetId,
  disabled = false,
}: DraggableClothingItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isOverTarget, setIsOverTarget] = useState(false);
  const dragStartPos = useRef<Position>({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);
  const initialRect = useRef<DOMRect | null>(null);

  // ドロップターゲットの上にいるかチェック
  const checkIsOverTarget = useCallback((clientX: number, clientY: number): boolean => {
    const targetElement = document.querySelector(`[data-testid="${dropTargetId}"]`);
    if (!targetElement) return false;

    const targetRect = targetElement.getBoundingClientRect();
    return (
      clientX >= targetRect.left &&
      clientX <= targetRect.right &&
      clientY >= targetRect.top &&
      clientY <= targetRect.bottom
    );
  }, [dropTargetId]);

  // ドラッグ開始
  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) return;

      setIsDragging(true);
      dragStartPos.current = { x: clientX, y: clientY };
      
      if (elementRef.current) {
        initialRect.current = elementRef.current.getBoundingClientRect();
      }
    },
    [disabled]
  );

  // ドラッグ中
  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;

      const deltaX = clientX - dragStartPos.current.x;
      const deltaY = clientY - dragStartPos.current.y;
      setPosition({ x: deltaX, y: deltaY });
      setIsOverTarget(checkIsOverTarget(clientX, clientY));
    },
    [isDragging, checkIsOverTarget]
  );

  // ドラッグ終了
  const handleDragEnd = useCallback(
    (clientX?: number, clientY?: number) => {
      if (!isDragging) return;

      // ドロップ位置を計算
      const finalX = clientX ?? (dragStartPos.current.x + position.x);
      const finalY = clientY ?? (dragStartPos.current.y + position.y);

      // ターゲット上でドロップした場合のみ着せる
      if (checkIsOverTarget(finalX, finalY)) {
        onDropOnTarget(item);
      }

      setIsDragging(false);
      setPosition({ x: 0, y: 0 });
      setIsOverTarget(false);
    },
    [isDragging, position, checkIsOverTarget, item, onDropOnTarget]
  );

  // グローバルマウスイベント（ドラッグ中は要素外でも追跡）
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      handleDragEnd(e.clientX, e.clientY);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // グローバルタッチイベント
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        handleDragMove(touch.clientX, touch.clientY);
      }
    };

    const handleGlobalTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        handleDragEnd(touch.clientX, touch.clientY);
      }
    };

    window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    window.addEventListener('touchend', handleGlobalTouchEnd);
    window.addEventListener('touchcancel', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
      window.removeEventListener('touchcancel', handleGlobalTouchEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // マウスイベント
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  // タッチイベント（iPad / Apple Pencil対応）
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };

  return (
    <div
      ref={elementRef}
      data-testid={`clothing-item-${item.id}`}
      role="button"
      aria-label={`${item.name}をドラッグしてドールに着せる`}
      tabIndex={disabled ? -1 : 0}
      style={{
        width: '80px',
        height: '80px',
        backgroundColor: getColorByType(item.type),
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
        opacity: disabled ? 0.5 : isDragging ? 0.8 : 1,
        transform: `translate(${position.x}px, ${position.y}px) scale(${isDragging ? 1.15 : 1})`,
        transition: isDragging ? 'none' : 'transform 0.3s ease-out, opacity 0.2s, box-shadow 0.2s',
        boxShadow: isDragging
          ? isOverTarget
            ? '0 12px 30px rgba(0, 200, 0, 0.5), 0 0 20px rgba(0, 255, 0, 0.3)'
            : '0 12px 30px rgba(0, 0, 0, 0.4)'
          : '0 3px 10px rgba(0, 0, 0, 0.2)',
        userSelect: 'none',
        touchAction: 'none',
        zIndex: isDragging ? 1000 : 1,
        position: 'relative',
        border: isOverTarget ? '3px solid #00ff00' : '3px solid transparent',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <span style={{ fontSize: '28px', marginBottom: '2px' }}>
        {getEmojiByType(item.type)}
      </span>
      <span
        style={{
          fontSize: '10px',
          color: 'white',
          fontWeight: 'bold',
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)',
        }}
      >
        {getLabelByType(item.type)}
      </span>
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            bottom: '-20px',
            fontSize: '10px',
            color: isOverTarget ? '#00cc00' : '#666',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
          }}
        >
          {isOverTarget ? '✓ はなしてきせる！' : 'ドールへドラッグ'}
        </div>
      )}
    </div>
  );
}
