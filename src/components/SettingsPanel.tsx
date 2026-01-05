/**
 * SettingsPanel コンポーネント
 * プリセット取り込み（ZIP/フォルダ）のみ対応
 * Version 0.3.0 - 個別追加機能を削除
 */
import { useState, useRef, type CSSProperties } from 'react';
import type { ClothingItemData, DollData, BackgroundData } from '../types';
import { getCategoryInfo } from '../types';
import {
  deleteCustomDoll,
  deleteCustomBackground,
  deleteCustomClothing,
  importPresetFromFolder,
  importPresetFromZip,
  clearAllCustomData,
} from '../services/assetStorage';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  dolls: DollData[];
  backgrounds: BackgroundData[];
  clothingItems: ClothingItemData[];
  onDollsChange: (dolls: DollData[]) => void;
  onBackgroundsChange: (backgrounds: BackgroundData[]) => void;
  onClothingChange: (items: ClothingItemData[]) => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  dolls,
  backgrounds,
  clothingItems,
  onDollsChange,
  onBackgroundsChange,
  onClothingChange,
}: SettingsPanelProps) {
  const [isImporting, setIsImporting] = useState(false);
  const presetFolderInputRef = useRef<HTMLInputElement>(null);
  const presetZipInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // プリセットフォルダ取り込み（全データ上書き）
  const handlePresetFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    try {
      console.log('=== フォルダ取り込み開始 ===');
      console.log(`選択ファイル数: ${files.length}`);
      
      const result = await importPresetFromFolder(files);
      
      // 状態を全置換（デフォルト + 新規取り込み分）
      const newDolls = result.presets.items.map(p => p.doll);
      const newClothing = result.presets.items.flatMap(p => p.clothingItems);
      const defaultDolls = dolls.filter(d => !d.isCustom);
      const defaultClothing = clothingItems.filter(i => !i.isCustom);
      const defaultBackgrounds = backgrounds.filter(b => !b.isCustom);
      
      onDollsChange([...defaultDolls, ...newDolls]);
      onClothingChange([...defaultClothing, ...newClothing]);
      onBackgroundsChange([...defaultBackgrounds, ...result.backgrounds.items]);
      
      const presetCount = result.presets.success;
      const bgCount = result.backgrounds.success;
      const clothingCount = result.presets.items.reduce((sum, p) => sum + p.clothingItems.length, 0);
      
      if (presetCount === 0 && bgCount === 0) {
        alert('取り込めるプリセットが見つかりませんでした。\nフォルダ構造を確認してください。');
      } else {
        alert(
          `プリセット取り込み完了！\n` +
          `ドール: ${presetCount}体\n` +
          `背景: ${bgCount}枚\n` +
          `服: ${clothingCount}着`
        );
      }
    } catch (error) {
      console.error('プリセット取り込みエラー:', error);
      alert('プリセットの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (presetFolderInputRef.current) presetFolderInputRef.current.value = '';
    }
  };

  // プリセットZIP取り込み
  const handlePresetZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const result = await importPresetFromZip(file);
      
      // 状態を全て上書き（デフォルト + 新規インポート）
      if (result.presets.items.length > 0) {
        const newDolls = result.presets.items.map(p => p.doll);
        const newClothing = result.presets.items.flatMap(p => p.clothingItems);
        const defaultDolls = dolls.filter(d => !d.isCustom);
        const defaultClothing = clothingItems.filter(c => !c.isCustom);
        onDollsChange([...defaultDolls, ...newDolls]);
        onClothingChange([...defaultClothing, ...newClothing]);
      }
      if (result.backgrounds.items.length > 0) {
        const defaultBackgrounds = backgrounds.filter(b => !b.isCustom);
        onBackgroundsChange([...defaultBackgrounds, ...result.backgrounds.items]);
      }
      
      const presetCount = result.presets.success;
      const bgCount = result.backgrounds.success;
      const clothingCount = result.presets.items.reduce((sum, p) => sum + p.clothingItems.length, 0);
      
      alert(
        `ZIP取り込み完了！\n` +
        `ドール: ${presetCount}体\n` +
        `背景: ${bgCount}枚\n` +
        `服: ${clothingCount}着`
      );
    } catch (error) {
      console.error('ZIP取り込みエラー:', error);
      alert('ZIPの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (presetZipInputRef.current) presetZipInputRef.current.value = '';
    }
  };

  // ドールとその服を削除
  const handleDeleteDoll = async (id: string) => {
    const doll = dolls.find(d => d.id === id);
    const dollClothingCount = clothingItems.filter(c => c.dollId === id).length;
    
    if (!confirm(`「${doll?.name}」とその服(${dollClothingCount}着)を削除しますか？`)) return;

    try {
      await deleteCustomDoll(id);
      // このドールに紐付いた服も削除
      const dollClothing = clothingItems.filter(c => c.dollId === id);
      for (const item of dollClothing) {
        await deleteCustomClothing(item.id);
      }
      onDollsChange(dolls.filter(d => d.id !== id));
      onClothingChange(clothingItems.filter(c => c.dollId !== id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // 背景を削除
  const handleDeleteBackground = async (id: string) => {
    if (!confirm('この背景を削除しますか？')) return;

    try {
      await deleteCustomBackground(id);
      onBackgroundsChange(backgrounds.filter(b => b.id !== id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // 全データクリア
  const handleClearAll = async () => {
    if (!confirm('すべてのカスタムデータを削除しますか？\nこの操作は取り消せません。')) return;
    if (!confirm('本当に削除してよろしいですか？')) return;

    try {
      await clearAllCustomData();
      onDollsChange(dolls.filter(d => !d.isCustom));
      onBackgroundsChange(backgrounds.filter(b => !b.isCustom));
      onClothingChange(clothingItems.filter(i => !i.isCustom));
      alert('すべてのカスタムデータを削除しました');
    } catch (error) {
      console.error('クリアエラー:', error);
      alert('データの削除に失敗しました');
    }
  };

  const customDolls = dolls.filter(d => d.isCustom);
  const customBackgrounds = backgrounds.filter(b => b.isCustom);
  const customClothing = clothingItems.filter(i => i.isCustom);
  const usedCategories = [...new Set(customClothing.map(c => c.type))];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>⚙️ せってい</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.content}>
          {/* プリセット取り込み */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>📁 プリセット取り込み</h3>
            <p style={styles.helpText}>
              フォルダ構造:<br/>
              <code style={styles.code}>
                preset/<br/>
                ├── backgrounds/  ← 背景<br/>
                └── doll-xxx/     ← ドール名<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;├── dolls/      ← ドール画像<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;└── clothing/   ← 服<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── top/<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── {'{カテゴリ}'}/
              </code>
            </p>
            
            <div style={styles.importButtons}>
              <label style={{
                ...styles.importButton,
                ...(isImporting ? styles.buttonDisabled : {}),
              }}>
                📂 フォルダを選択
                <input
                  ref={presetFolderInputRef}
                  type="file"
                  /* @ts-expect-error webkitdirectory is not standard */
                  webkitdirectory=""
                  multiple
                  onChange={handlePresetFolderImport}
                  style={{ display: 'none' }}
                  disabled={isImporting}
                />
              </label>
              
              <label style={{
                ...styles.importButton,
                ...styles.importButtonZip,
                ...(isImporting ? styles.buttonDisabled : {}),
              }}>
                🗜️ ZIPファイル
                <input
                  ref={presetZipInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handlePresetZipImport}
                  style={{ display: 'none' }}
                  disabled={isImporting}
                />
              </label>
            </div>
            
            {isImporting && <p style={styles.importingText}>📥 取り込み中...</p>}
          </div>

          {/* 現在の素材 */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>📊 取り込み済み素材</h3>
            <div style={styles.stats}>
              <div style={styles.statItem}>
                <span style={styles.statEmoji}>👤</span>
                <span style={styles.statLabel}>ドール</span>
                <span style={styles.statValue}>{customDolls.length}</span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statEmoji}>🖼️</span>
                <span style={styles.statLabel}>背景</span>
                <span style={styles.statValue}>{customBackgrounds.length}</span>
              </div>
              <div style={styles.statItem}>
                <span style={styles.statEmoji}>👚</span>
                <span style={styles.statLabel}>服</span>
                <span style={styles.statValue}>{customClothing.length}</span>
              </div>
            </div>
            {usedCategories.length > 0 && (
              <div style={styles.categoryList}>
                <span style={styles.categoryLabel}>服カテゴリ: </span>
                {usedCategories.map(cat => {
                  const info = getCategoryInfo(cat);
                  return (
                    <span key={cat} style={styles.categoryTag}>
                      {info.emoji} {info.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* ドール一覧 */}
          {customDolls.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>👤 ドール一覧</h3>
              <div style={styles.itemList}>
                {customDolls.map(doll => {
                  const dollClothingCount = customClothing.filter(c => c.dollId === doll.id).length;
                  return (
                    <div key={doll.id} style={styles.listItem}>
                      <img src={doll.bodyImageUrl} alt={doll.name} style={styles.thumbnail} />
                      <div style={styles.itemInfo}>
                        <span style={styles.itemName}>{doll.name}</span>
                        <span style={styles.itemMeta}>服: {dollClothingCount}着</span>
                      </div>
                      <button
                        style={styles.deleteButton}
                        onClick={() => handleDeleteDoll(doll.id)}
                        title="ドールと関連する服を削除"
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 背景一覧 */}
          {customBackgrounds.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>🖼️ 背景一覧</h3>
              <div style={styles.itemList}>
                {customBackgrounds.map(bg => (
                  <div key={bg.id} style={styles.listItem}>
                    <img src={bg.imageUrl} alt={bg.name} style={styles.thumbnailBg} />
                    <div style={styles.itemInfo}>
                      <span style={styles.itemName}>{bg.name}</span>
                    </div>
                    <button
                      style={styles.deleteButton}
                      onClick={() => handleDeleteBackground(bg.id)}
                      title="背景を削除"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* データクリア */}
          {(customDolls.length > 0 || customBackgrounds.length > 0) && (
            <div style={styles.section}>
              <button style={styles.clearButton} onClick={handleClearAll}>
                🗑️ すべてのカスタムデータを削除
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
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
    zIndex: 2000,
  },
  panel: {
    backgroundColor: 'white',
    borderRadius: '16px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid #eee',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px',
  },
  section: {
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '12px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#333',
    fontWeight: 'bold',
  },
  helpText: {
    margin: '0 0 12px 0',
    fontSize: '11px',
    color: '#666',
    lineHeight: 1.4,
  },
  code: {
    display: 'block',
    backgroundColor: '#e9ecef',
    padding: '8px',
    borderRadius: '6px',
    fontFamily: 'monospace',
    fontSize: '10px',
    marginTop: '4px',
  },
  importButtons: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  importButton: {
    flex: 1,
    padding: '12px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    minWidth: '120px',
  },
  importButtonZip: {
    background: 'linear-gradient(135deg, #28a745 0%, #218838 100%)',
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed',
  },
  importingText: {
    marginTop: '12px',
    fontSize: '14px',
    color: '#ff69b4',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  stats: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: '8px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'white',
    padding: '8px 12px',
    borderRadius: '8px',
    minWidth: '70px',
  },
  statEmoji: {
    fontSize: '20px',
  },
  statLabel: {
    fontSize: '10px',
    color: '#666',
  },
  statValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  categoryList: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #ddd',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '4px',
  },
  categoryLabel: {
    fontSize: '11px',
    color: '#666',
  },
  categoryTag: {
    fontSize: '10px',
    backgroundColor: '#e3f2fd',
    padding: '2px 8px',
    borderRadius: '10px',
    color: '#1976d2',
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  thumbnail: {
    width: '40px',
    height: '60px',
    objectFit: 'contain',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
  },
  thumbnailBg: {
    width: '60px',
    height: '40px',
    objectFit: 'cover',
    borderRadius: '4px',
  },
  itemInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  itemName: {
    fontSize: '13px',
    color: '#333',
    fontWeight: 'bold',
  },
  itemMeta: {
    fontSize: '11px',
    color: '#888',
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px',
    opacity: 0.6,
    transition: 'opacity 0.2s',
  },
  clearButton: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    opacity: 0.8,
  },
};
