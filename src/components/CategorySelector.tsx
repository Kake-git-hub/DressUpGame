/**
 * CategorySelector コンポーネント
 * カテゴリー選択 → アイテム選択の2段階UI
 */
import { useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ClothingItemData, ClothingType, CategoryInfo } from '../types';
import { CLOTHING_CATEGORIES } from '../types';

interface CategorySelectorProps {
  items: ClothingItemData[];
  onItemSelect: (item: ClothingItemData) => void;
  equippedItems: ClothingItemData[];
}

export function CategorySelector({
  items,
  onItemSelect,
  equippedItems,
}: CategorySelectorProps) {
  const [selectedCategory, setSelectedCategory] = useState<ClothingType | null>(null);

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

  // アイテム選択
  const handleItemSelect = (item: ClothingItemData) => {
    onItemSelect(item);
  };

  // 戻るボタン
  const handleBack = () => {
    setSelectedCategory(null);
  };

  return (
    <div style={styles.container}>
      {!selectedCategory ? (
        // カテゴリー選択画面
        <>
          <h3 style={styles.title}>👚 カテゴリーをえらんでね</h3>
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
        </>
      ) : (
        // アイテム選択画面
        <>
          <div style={styles.header}>
            <button style={styles.backButton} onClick={handleBack}>
              ← もどる
            </button>
            <h3 style={styles.title}>
              {CLOTHING_CATEGORIES.find(c => c.type === selectedCategory)?.emoji}{' '}
              {CLOTHING_CATEGORIES.find(c => c.type === selectedCategory)?.label}
            </h3>
          </div>
          
          {equippedInCategory && (
            <div style={styles.equippedInfo}>
              いま着ているもの: <strong>{equippedInCategory.name}</strong>
            </div>
          )}

          <div style={styles.itemGrid}>
            {filteredItems.map(item => {
              const isEquipped = equippedIds.has(item.id);
              return (
                <button
                  key={item.id}
                  style={{
                    ...styles.itemButton,
                    ...(isEquipped ? styles.itemButtonEquipped : {}),
                  }}
                  onClick={() => handleItemSelect(item)}
                >
                  <div style={styles.itemImageContainer}>
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      style={styles.itemImage}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23999" font-size="40">?</text></svg>';
                      }}
                    />
                    {isEquipped && (
                      <div style={styles.equippedBadge}>✓</div>
                    )}
                  </div>
                  <span style={styles.itemName}>{item.name}</span>
                </button>
              );
            })}
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

const styles: Record<string, CSSProperties> = {
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    minWidth: '280px',
    maxWidth: '320px',
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '18px',
    color: '#333',
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  backButton: {
    padding: '8px 12px',
    fontSize: '14px',
    backgroundColor: '#e9ecef',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  categoryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
  },
  categoryButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px 8px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  categoryEmoji: {
    fontSize: '32px',
    marginBottom: '4px',
  },
  categoryLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  categoryCount: {
    fontSize: '12px',
    color: '#666',
    marginTop: '2px',
  },
  equippedInfo: {
    padding: '8px 12px',
    backgroundColor: '#fff3cd',
    borderRadius: '8px',
    fontSize: '13px',
    marginBottom: '12px',
    textAlign: 'center',
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  itemButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px',
    backgroundColor: 'white',
    border: '2px solid #e9ecef',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  itemButtonEquipped: {
    border: '2px solid #ff69b4',
    backgroundColor: '#fff5f8',
  },
  itemImageContainer: {
    position: 'relative',
    width: '60px',
    height: '60px',
    marginBottom: '4px',
  },
  itemImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  equippedBadge: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    width: '20px',
    height: '20px',
    backgroundColor: '#ff69b4',
    color: 'white',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  itemName: {
    fontSize: '11px',
    color: '#333',
    textAlign: 'center',
    lineHeight: 1.2,
    maxWidth: '70px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#666',
    padding: '20px',
  },
};
