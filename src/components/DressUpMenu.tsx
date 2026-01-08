/**
 * DressUpMenu コンポーネント
 * 背景はボタン切り替えで別画面、服はフォルダ名でグループ化して表示
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, DollData, BackgroundData, Position } from '../types';

interface DressUpMenuProps {
  items: ClothingItemData[];
  onItemDrop: (item: ClothingItemData) => void;
  onItemRemove?: (type: ClothingType) => void;
  equippedItems: ClothingItemData[];
  onReset: () => void;
  dolls: DollData[];
  currentDollId: string;
  onDollChange: (dollId: string) => void;
  dropTargetId: string;
  backgrounds?: BackgroundData[];
  currentBackgroundId?: string | null;
  onBackgroundChange?: (backgroundId: string | null) => void;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
}

export function DressUpMenu({
  items,
  onItemDrop,
  equippedItems,
  onReset,
  dolls,
  currentDollId,
  onDollChange,
  dropTargetId,
  backgrounds = [],
  currentBackgroundId = null,
  onBackgroundChange,
  onDragMove,
  onDragEnd,
}: DressUpMenuProps) {
  // 背景選択画面の表示状態
  const [showBackgrounds, setShowBackgrounds] = useState(false);

  // 装備中のアイテムIDをセット化
  const equippedIds = useMemo(() => new Set(equippedItems.map(i => i.id)), [equippedItems]);

  // 下着以外の装備数
  const clothingCount = equippedItems.filter(
    i => i.type !== 'underwear_top' && i.type !== 'underwear_bottom'
  ).length;

  // アイテムをフォルダ名(type)でグループ化
  const groupedItems = useMemo(() => {
    const groups = new Map<string, ClothingItemData[]>();
    
    // layerOrder順にソートしてからグループ化
    const sortedItems = [...items].sort((a, b) => {
      const aLayer = a.layerOrder ?? a.baseZIndex ?? 0;
      const bLayer = b.layerOrder ?? b.baseZIndex ?? 0;
      return aLayer - bLayer;
    });
    
    sortedItems.forEach(item => {
      const key = item.type;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    });
    
    return groups;
  }, [items]);

  // 背景選択画面
  if (showBackgrounds) {
    return (
      <div style={styles.container}>
        {/* 戻るボタン */}
        <button 
          style={styles.backButton} 
          onClick={() => setShowBackgrounds(false)}
        >
          ← もどる
        </button>

        <div style={styles.sectionLabel}>🖼️ はいけい</div>

        <div style={styles.itemList}>
          {/* 背景なしオプション */}
          <button
            style={{
              ...styles.itemButton,
              ...(currentBackgroundId === null ? styles.itemButtonSelected : {}),
            }}
            onClick={() => onBackgroundChange?.(null)}
          >
            <div style={styles.itemImageContainer}>
              <span style={{ fontSize: '24px' }}>✕</span>
            </div>
            <span style={styles.itemLabel}>なし</span>
          </button>

          {backgrounds.map(bg => (
            <button
              key={bg.id}
              style={{
                ...styles.itemButton,
                ...(currentBackgroundId === bg.id ? styles.itemButtonSelected : {}),
              }}
              onClick={() => onBackgroundChange?.(bg.id)}
            >
              <div style={styles.itemImageContainer}>
                <img
                  src={bg.thumbnailUrl || bg.imageUrl}
                  alt={bg.name}
                  style={styles.itemImage}
                  draggable={false}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="20">🖼️</text></svg>';
                  }}
                />
              </div>
            </button>
          ))}

          {backgrounds.length === 0 && (
            <p style={styles.emptyMessage}>
              背景がありません<br />
              設定からプリセットを取り込んでください
            </p>
          )}
        </div>
      </div>
    );
  }

  // メインメニュー（服アイテム）
  return (
    <div style={styles.container}>
      {/* ヘッダー：ドール選択 */}
      <div style={styles.menuHeader}>
        <select
          style={styles.dollSelect}
          value={currentDollId}
          onChange={(e) => onDollChange(e.target.value)}
          disabled={dolls.length === 0}
        >
          {dolls.length === 0 ? (
            <option value="">ドールなし</option>
          ) : (
            dolls.map(doll => (
              <option key={doll.id} value={doll.id}>
                {doll.name}
              </option>
            ))
          )}
        </select>
      </div>

      {/* 背景ボタン */}
      {backgrounds.length > 0 && (
        <button 
          style={{
            ...styles.backgroundButton,
            ...(currentBackgroundId ? styles.backgroundButtonActive : {}),
          }}
          onClick={() => setShowBackgrounds(true)}
        >
          🖼️ はいけい {currentBackgroundId ? '✓' : ''}
        </button>
      )}

      {/* リセットボタン（服を着ている場合のみ表示） */}
      {clothingCount > 0 && (
        <button style={styles.resetButton} onClick={onReset}>
          🔄 リセット
        </button>
      )}

      {/* スクロール可能なアイテムリスト */}
      <div style={styles.itemList}>
        {Array.from(groupedItems.entries()).map(([folderName, folderItems]) => (
          <div key={folderName}>
            {/* フォルダ名ラベル */}
            <div style={styles.folderLabel}>{folderName}</div>
            
            {/* フォルダ内アイテム */}
            {folderItems.map(item => (
              <DraggableItem
                key={item.id}
                item={item}
                isEquipped={equippedIds.has(item.id)}
                onDrop={onItemDrop}
                dropTargetId={dropTargetId}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        ))}

        {items.length === 0 && (
          <p style={styles.emptyMessage}>
            アイテムがありません<br />
            設定からプリセットを取り込んでください
          </p>
        )}
      </div>
    </div>
  );
}

// ドラッグ可能なアイテムコンポーネント
interface DraggableItemProps {
  item: ClothingItemData;
  isEquipped: boolean;
  onDrop: (item: ClothingItemData) => void;
  dropTargetId: string;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
}

function DraggableItem({ item, isEquipped, onDrop, dropTargetId, onDragMove, onDragEnd }: DraggableItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  const checkIsOverTarget = useCallback((clientX: number, clientY: number): boolean => {
    const targetElement = document.querySelector(`[data-testid="${dropTargetId}"]`);
    if (!targetElement) return false;
    const rect = targetElement.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && 
           clientY >= rect.top && clientY <= rect.bottom;
  }, [dropTargetId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: 0, y: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragPos({
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    });
    if (onDragMove) {
      onDragMove(item, { x: e.clientX, y: e.clientY });
    }
  }, [isDragging, item, onDragMove]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    onDragEnd?.();
    
    if (checkIsOverTarget(e.clientX, e.clientY)) {
      onDrop(item);
    }
  }, [isDragging, checkIsOverTarget, onDrop, item, onDragEnd]);

  return (
    <div
      ref={elementRef}
      style={{
        ...styles.itemButton,
        ...(isEquipped ? styles.itemButtonEquipped : {}),
        ...(isDragging ? styles.itemDragging : {}),
        transform: isDragging ? `translate(${dragPos.x}px, ${dragPos.y}px)` : 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setIsDragging(false);
        setDragPos({ x: 0, y: 0 });
        onDragEnd?.();
      }}
    >
      <div style={styles.itemImageContainer}>
        <img
          src={item.thumbnailUrl || item.imageUrl}
          alt={item.name}
          style={styles.itemImage}
          draggable={false}
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">?</text></svg>';
          }}
        />
        {isEquipped && (
          <div style={styles.equippedBadge}>✓</div>
        )}
      </div>
    </div>
  );
}

