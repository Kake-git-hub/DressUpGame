/**
 * ItemManager コンポーネント
 * アイテムの一覧表示・管理を行うパネル
 */
import { useState, useCallback } from 'react';
import type { ClothingItemData, ClothingType } from '../types';
import { deleteCustomItem } from '../services/dataManager';

interface ItemManagerProps {
  items: ClothingItemData[];
  onItemsChange: (items: ClothingItemData[]) => void;
  onAddItem: () => void;
  onClose: () => void;
}

// タイプのラベル
const TYPE_LABELS: Record<ClothingType, string> = {
  underwear_top: 'したぎ(うえ)',
  underwear_bottom: 'したぎ(した)',
  top: 'トップス',
  bottom: 'ボトムス',
  dress: 'ワンピース',
  shoes: 'くつ',
  accessory: 'アクセサリー',
};

// タイプの絵文字
const TYPE_EMOJIS: Record<ClothingType, string> = {
  underwear_top: '🩱',
  underwear_bottom: '🩲',
  top: '👕',
  bottom: '👖',
  dress: '👗',
  shoes: '👟',
  accessory: '🎀',
};

export function ItemManager({ items, onItemsChange, onAddItem, onClose }: ItemManagerProps) {
  const [filterType, setFilterType] = useState<ClothingType | 'all'>('all');
  const [showCustomOnly, setShowCustomOnly] = useState(false);

  // フィルタされたアイテム
  const filteredItems = items.filter(item => {
    if (filterType !== 'all' && item.type !== filterType) return false;
    if (showCustomOnly && !item.isCustom) return false;
    return true;
  });

  // アイテム削除
  const handleDelete = useCallback((item: ClothingItemData) => {
    if (!item.isCustom) {
      alert('デフォルトアイテムは削除できません');
      return;
    }
    
    if (confirm(`「${item.name}」を削除しますか？`)) {
      deleteCustomItem(item.id);
      // 全アイテムリストを更新（カスタム以外も含む）
      const newItems = items.filter(i => i.id !== item.id);
      onItemsChange(newItems);
    }
  }, [items, onItemsChange]);

  // カスタムアイテム数
  const customCount = items.filter(i => i.isCustom).length;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={styles.title}>📋 アイテムかんり</h2>

        {/* 統計 */}
        <div style={styles.stats}>
          <span>ぜんぶ: {items.length}こ</span>
          <span>カスタム: {customCount}こ</span>
        </div>

        {/* フィルター */}
        <div style={styles.filterSection}>
          <select 
            value={filterType} 
            onChange={e => setFilterType(e.target.value as ClothingType | 'all')}
            style={styles.select}
          >
            <option value="all">すべて</option>
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {TYPE_EMOJIS[type as ClothingType]} {label}
              </option>
            ))}
          </select>

          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={showCustomOnly}
              onChange={e => setShowCustomOnly(e.target.checked)}
            />
            カスタムのみ
          </label>
        </div>

        {/* アイテム一覧 */}
        <div style={styles.itemList}>
          {filteredItems.length === 0 ? (
            <div style={styles.emptyMessage}>
              アイテムがありません
            </div>
          ) : (
            filteredItems.map(item => (
              <div key={item.id} style={styles.itemCard}>
                <div style={styles.itemImage}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} style={styles.itemImg} />
                  ) : (
                    <span style={styles.itemEmoji}>
                      {TYPE_EMOJIS[item.type]}
                    </span>
                  )}
                </div>
                <div style={styles.itemInfo}>
                  <div style={styles.itemName}>{item.name}</div>
                  <div style={styles.itemType}>
                    {TYPE_EMOJIS[item.type]} {TYPE_LABELS[item.type]}
                    {item.isCustom && <span style={styles.customBadge}>カスタム</span>}
                  </div>
                  {item.tags && item.tags.length > 0 && (
                    <div style={styles.itemTags}>
                      {item.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} style={styles.tag}>#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                {item.isCustom && (
                  <button
                    style={styles.deleteButton}
                    onClick={() => handleDelete(item)}
                    title="削除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* ボタン */}
        <div style={styles.buttonArea}>
          <button style={styles.addButton} onClick={onAddItem}>
            ➕ あたらしいアイテムをついか
          </button>
          <button style={styles.closeButton} onClick={onClose}>
            ❌ とじる
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
  },
  title: {
    textAlign: 'center',
    margin: '0 0 16px 0',
    fontSize: '20px',
    color: '#333',
  },
  stats: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    marginBottom: '16px',
    fontSize: '14px',
    color: '#666',
  },
  filterSection: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    alignItems: 'center',
  },
  select: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  itemList: {
    flex: 1,
    overflow: 'auto',
    minHeight: '200px',
    maxHeight: '400px',
    border: '1px solid #e0e0e0',
    borderRadius: '12px',
    padding: '8px',
  },
  emptyMessage: {
    textAlign: 'center',
    color: '#999',
    padding: '40px',
  },
  itemCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: '#f8f9fa',
    marginBottom: '8px',
  },
  itemImage: {
    width: '50px',
    height: '50px',
    borderRadius: '8px',
    backgroundColor: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    border: '1px solid #e0e0e0',
  },
  itemImg: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  itemEmoji: {
    fontSize: '24px',
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontWeight: 'bold',
    fontSize: '14px',
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemType: {
    fontSize: '12px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  customBadge: {
    backgroundColor: '#e3f2fd',
    color: '#1976d2',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
  },
  itemTags: {
    marginTop: '4px',
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  tag: {
    fontSize: '10px',
    color: '#888',
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '8px',
    transition: 'background-color 0.2s',
  },
  buttonArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '16px',
  },
  addButton: {
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#2196f3',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
  },
  closeButton: {
    padding: '10px 24px',
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#f0f0f0',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
  },
};
