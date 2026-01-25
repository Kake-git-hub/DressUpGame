/**
 * SettingsPanel コンポーネント
 * シンプル版：フォルダ取込、ZIP取込、全削除の3ボタンのみ
 */
import { useState, useRef, type CSSProperties } from 'react';
import type { ClothingItemData, DollData, BackgroundData } from '../types';
import {
  importPresetFromFolder,
  importPresetFromZip,
  restoreDollImages,
  restoreBackgroundImages,
  restoreClothingImages,
  clearAllCustomData,
  type ImportProgress,
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
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const presetFolderInputRef = useRef<HTMLInputElement>(null);
  const presetZipInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // プリセットフォルダ取り込み（全データ上書き）
  const handlePresetFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsImporting(true);
    setImportProgress({ phase: 'parsing', current: 0, total: 1, message: '準備中...' });
    try {
      console.log('=== フォルダ取り込み開始 ===');
      console.log(`選択ファイル数: ${files.length}`);
      
      const result = await importPresetFromFolder(files, (progress) => {
        setImportProgress(progress);
      });
      
      // 状態を全置換（デフォルト + 新規取り込み分）
      const newDolls = result.presets.items.map(p => p.doll);
      const newClothing = result.presets.items.flatMap(p => p.clothingItems);
      const defaultDolls = dolls.filter(d => !d.isCustom);
      const defaultClothing = clothingItems.filter(i => !i.isCustom);
      const defaultBackgrounds = backgrounds.filter(b => !b.isCustom);

      // 画像URLをIndexedDBから確実に復元（空の場合に備える）
      const restoredDolls = await restoreDollImages(newDolls);
      const restoredClothing = await restoreClothingImages(newClothing);
      const restoredBackgrounds = await restoreBackgroundImages(result.backgrounds.items);
      
      onDollsChange([...defaultDolls, ...restoredDolls]);
      onClothingChange([...defaultClothing, ...restoredClothing]);
      onBackgroundsChange([...defaultBackgrounds, ...restoredBackgrounds]);
      
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
      setImportProgress(null);
      if (presetFolderInputRef.current) presetFolderInputRef.current.value = '';
    }
  };

  // プリセットZIP取り込み（共通処理）
  const processZipImport = async (file: File | Blob, sourceName: string) => {
    setIsImporting(true);
    setImportProgress({ phase: 'parsing', current: 0, total: 1, message: '準備中...' });
    try {
      const result = await importPresetFromZip(file, (progress) => {
        setImportProgress(progress);
      });
      
      // 状態を全て上書き（デフォルト + 新規インポート）
      if (result.presets.items.length > 0) {
        const newDolls = result.presets.items.map(p => p.doll);
        const newClothing = result.presets.items.flatMap(p => p.clothingItems);
        const defaultDolls = dolls.filter(d => !d.isCustom);
        const defaultClothing = clothingItems.filter(c => !c.isCustom);

        const restoredDolls = await restoreDollImages(newDolls);
        const restoredClothing = await restoreClothingImages(newClothing);
        onDollsChange([...defaultDolls, ...restoredDolls]);
        onClothingChange([...defaultClothing, ...restoredClothing]);
      }
      if (result.backgrounds.items.length > 0) {
        const defaultBackgrounds = backgrounds.filter(b => !b.isCustom);
        const restoredBackgrounds = await restoreBackgroundImages(result.backgrounds.items);
        onBackgroundsChange([...defaultBackgrounds, ...restoredBackgrounds]);
      }
      
      const presetCount = result.presets.success;
      const bgCount = result.backgrounds.success;
      const clothingCount = result.presets.items.reduce((sum, p) => sum + p.clothingItems.length, 0);
      
      alert(
        `${sourceName}取り込み完了！\n` +
        `ドール: ${presetCount}体\n` +
        `背景: ${bgCount}枚\n` +
        `服: ${clothingCount}着`
      );
    } catch (error) {
      console.error('ZIP取り込みエラー:', error);
      throw error;
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  // プリセットZIP取り込み（ファイル選択）
  const handlePresetZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      await processZipImport(file, 'ZIP');
    } catch {
      alert('ZIPの取り込みに失敗しました');
    } finally {
      if (presetZipInputRef.current) presetZipInputRef.current.value = '';
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
  const customClothing = clothingItems.filter(i => !i.isCustom);
  const hasCustomData = customDolls.length > 0 || customBackgrounds.length > 0 || customClothing.length > 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>⚙️ せってい</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.content}>
          {/* フォルダ取り込みボタン */}
          <label style={{
            ...styles.bigButton,
            ...styles.folderButton,
            ...(isImporting ? styles.buttonDisabled : {}),
          }}>
            📂 フォルダを取り込む
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

          {/* ZIP取り込みボタン */}
          <label style={{
            ...styles.bigButton,
            ...styles.zipButton,
            ...(isImporting ? styles.buttonDisabled : {}),
          }}>
            🗜️ ZIPファイルを取り込む
            <input
              ref={presetZipInputRef}
              type="file"
              accept=".zip"
              onChange={handlePresetZipImport}
              style={{ display: 'none' }}
              disabled={isImporting}
            />
          </label>

          {/* 全データ削除ボタン */}
          {hasCustomData && (
            <button 
              style={{
                ...styles.bigButton,
                ...styles.deleteButton,
                ...(isImporting ? styles.buttonDisabled : {}),
              }}
              onClick={handleClearAll}
              disabled={isImporting}
            >
              🗑️ すべてのデータを削除
            </button>
          )}

          {/* 取り込み中の進捗表示 */}
          {isImporting && importProgress && (
            <div style={styles.progressContainer}>
              <p style={styles.importingText}>📥 {importProgress.message}</p>
              <div style={styles.progressBar}>
                <div 
                  style={{
                    ...styles.progressFill,
                    width: importProgress.total > 0 
                      ? `${Math.round((importProgress.current / importProgress.total) * 100)}%` 
                      : '0%'
                  }} 
                />
              </div>
              <p style={styles.progressDetail}>
                {importProgress.current} / {importProgress.total}
              </p>
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
    maxWidth: '400px',
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
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  bigButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'white',
    borderRadius: '12px',
    cursor: 'pointer',
    textAlign: 'center',
    border: 'none',
  },
  folderButton: {
    background: 'linear-gradient(135deg, #ff69b4 0%, #9370db 100%)',
  },
  zipButton: {
    background: 'linear-gradient(135deg, #28a745 0%, #218838 100%)',
  },
  deleteButton: {
    background: 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)',
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed',
  },
  progressContainer: {
    marginTop: '8px',
    padding: '12px',
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#bbdefb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '8px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2196f3',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  importingText: {
    fontSize: '14px',
    color: '#1565c0',
    textAlign: 'center',
    fontWeight: 'bold',
    margin: 0,
  },
  progressDetail: {
    fontSize: '11px',
    color: '#1565c0',
    textAlign: 'center' as const,
    marginTop: '4px',
  },
};
