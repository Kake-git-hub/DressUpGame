/**
 * SettingsPanel コンポーネント
 * プリセット取り込み（ZIP/フォルダ）と素材管理
 * 一括取り込みは廃止、プリセット取り込みのみ対応
 */
import { useState, useRef, type CSSProperties } from 'react';
import type { ClothingItemData, DollData, BackgroundData, ClothingType } from '../types';
import { CLOTHING_CATEGORIES, getCategoryInfo } from '../types';
import {
  addCustomDoll,
  addCustomBackground,
  addCustomClothing,
  deleteCustomDoll,
  deleteCustomBackground,
  deleteCustomClothing,
  importPresetFromFolder,
  importPresetFromZip,
} from '../services/assetStorage';

type TabType = 'preset' | 'dolls' | 'backgrounds' | 'clothing';

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
  const [activeTab, setActiveTab] = useState<TabType>('preset');
  const [newItemName, setNewItemName] = useState('');
  const [selectedType, setSelectedType] = useState<ClothingType>('top');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetFolderInputRef = useRef<HTMLInputElement>(null);
  const presetZipInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ファイル選択時
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 追加ボタン押下時（個別追加用）
  const handleAdd = async () => {
    if (!selectedFile) {
      alert('画像をえらんでね');
      return;
    }
    if (!newItemName.trim()) {
      alert('名前を入力してね');
      return;
    }

    setIsAdding(true);
    try {
      switch (activeTab) {
        case 'dolls': {
          const newDoll = await addCustomDoll(newItemName, selectedFile);
          onDollsChange([...dolls, newDoll]);
          break;
        }
        case 'backgrounds': {
          const newBg = await addCustomBackground(newItemName, selectedFile);
          onBackgroundsChange([...backgrounds, newBg]);
          break;
        }
        case 'clothing': {
          const newItem = await addCustomClothing(newItemName, selectedType, selectedFile);
          onClothingChange([...clothingItems, newItem]);
          break;
        }
      }
      setNewItemName('');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      alert('追加しました！');
    } catch (error) {
      console.error('追加エラー:', error);
      alert('追加に失敗しました');
    } finally {
      setIsAdding(false);
    }
  };

  // プリセットフォルダ取り込み（新形式: doll-{id}/clothing/{category}/）
  const handlePresetFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    try {
      const result = await importPresetFromFolder(files);
      
      // 状態を更新
      if (result.presets.items.length > 0) {
        const newDolls = result.presets.items.map(p => p.doll);
        const newClothing = result.presets.items.flatMap(p => p.clothingItems);
        onDollsChange([...dolls, ...newDolls]);
        onClothingChange([...clothingItems, ...newClothing]);
      }
      if (result.backgrounds.items.length > 0) {
        onBackgroundsChange([...backgrounds, ...result.backgrounds.items]);
      }
      
      const presetCount = result.presets.success;
      const bgCount = result.backgrounds.success;
      const clothingCount = result.presets.items.reduce((sum, p) => sum + p.clothingItems.length, 0);
      
      alert(
        `プリセット取り込み完了！\n` +
        `ドール: ${presetCount}体\n` +
        `背景: ${bgCount}枚\n` +
        `服: ${clothingCount}着\n` +
        (result.presets.failed > 0 ? `\n失敗: ${result.presets.failed}件` : '')
      );
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
      
      // 状態を更新
      if (result.presets.items.length > 0) {
        const newDolls = result.presets.items.map(p => p.doll);
        const newClothing = result.presets.items.flatMap(p => p.clothingItems);
        onDollsChange([...dolls, ...newDolls]);
        onClothingChange([...clothingItems, ...newClothing]);
      }
      if (result.backgrounds.items.length > 0) {
        onBackgroundsChange([...backgrounds, ...result.backgrounds.items]);
      }
      
      const presetCount = result.presets.success;
      const bgCount = result.backgrounds.success;
      const clothingCount = result.presets.items.reduce((sum, p) => sum + p.clothingItems.length, 0);
      
      alert(
        `ZIP取り込み完了！\n` +
        `ドール: ${presetCount}体\n` +
        `背景: ${bgCount}枚\n` +
        `服: ${clothingCount}着\n` +
        (result.presets.failed > 0 ? `\n失敗: ${result.presets.failed}件` : '')
      );
    } catch (error) {
      console.error('ZIP取り込みエラー:', error);
      alert('ZIPの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (presetZipInputRef.current) presetZipInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string, type: 'dolls' | 'backgrounds' | 'clothing') => {
    if (!confirm('削除しますか？')) return;

    try {
      switch (type) {
        case 'dolls':
          await deleteCustomDoll(id);
          onDollsChange(dolls.filter(d => d.id !== id));
          break;
        case 'backgrounds':
          await deleteCustomBackground(id);
          onBackgroundsChange(backgrounds.filter(b => b.id !== id));
          break;
        case 'clothing':
          await deleteCustomClothing(id);
          onClothingChange(clothingItems.filter(i => i.id !== id));
          break;
      }
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  const customDolls = dolls.filter(d => d.isCustom);
  const customBackgrounds = backgrounds.filter(b => b.isCustom);
  const customClothing = clothingItems.filter(i => i.isCustom);

  // 動的カテゴリ（使用中のカテゴリを抽出）
  const usedCategories = [...new Set(customClothing.map(c => c.type))];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>⚙️ せってい</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        {/* タブ */}
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'preset' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('preset')}
          >
            📦 プリセット
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'dolls' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('dolls')}
          >
            👤 ドール
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'backgrounds' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('backgrounds')}
          >
            🖼️ はいけい
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'clothing' ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab('clothing')}
          >
            👚 ふく
          </button>
        </div>

        {/* プリセット取り込みタブ */}
        {activeTab === 'preset' && (
          <div style={styles.presetContent}>
            <div style={styles.presetSection}>
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
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── bottom/<br/>
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
            
            <div style={styles.statsSection}>
              <h3 style={styles.sectionTitle}>📊 現在の素材</h3>
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
          </div>
        )}

        {/* 個別追加フォーム（ドール/背景/服タブ共通） */}
        {activeTab !== 'preset' && (
          <div style={styles.addForm}>
            <input
              type="text"
              placeholder="なまえ"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              style={styles.nameInput}
            />
            
            {activeTab === 'clothing' && (
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value as ClothingType)}
                style={styles.typeSelect}
              >
                {CLOTHING_CATEGORIES.map(cat => (
                  <option key={cat.type} value={cat.type}>
                    {cat.emoji} {cat.label}
                  </option>
                ))}
              </select>
            )}
            
            <label style={styles.fileButton}>
              📁 {selectedFile ? selectedFile.name.slice(0, 10) + '...' : '画像をえらぶ'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                disabled={isAdding}
              />
            </label>
            
            <button
              style={{
                ...styles.addButton,
                ...(isAdding || !selectedFile || !newItemName.trim() ? styles.buttonDisabled : {}),
              }}
              onClick={handleAdd}
              disabled={isAdding || !selectedFile || !newItemName.trim()}
            >
              {isAdding ? '追加中...' : '➕ 追加'}
            </button>
          </div>
        )}

        {/* アイテム一覧 */}
        <div style={styles.itemList}>
          {activeTab === 'dolls' && (
            <>
              <p style={styles.listTitle}>追加したドール ({customDolls.length})</p>
              {customDolls.length === 0 ? (
                <p style={styles.emptyText}>まだ追加していません</p>
              ) : (
                customDolls.map(doll => (
                  <div key={doll.id} style={styles.listItem}>
                    <img src={doll.bodyImageUrl} alt={doll.name} style={styles.thumbnail} />
                    <span style={styles.itemName}>{doll.name}</span>
                    <button
                      style={styles.deleteButton}
                      onClick={() => handleDelete(doll.id, 'dolls')}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'backgrounds' && (
            <>
              <p style={styles.listTitle}>追加したはいけい ({customBackgrounds.length})</p>
              {customBackgrounds.length === 0 ? (
                <p style={styles.emptyText}>まだ追加していません</p>
              ) : (
                customBackgrounds.map(bg => (
                  <div key={bg.id} style={styles.listItem}>
                    <img src={bg.imageUrl} alt={bg.name} style={styles.thumbnailBg} />
                    <span style={styles.itemName}>{bg.name}</span>
                    <button
                      style={styles.deleteButton}
                      onClick={() => handleDelete(bg.id, 'backgrounds')}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'clothing' && (
            <>
              <p style={styles.listTitle}>追加したふく ({customClothing.length})</p>
              {customClothing.length === 0 ? (
                <p style={styles.emptyText}>まだ追加していません</p>
              ) : (
                customClothing.map(item => {
                  const catInfo = getCategoryInfo(item.type);
                  return (
                    <div key={item.id} style={styles.listItem}>
                      <img src={item.imageUrl} alt={item.name} style={styles.thumbnail} />
                      <span style={styles.itemName}>
                        {item.name}
                        <span style={styles.itemType}>
                          ({catInfo.emoji} {catInfo.label})
                        </span>
                      </span>
                      <button
                        style={styles.deleteButton}
                        onClick={() => handleDelete(item.id, 'clothing')}
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })
              )}
            </>
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
    maxHeight: '80vh',
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
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #eee',
  },
  tab: {
    flex: 1,
    padding: '10px 4px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
  },
  tabActive: {
    color: '#ff69b4',
    borderBottom: '2px solid #ff69b4',
  },
  presetContent: {
    padding: '16px',
    borderBottom: '1px solid #eee',
  },
  presetSection: {
    marginBottom: '16px',
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    color: '#333',
  },
  helpText: {
    margin: '0 0 12px 0',
    fontSize: '11px',
    color: '#666',
    lineHeight: 1.4,
  },
  code: {
    display: 'block',
    backgroundColor: '#f5f5f5',
    padding: '8px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '10px',
    marginTop: '4px',
  },
  importButtons: {
    display: 'flex',
    gap: '8px',
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
  statsSection: {
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    padding: '12px',
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
  },
  statEmoji: {
    fontSize: '24px',
  },
  statLabel: {
    fontSize: '10px',
    color: '#666',
  },
  statValue: {
    fontSize: '18px',
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
    backgroundColor: '#e0e0e0',
    padding: '2px 6px',
    borderRadius: '10px',
    color: '#333',
  },
  addForm: {
    padding: '12px',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    borderBottom: '1px solid #eee',
  },
  nameInput: {
    flex: 1,
    minWidth: '100px',
    padding: '10px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
  },
  typeSelect: {
    padding: '10px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    minWidth: '110px',
  },
  fileButton: {
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  addButton: {
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  itemList: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
  },
  listTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
  },
  emptyText: {
    color: '#999',
    fontSize: '13px',
    textAlign: 'center',
    padding: '20px',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    marginBottom: '8px',
  },
  thumbnail: {
    width: '50px',
    height: '50px',
    objectFit: 'contain',
    backgroundColor: '#fff',
    borderRadius: '4px',
  },
  thumbnailBg: {
    width: '60px',
    height: '40px',
    objectFit: 'cover',
    borderRadius: '4px',
  },
  itemName: {
    flex: 1,
    fontSize: '14px',
    color: '#333',
  },
  itemType: {
    fontSize: '11px',
    color: '#999',
    marginLeft: '4px',
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px 8px',
  },
};