const MENU_WIDTH = 140;
const ITEM_PADDING = 6;
const ITEM_SIZE = MENU_WIDTH - ITEM_PADDING * 2 - 12;

const styles: Record<string, CSSProperties> = {
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    padding: `${ITEM_PADDING}px`,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    width: `${MENU_WIDTH}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    height: '100%',
    maxHeight: 'calc(100vh - 140px)',
    overflow: 'hidden',
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingBottom: '6px',
    borderBottom: '1px solid #e9ecef',
    flexShrink: 0,
  },
  dollSelect: {
    flex: 1,
    padding: '6px 8px',
    fontSize: '12px',
    borderRadius: '6px',
    border: '2px solid #e9ecef',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  backgroundButton: {
    width: '100%',
    padding: '8px',
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#666',
    backgroundColor: '#e9ecef',
    border: '2px solid #dee2e6',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
    marginBottom: '4px',
  },
  backgroundButtonActive: {
    backgroundColor: '#d4edda',
    borderColor: '#28a745',
    color: '#155724',
  },
  backButton: {
    width: '100%',
    padding: '10px',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
    marginBottom: '8px',
  },
  resetButton: {
    width: '100%',
    padding: '8px',
    marginBottom: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowY: 'auto',
    flex: 1,
    paddingRight: '2px',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#333',
    padding: '8px 4px',
    marginBottom: '4px',
    borderBottom: '2px solid #ff69b4',
  },
  folderLabel: {
    fontSize: '10px',
    fontWeight: 'bold',
    color: '#666',
    padding: '6px 4px 2px',
    marginTop: '4px',
    borderBottom: '1px solid #e9ecef',
    backgroundColor: '#f0f0f0',
    borderRadius: '4px 4px 0 0',
  },
  itemButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    transition: 'box-shadow 0.2s',
    userSelect: 'none',
    width: `${ITEM_SIZE}px`,
    height: `${ITEM_SIZE}px`,
    flexShrink: 0,
  },
  itemButtonEquipped: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  itemButtonSelected: {
    border: '2px solid #28a745',
    backgroundColor: '#d4edda',
  },
  itemDragging: {
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.3)',
    zIndex: 1000,
    opacity: 0.9,
  },
  itemImageContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
  },
  itemLabel: {
    fontSize: '10px',
    color: '#666',
    marginTop: '2px',
  },
  equippedBadge: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    width: '16px',
    height: '16px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 'bold',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#666',
    padding: '12px',
    fontSize: '11px',
    lineHeight: 1.5,
  },
};
