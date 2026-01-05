/**
 * DressUpMenu コンポーネント
 * カテゴリー選択 → ドラッグ&ドロップでアイテム着せ替え
 * リセットボタン・ドール切り替え・背景切り替え機能付き
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, CategoryInfo, DollData, BackgroundData } from '../types';
import { CLOTHING_CATEGORIES } from '../types';

interface DressUpMenuProps {
  items: ClothingItemData[];
  onItemDrop: (item: ClothingItemData) => void;
  equippedItems: ClothingItemData[];
  onReset: () => void;
  dolls: DollData[];
  currentDollId: string;
  onDollChange: (dollId: string) => void;
  dropTargetId: string;
  backgrounds?: BackgroundData[];
  currentBackgroundId?: string | null;
  onBackgroundChange?: (backgroundId: string | null) => void;
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
}: DressUpMenuProps) {
  const [selectedCategory, setSelectedCategory] = useState<ClothingType | null>(null);
  const [showBackgrounds, setShowBackgrounds] = useState(false);

  // 装備中のアイテムIDをセット化
  const equippedIds = useMemo(() => new Set(equippedItems.map(i => i.id)), [equippedItems]);

  // 各カテゴリーのアイテム数をカウント
  const categoryCounts = useMemo(() => {
    const counts: Record<ClothingType, number> = {
      underwear_top: 0,
      underwear_bottom: 0,
      top: 0,
      bottom: 0,
      dress: 0,
      accessory: 0,
      shoes: 0,
    };
    items.forEach(item => {
      counts[item.type]++;
    });
    return counts;
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
        >
          {dolls.map(doll => (
            <option key={doll.id} value={doll.id}>
              {doll.name}
            </option>
          ))}
        </select>
      </div>

      {showBackgrounds ? (
        // 背景選択画面
        <>
          <div style={styles.header}>
            <button style={styles.backButton} onClick={() => setShowBackgrounds(false)}>
              ← もどる
            </button>
            <h3 style={styles.titleSmall}>🖼️ はいけい</h3>
          </div>
          
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
          {/* リセットボタン（服を着ている場合のみ表示） */}
          {clothingCount > 0 && (
            <button style={styles.resetButtonTop} onClick={onReset}>
              🔄 リセット
            </button>
          )}
          <div style={styles.categoryGrid}>
            {CLOTHING_CATEGORIES.map(category => (
              <button
                key={category.type}
                style={{
                  ...styles.categoryButton,
                  opacity: categoryCounts[category.type] === 0 ? 0.5 : 1,
                }}
                onClick={() => handleCategorySelect(category)}
                disabled={categoryCounts[category.type] === 0}
              >
                <span style={styles.categoryEmoji}>{category.emoji}</span>
                <span style={styles.categoryLabel}>{category.label}</span>
                <span style={styles.categoryCount}>
                  {categoryCounts[category.type]}こ
                </span>
              </button>
            ))}
          </div>
          
          {/* 背景選択ボタン */}
          <div style={styles.actionButtons}>
            <button
              style={styles.actionButton}
              onClick={() => setShowBackgrounds(true)}
            >
              🖼️ はいけい
              {currentBackgroundId && <span style={styles.activeDot}>●</span>}
            </button>
          </div>
        </>
      ) : (
        // アイテム選択画面（ドラッグ&ドロップ）
        <>
          <div style={styles.header}>
            <button style={styles.backButton} onClick={handleBack}>
              ← もどる
            </button>
            <h3 style={styles.titleSmall}>
              {CLOTHING_CATEGORIES.find(c => c.type === selectedCategory)?.emoji}{' '}
              {CLOTHING_CATEGORIES.find(c => c.type === selectedCategory)?.label}
            </h3>
          </div>
          
          {equippedInCategory && (
            <div style={styles.equippedInfo}>
              いま着ているもの: <strong>{equippedInCategory.name}</strong>
            </div>
          )}

          <p style={styles.hint}>👆 ドラッグしてドールにきせてね！</p>

          <div style={styles.itemGrid}>
            {filteredItems.map(item => (
              <DraggableItem
                key={item.id}
                item={item}
                isEquipped={equippedIds.has(item.id)}
                onDrop={onItemDrop}
                dropTargetId={dropTargetId}
              />
            ))}
          </div>

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
  onDrop: (item: ClothingItemData) => void;
  dropTargetId: string;
}

function DraggableItem({ item, isEquipped, onDrop, dropTargetId }: DraggableItemProps) {
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
  }, [isDragging]);

  // ポインターアップ
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    setDragPos({ x: 0, y: 0 });
    
    if (checkIsOverTarget(e.clientX, e.clientY)) {
      onDrop(item);
    }
  }, [isDragging, checkIsOverTarget, onDrop, item]);

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
      }}
    >
      <div style={styles.itemImageContainer}>
        <img
          src={item.imageUrl}
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
      <span style={styles.itemName}>{item.name}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '16px',
    padding: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    minWidth: '280px',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  menuHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    paddingBottom: '8px',
    borderBottom: '1px solid #e9ecef',
  },
  dollSelect: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '8px',
    border: '2px solid #e9ecef',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #e9ecef',
  },
  actionButton: {
    flex: 1,
    padding: '10px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#333',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '8px',
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
    padding: '10px',
    marginBottom: '10px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '8px',
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
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  backgroundButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '6px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  backgroundButtonSelected: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  backgroundPreview: {
    width: '60px',
    height: '45px',
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
    fontSize: '10px',
    color: '#333',
    marginTop: '4px',
  },
  title: {
    margin: '0',
    fontSize: '16px',
    color: '#333',
    textAlign: 'center',
  },
  titleSmall: {
    margin: '0',
    fontSize: '14px',
    color: '#333',
    flex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  backButton: {
    padding: '6px 10px',
    fontSize: '13px',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  hint: {
    margin: '0',
    fontSize: '12px',
    color: '#666',
    textAlign: 'center',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  categoryButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 6px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  categoryEmoji: {
    fontSize: '28px',
    marginBottom: '2px',
  },
  categoryLabel: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#333',
  },
  categoryCount: {
    fontSize: '11px',
    color: '#666',
  },
  equippedInfo: {
    padding: '6px 10px',
    backgroundColor: '#fff3cd',
    borderRadius: '6px',
    fontSize: '12px',
    textAlign: 'center',
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
  },
  itemButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '6px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '8px',
    transition: 'box-shadow 0.2s',
    userSelect: 'none',
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
    width: '55px',
    height: '55px',
    marginBottom: '2px',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
  },
  equippedBadge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    width: '18px',
    height: '18px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 'bold',
  },
  itemName: {
    fontSize: '10px',
    color: '#333',
    textAlign: 'center',
    lineHeight: 1.1,
    maxWidth: '60px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#666',
    padding: '16px',
    fontSize: '13px',
  },
};
