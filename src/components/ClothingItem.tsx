/**
 * ClothingItem コンポーネント
 * ドラッグ可能な洋服アイテム
 */
import { useCallback, useState, useRef } from 'react';
import type { ClothingItemData, Position } from '../types';

interface ClothingItemProps {
  item: ClothingItemData;
  onDrop: (item: ClothingItemData) => void;
  disabled?: boolean;
}

// 服タイプに応じた色を返す
const getColorByType = (type: ClothingItemData['type']): string => {
  const colors: Record<ClothingItemData['type'], string> = {
    top: '#6495ED',
    bottom: '#FF69B4',
    dress: '#9370DB',
    shoes: '#8B4513',
    accessory: '#FF1493',
  };
  return colors[type];
};

// 服タイプに応じたラベルを返す
const getLabelByType = (type: ClothingItemData['type']): string => {
  const labels: Record<ClothingItemData['type'], string> = {
    top: 'トップス',
    bottom: 'ボトムス',
    dress: 'ワンピース',
    shoes: 'くつ',
    accessory: 'アクセサリー',
  };
  return labels[type];
};

export function ClothingItem({ item, onDrop, disabled = false }: ClothingItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const dragStartPos = useRef<Position>({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  // ドラッグ開始
  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) return;

      setIsDragging(true);
      dragStartPos.current = { x: clientX, y: clientY };
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
    },
    [isDragging]
  );

  // ドラッグ終了
  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);
    setPosition({ x: 0, y: 0 });

    // ドロップ成功として処理
    onDrop(item);
  }, [isDragging, item, onDrop]);

  // マウスイベント
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleDragMove(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    handleDragEnd();
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      handleDragEnd();
    }
  };

  // タッチイベント（iPad対応）
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = () => {
    handleDragEnd();
  };

  return (
    <div
      ref={elementRef}
      data-testid={`clothing-item-${item.id}`}
      role="button"
      aria-label={`${item.name}をドラッグして着せる`}
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
        opacity: disabled ? 0.5 : isDragging ? 0.7 : 1,
        transform: `translate(${position.x}px, ${position.y}px) scale(${isDragging ? 1.1 : 1})`,
        transition: isDragging ? 'none' : 'transform 0.2s, opacity 0.2s',
        boxShadow: isDragging
          ? '0 8px 20px rgba(0, 0, 0, 0.3)'
          : '0 2px 8px rgba(0, 0, 0, 0.15)',
        userSelect: 'none',
        touchAction: 'none',
        zIndex: isDragging ? 100 : 1,
        position: 'relative',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <span style={{ fontSize: '24px', marginBottom: '4px' }}>
        {item.type === 'top' && '👕'}
        {item.type === 'bottom' && '👖'}
        {item.type === 'dress' && '👗'}
        {item.type === 'shoes' && '👟'}
        {item.type === 'accessory' && '🎀'}
      </span>
      <span
        style={{
          fontSize: '10px',
          color: 'white',
          fontWeight: 'bold',
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
        }}
      >
        {getLabelByType(item.type)}
      </span>
    </div>
  );
}
