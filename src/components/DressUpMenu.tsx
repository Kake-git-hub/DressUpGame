/**
 * DressUpMenu コンポーネント
 * カテゴリー選択 → ドラッグ&ドロップでアイテム着せ替え
 * リセットボタン・ドール切り替え・背景切り替え機能付き
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, CategoryInfo, DollData, BackgroundData, Position } from '../types';
import { CLOTHING_CATEGORIES } from '../types';

interface DressUpMenuProps {
  items: ClothingItemData[];
  onItemDrop: (item: ClothingItemData, dropPosition?: Position) => void;
  onItemRemove?: (type: ClothingType) => void; // 「なし」選択時の脱がせる処理
  equippedItems: ClothingItemData[];
  onReset: () => void;
  dolls: DollData[];
  currentDollId: string;
  onDollChange: (dollId: string) => void;
  dropTargetId: string;
  backgrounds?: BackgroundData[];
  currentBackgroundId?: string | null;
  onBackgroundChange?: (backgroundId: string | null) => void;
  // movableアイテムドラッグ中のコールバック
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
}

export function DressUpMenu({
  items,
  onItemDrop,
  onItemRemove,
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
  const [selectedCategory, setSelectedCategory] = useState<ClothingType | null>(null);
  const [showBackgrounds, setShowBackgrounds] = useState(false);

  // 装備中のアイテムIDをセット化
  const equippedIds = useMemo(() => new Set(equippedItems.map(i => i.id)), [equippedItems]);

  // 動的にカテゴリをカウント（itemsから自動検出）
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(item => {
      counts[item.type] = (counts[item.type] || 0) + 1;
    });
    return counts;
  }, [items]);

  // 動的カテゴリリスト（アイテムから検出）
  const dynamicCategories = useMemo(() => {
    const categoryMap = new Map<string, CategoryInfo>();
    items.forEach(item => {
      if (!categoryMap.has(item.type)) {
        // デフォルトカテゴリかどうかチェック
        const defaultCat = CLOTHING_CATEGORIES.find(c => c.type === item.type);
        if (defaultCat) {
          categoryMap.set(item.type, defaultCat);
        } else {
          // 動的カテゴリ
          categoryMap.set(item.type, {
            type: item.type,
            label: item.type,
            emoji: '📁',
          });
        }
      }
    });
    // デフォルトカテゴリの順序を優先
    const result: CategoryInfo[] = [];
    CLOTHING_CATEGORIES.forEach(cat => {
      if (categoryMap.has(cat.type)) {
        result.push(categoryMap.get(cat.type)!);
        categoryMap.delete(cat.type);
      }
    });
    // 残りの動的カテゴリを追加
    categoryMap.forEach(cat => result.push(cat));
    return result;
  }, [items]);

  // 選択中カテゴリーのアイテム
  const filteredItems = useMemo(() => {
    if (!selectedCategory) return [];
    return items.filter(item => item.type === selectedCategory);
  }, [items, selectedCategory]);

  // 現在選択中のカテゴリーで装備中のアイテム
  const equippedInCategory = useMemo(() => {
    if (!selectedCategory) return null;
    return equippedItems.find(item => item.type === selectedCategory) || null;
  }, [equippedItems, selectedCategory]);

  // カテゴリー選択
  const handleCategorySelect = (category: CategoryInfo) => {
    setSelectedCategory(prev => prev === category.type ? null : category.type);
  };

  // 戻るボタン
  const handleBack = () => {
    setSelectedCategory(null);
  };

  // 下着以外の装備数
  const clothingCount = equippedItems.filter(
    i => i.type !== 'underwear_top' && i.type !== 'underwear_bottom'
  ).length;

  // 背景選択
  const handleBackgroundSelect = (bgId: string | null) => {
    onBackgroundChange?.(bgId);
  };

  return (
    <div style={styles.container}>
      {/* ヘッダー：ドール選択のみ */}
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

      {showBackgrounds ? (
        // 背景選択画面
        <>
          {/* 戻るボタン（大きく） */}
          <button style={styles.backButtonLarge} onClick={() => setShowBackgrounds(false)}>
            ← もどる
          </button>
          
          <div style={styles.backgroundGrid}>
            {/* なし（背景なし）オプション */}
            <button
              style={{
                ...styles.backgroundButton,
                ...(currentBackgroundId === null ? styles.backgroundButtonSelected : {}),
              }}
              onClick={() => handleBackgroundSelect(null)}
            >
              <div style={styles.backgroundPreview}>
                <span style={{ fontSize: '24px' }}>✕</span>
              </div>
              <span style={styles.backgroundName}>なし</span>
            </button>
            
            {backgrounds.map(bg => (
              <button
                key={bg.id}
                style={{
                  ...styles.backgroundButton,
                  ...(currentBackgroundId === bg.id ? styles.backgroundButtonSelected : {}),
                }}
                onClick={() => handleBackgroundSelect(bg.id)}
              >
                <div style={styles.backgroundPreview}>
                  <img
                    src={bg.thumbnailUrl || bg.imageUrl}
                    alt={bg.name}
                    style={styles.backgroundImage}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="20">🖼️</text></svg>';
                    }}
                  />
                </div>
                <span style={styles.backgroundName}>{bg.name}</span>
              </button>
            ))}
          </div>
          
          {backgrounds.length === 0 && (
            <p style={styles.emptyMessage}>背景がまだありません</p>
          )}
        </>
      ) : !selectedCategory ? (
        // カテゴリー選択画面
        <>
          {/* 背景選択ボタン（一番上） */}
          <button
            style={styles.backgroundButtonTop}
            onClick={() => setShowBackgrounds(true)}
          >
            <span style={styles.categoryEmoji}>🖼️</span>
            <span style={styles.categoryLabel}>はいけい</span>
            {currentBackgroundId && <span style={styles.activeDot}>●</span>}
          </button>

          {/* リセットボタン（服を着ている場合のみ表示） */}
          {clothingCount > 0 && (
            <button style={styles.resetButtonTop} onClick={onReset}>
              🔄 リセット
            </button>
          )}
          <div style={styles.categoryGrid}>
            {dynamicCategories.map(category => (
              <button
                key={category.type}
                style={{
                  ...styles.categoryButton,
                  opacity: (categoryCounts[category.type] || 0) === 0 ? 0.5 : 1,
                }}
                onClick={() => handleCategorySelect(category)}
                disabled={(categoryCounts[category.type] || 0) === 0}
              >
                <span style={styles.categoryEmoji}>{category.emoji}</span>
                <span style={styles.categoryLabel}>{category.label}</span>
                <span style={styles.categoryCount}>
                  {categoryCounts[category.type] || 0}こ
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        // アイテム選択画面（ドラッグ&ドロップ）
        <>
          {/* 戻るボタン（大きく） */}
          <button style={styles.backButtonLarge} onClick={handleBack}>
            ← もどる
          </button>

          <div style={styles.itemGrid}>
            {filteredItems.map(item => (
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

          {/* 「なし」ボタン - 一番下に配置 */}
          {equippedInCategory && onItemRemove && (
            <button
              style={styles.noneButtonBottom}
              onClick={() => {
                onItemRemove(selectedCategory!);
                handleBack();
              }}
            >
              ✕ なし
            </button>
          )}

          {filteredItems.length === 0 && (
            <p style={styles.emptyMessage}>
              このカテゴリーにはアイテムがありません
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ドラッグ可能なアイテムコンポーネント
interface DraggableItemProps {
  item: ClothingItemData;
  isEquipped: boolean;
  onDrop: (item: ClothingItemData, dropPosition?: Position) => void;
  dropTargetId: string;
  onDragMove?: (item: ClothingItemData, position: Position) => void;
  onDragEnd?: () => void;
}

function DraggableItem({ item, isEquipped, onDrop, dropTargetId, onDragMove, onDragEnd }: DraggableItemProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  // ドロップターゲットの上にいるかチェック
  const checkIsOverTarget = useCallback((clientX: number, clientY: number): boolean => {
    const targetElement = document.querySelector(`[data-testid="${dropTargetId}"]`);
    if (!targetElement) return false;
    const rect = targetElement.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && 
           clientY >= rect.top && clientY <= rect.bottom;
  }, [dropTargetId]);

  // ポインターダウン（タッチ・マウス両対応）
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: 0, y: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  // ポインタームーブ
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragPos({
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    });
    // 全アイテムで親にドラッグ位置を通知（プレビュー表示用）
    if (onDragMove) {
      onDragMove(item, { x: e.clientX, y: e.clientY });
    }
  }, [isDragging, item, onDragMove]);

  // ポインターアップ
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    onDragEnd?.();
    
    if (checkIsOverTarget(e.clientX, e.clientY)) {
      // movableアイテムの場合、ドロップ位置を渡す
      if (item.movable) {
        onDrop(item, { x: e.clientX, y: e.clientY });
      } else {
        onDrop(item);
      }
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
    >      <div style={styles.itemImageContainer}>
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

const styles: Record<string, CSSProperties> = {
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
    padding: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    width: '140px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    height: 'calc(100vh - 60px)',
    overflow: 'hidden',
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingBottom: '6px',
    borderBottom: '1px solid #e9ecef',
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
  actionButtons: {
    display: 'flex',
    gap: '6px',
    marginTop: '4px',
    paddingTop: '6px',
    borderTop: '1px solid #e9ecef',
  },
  actionButton: {
    flex: 1,
    padding: '8px',
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#333',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
  },
  activeDot: {
    color: '#ff69b4',
    fontSize: '10px',
  },
  resetButtonTop: {
    width: '100%',
    padding: '8px',
    marginBottom: '6px',
    fontSize: '11px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  resetButtonLarge: {
    flex: 1,
    padding: '10px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  backgroundGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '4px',
    overflowY: 'auto',
    flex: 1,
  },
  backgroundButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '3px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  backgroundButtonSelected: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  backgroundPreview: {
    width: '48px',
    height: '36px',
    borderRadius: '4px',
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  backgroundName: {
    fontSize: '9px',
    color: '#333',
    marginTop: '2px',
    maxWidth: '50px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    margin: '0',
    fontSize: '14px',
    color: '#333',
    textAlign: 'center',
  },
  titleSmall: {
    margin: '0',
    fontSize: '12px',
    color: '#333',
    flex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  backButton: {
    padding: '4px 8px',
    fontSize: '11px',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  backButtonLarge: {
    width: '100%',
    padding: '12px',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  backgroundButtonTop: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '8px',
    marginBottom: '6px',
    backgroundColor: '#e0f7fa',
    border: '2px solid #80deea',
    borderRadius: '8px',
    cursor: 'pointer',
    gap: '6px',
  },
  categoryGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowY: 'auto',
    flex: 1,
  },
  categoryButton: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '6px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    gap: '6px',
  },
  categoryEmoji: {
    fontSize: '18px',
  },
  categoryLabel: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  categoryCount: {
    fontSize: '9px',
    color: '#666',
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '4px',
    overflowY: 'auto',
    flex: 1,
  },
  itemButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '6px',
    transition: 'box-shadow 0.2s',
    userSelect: 'none',
    aspectRatio: '1',
  },
  itemButtonEquipped: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
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
  equippedBadge: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    width: '14px',
    height: '14px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: 'bold',
  },
  itemName: {
    fontSize: '10px',
    color: '#333',
    textAlign: 'left',
    lineHeight: 1.2,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noneButtonBottom: {
    width: '100%',
    padding: '12px',
    marginTop: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
    backgroundColor: '#f8f8f8',
    border: '2px dashed #ccc',
    borderRadius: '8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#666',
    padding: '12px',
    fontSize: '11px',
  },
};
