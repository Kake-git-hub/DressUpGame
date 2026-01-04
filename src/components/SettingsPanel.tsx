/**
 * SettingsPanel コンポーネント
 * iPadから背景・ドール・服の素材を追加・削除できる設定画面
 */
import { useState, useRef, type CSSProperties } from 'react';
import type { ClothingItemData, DollData, BackgroundData, ClothingType } from '../types';
import { CLOTHING_CATEGORIES } from '../types';
import {
  addCustomDoll,
  addCustomBackground,
  addCustomClothing,
  deleteCustomDoll,
  deleteCustomBackground,
  deleteCustomClothing,
  bulkImportFromZip,
  bulkImportFromFolder,
  bulkImportFromHierarchicalFolder,
} from '../services/assetStorage';

type TabType = 'dolls' | 'backgrounds' | 'clothing';

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
  const [activeTab, setActiveTab] = useState<TabType>('dolls');
  const [newItemName, setNewItemName] = useState('');
  const [selectedType, setSelectedType] = useState<ClothingType>('top');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const hierarchicalFolderInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // ファイル選択時
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 追加ボタン押下時
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

  // ZIP一括取り込み
  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const result = await bulkImportFromZip(
        file,
        activeTab,
        activeTab === 'clothing' ? selectedType : undefined
      );
      
      // 状態を更新
      if (activeTab === 'dolls') {
        onDollsChange([...dolls, ...(result.items as DollData[])]);
      } else if (activeTab === 'backgrounds') {
        onBackgroundsChange([...backgrounds, ...(result.items as BackgroundData[])]);
      } else {
        onClothingChange([...clothingItems, ...(result.items as ClothingItemData[])]);
      }
      
      alert(`取り込み完了！\n成功: ${result.success}件\n失敗: ${result.failed}件`);
    } catch (error) {
      console.error('ZIP取り込みエラー:', error);
      alert('ZIPの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  // フォルダ一括取り込み
  const handleFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    try {
      const result = await bulkImportFromFolder(
        files,
        activeTab,
        activeTab === 'clothing' ? selectedType : undefined
      );
      
      // 状態を更新
      if (activeTab === 'dolls') {
        onDollsChange([...dolls, ...(result.items as DollData[])]);
      } else if (activeTab === 'backgrounds') {
        onBackgroundsChange([...backgrounds, ...(result.items as BackgroundData[])]);
      } else {
        onClothingChange([...clothingItems, ...(result.items as ClothingItemData[])]);
      }
      
      alert(`取り込み完了！\n成功: ${result.success}件\n失敗: ${result.failed}件`);
    } catch (error) {
      console.error('フォルダ取り込みエラー:', error);
      alert('フォルダの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // 階層フォルダ一括取り込み（プリセット形式）
  const handleHierarchicalFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    try {
      const result = await bulkImportFromHierarchicalFolder(files);
      
      // 状態を更新
      if (result.dolls.items.length > 0) {
        onDollsChange([...dolls, ...result.dolls.items]);
      }
      if (result.backgrounds.items.length > 0) {
        onBackgroundsChange([...backgrounds, ...result.backgrounds.items]);
      }
      if (result.clothing.items.length > 0) {
        onClothingChange([...clothingItems, ...result.clothing.items]);
      }
      
      const totalSuccess = result.dolls.success + result.backgrounds.success + result.clothing.success;
      const totalFailed = result.dolls.failed + result.backgrounds.failed + result.clothing.failed;
      
      alert(
        `プリセット取り込み完了！\n` +
        `ドール: ${result.dolls.success}件\n` +
        `背景: ${result.backgrounds.success}件\n` +
        `服: ${result.clothing.success}件\n` +
        `---\n` +
        `合計: ${totalSuccess}件成功, ${totalFailed}件失敗`
      );
    } catch (error) {
      console.error('階層フォルダ取り込みエラー:', error);
      alert('プリセットフォルダの取り込みに失敗しました');
    } finally {
      setIsImporting(false);
      if (hierarchicalFolderInputRef.current) hierarchicalFolderInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string, type: TabType) => {
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

        {/* 追加フォーム */}
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
              ...(isAdding || !selectedFile || !newItemName.trim() ? styles.addButtonDisabled : {}),
            }}
            onClick={handleAdd}
            disabled={isAdding || !selectedFile || !newItemName.trim()}
          >
            {isAdding ? '追加中...' : '➕ 追加'}
          </button>
        </div>

        {/* 一括取り込みセクション */}
        <div style={styles.bulkImportSection}>
          <p style={styles.bulkTitle}>📦 一括取り込み（現在のタブ用）</p>
          {activeTab === 'clothing' && (
            <p style={styles.bulkNote}>
              ※「{CLOTHING_CATEGORIES.find(c => c.type === selectedType)?.label}」として取り込みます
            </p>
          )}
          <div style={styles.bulkButtons}>
            <label style={{
              ...styles.bulkButton,
              ...(isImporting ? styles.addButtonDisabled : {}),
            }}>
              📁 ZIPファイル
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                onChange={handleZipImport}
                style={{ display: 'none' }}
                disabled={isImporting}
              />
            </label>
            <label style={{
              ...styles.bulkButton,
              ...(isImporting ? styles.addButtonDisabled : {}),
            }}>
              📂 フォルダ
              <input
                ref={folderInputRef}
                type="file"
                /* @ts-expect-error webkitdirectory is not standard */
                webkitdirectory=""
                multiple
                onChange={handleFolderImport}
                style={{ display: 'none' }}
                disabled={isImporting}
              />
            </label>
          </div>
        </div>

        {/* プリセット取り込みセクション */}
        <div style={styles.presetImportSection}>
          <p style={styles.bulkTitle}>📦 プリセット取り込み（全カテゴリ）</p>
          <p style={styles.bulkNote}>
            フォルダ構造: dolls/, backgrounds/, clothing/top/ など
          </p>
          <label style={{
            ...styles.presetButton,
            ...(isImporting ? styles.addButtonDisabled : {}),
          }}>
            🗂️ プリセットフォルダを選択
            <input
              ref={hierarchicalFolderInputRef}
              type="file"
              /* @ts-expect-error webkitdirectory is not standard */
              webkitdirectory=""
              multiple
              onChange={handleHierarchicalFolderImport}
              style={{ display: 'none' }}
              disabled={isImporting}
            />
          </label>
          {isImporting && <p style={styles.importingText}>取り込み中...</p>}
        </div>

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
                customClothing.map(item => (
                  <div key={item.id} style={styles.listItem}>
                    <img src={item.imageUrl} alt={item.name} style={styles.thumbnail} />
                    <span style={styles.itemName}>
                      {item.name}
                      <span style={styles.itemType}>
                        ({CLOTHING_CATEGORIES.find(c => c.type === item.type)?.label})
                      </span>
                    </span>
                    <button
                      style={styles.deleteButton}
                      onClick={() => handleDelete(item.id, 'clothing')}
                    >
                      🗑️
                    </button>
                  </div>
                ))
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
    padding: '12px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#666',
  },
  tabActive: {
    color: '#ff69b4',
    borderBottom: '2px solid #ff69b4',
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
    minWidth: '120px',
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
    minWidth: '130px',
  },
  fileButton: {
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
    maxWidth: '140px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  addButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  addButtonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed',
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
    fontSize: '12px',
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
  bulkImportSection: {
    padding: '12px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f8f9fa',
  },
  bulkTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#555',
  },
  bulkNote: {
    margin: '0 0 8px 0',
    fontSize: '12px',
    color: '#888',
  },
  bulkButtons: {
    display: 'flex',
    gap: '8px',
  },
  bulkButton: {
    flex: 1,
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #28a745 0%, #218838 100%)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
  },
  presetImportSection: {
    padding: '12px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#fff3cd',
  },
  presetButton: {
    display: 'block',
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    background: 'linear-gradient(135deg, #fd7e14 0%, #e65c00 100%)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
  },
  importingText: {
    marginTop: '8px',
    fontSize: '13px',
    color: '#28a745',
    textAlign: 'center',
  },
};
