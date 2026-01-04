/**
 * ClothingPalette コンポーネント
 * 利用可能な服アイテムを一覧表示するパレット
 */
import { DraggableClothingItem } from './DraggableClothingItem';
import type { ClothingItemData } from '../types';

interface ClothingPaletteProps {
  items: ClothingItemData[];
  onItemSelect: (item: ClothingItemData) => void;
  equippedItems: ClothingItemData[];
  dropTargetId?: string;
}

export function ClothingPalette({ 
  items, 
  onItemSelect, 
  equippedItems,
  dropTargetId = 'avatar-canvas',
}: ClothingPaletteProps) {
  // 装備中のアイテムIDを取得
  const equippedIds = new Set(equippedItems.map((item) => item.id));

  return (
    <div
      data-testid="clothing-palette"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '16px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        maxWidth: '400px',
      }}
    >
      <h3
        style={{
          width: '100%',
          margin: '0 0 8px 0',
          fontSize: '16px',
          color: '#333',
          textAlign: 'center',
        }}
      >
        👚 きせかえアイテム
      </h3>
      <p
        style={{
          width: '100%',
          margin: '0 0 8px 0',
          fontSize: '12px',
          color: '#666',
          textAlign: 'center',
        }}
      >
        ドラッグしてドールに着せよう！
      </p>
      {items.map((item) => (
        <DraggableClothingItem
          key={item.id}
          item={item}
          onDropOnTarget={onItemSelect}
          dropTargetId={dropTargetId}
          disabled={equippedIds.has(item.id)}
        />
      ))}
    </div>
  );
}
