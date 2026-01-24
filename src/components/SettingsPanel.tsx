/**
 * SettingsPanel コンポーネント
 * プリセット取り込み（ZIP/フォルダ）のみ対応
 * Version 0.3.0 - 個別追加機能を削除
 */
import { useState, useRef, useCallback, type CSSProperties } from 'react';
import type { ClothingItemData, DollData, BackgroundData } from '../types';
import { getCategoryInfo } from '../types';
import {
  deleteCustomDoll,
  deleteCustomBackground,
  deleteCustomClothing,
  importPresetFromFolder,
  importPresetFromZip,
  restoreDollImages,
  restoreBackgroundImages,
  restoreClothingImages,
  clearAllCustomData,
  type ImportProgress,
} from '../services/assetStorage';

// 開発者モード用：画像リサイズ設定
const DEV_MAX_CLOTHING_SIZE = 2048; // 服・ドールの最大サイズ
const DEV_MAX_BACKGROUND_SIZE = 512; // 背景の最大サイズ

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

  // プリセットダウンロードURL（Google Drive）
  const PRESET_DOWNLOAD_URL = 'https://drive.google.com/file/d/1XcgEk47b3iDfGRspECLYj_LVTbwrSqWU/view?usp=sharing';
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');

  // 開発者モード（タイトル5回タップで有効化）
  const [devMode, setDevMode] = useState(false);
  const titleTapCountRef = useRef(0);
  const titleTapTimerRef = useRef<number | null>(null);
  const [devProgress, setDevProgress] = useState<string | null>(null);

  // タイトルタップで開発者モード切り替え
  const handleTitleTap = useCallback(() => {
    titleTapCountRef.current += 1;
    if (titleTapCountRef.current >= 5) {
      setDevMode(d => !d);
      titleTapCountRef.current = 0;
    }
    // タイマーリセット
    if (titleTapTimerRef.current) {
      clearTimeout(titleTapTimerRef.current);
    }
    titleTapTimerRef.current = window.setTimeout(() => {
      titleTapCountRef.current = 0;
    }, 2000);
  }, []);

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

  // 公式プリセットをブラウザでダウンロード（別タブで開く）
  const handleOpenDownloadPage = () => {
    window.open(PRESET_DOWNLOAD_URL, '_blank');
  };

  // URLからZIPダウンロード
  const handleUrlDownload = async () => {
    const url = downloadUrl.trim();
    if (!url) {
      alert('URLを入力してください');
      return;
    }
    await downloadFromUrl(url);
  };

  // 共通ダウンロード処理
  const downloadFromUrl = async (url: string) => {
    // URL検証（相対パスも許可）
    const isRelative = url.startsWith('./') || url.startsWith('/');
    if (!isRelative) {
      try {
        new URL(url);
      } catch {
        alert('正しいURLを入力してください');
        return;
      }
    }

    setIsImporting(true);
    setImportProgress({ phase: 'parsing', current: 0, total: 1, message: 'ダウンロード中...' });

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`ダウンロード失敗: ${response.status}`);
      }

      const blob = await response.blob();
      
      // ZIPファイルか確認
      if (!blob.type.includes('zip') && !url.toLowerCase().endsWith('.zip')) {
        // Content-Typeがなくても.zipならOK
        console.warn('Content-Type is not zip, but continuing...');
      }

      await processZipImport(blob, 'ダウンロード');
      setShowUrlInput(false);
      setDownloadUrl('');
    } catch (error) {
      console.error('URLダウンロードエラー:', error);
      alert(`ダウンロードに失敗しました\n${(error as Error).message}`);
      setIsImporting(false);
      setImportProgress(null);
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

  // 開発者モード: フォルダ内の画像を一括リサイズ（上書き保存）
  const handleDevResizeFolder = async () => {
    // File System Access API のサポートチェック
    if (!('showDirectoryPicker' in window)) {
      alert('このブラウザはフォルダ選択に対応していません。\nChrome または Edge を使用してください。');
      return;
    }

    try {
      // フォルダ選択ダイアログ
      // @ts-expect-error showDirectoryPicker is not in types
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
      });

      setDevProgress('フォルダをスキャン中...');

      // 再帰的に画像ファイルを収集
      const imageFiles: Array<{ handle: FileSystemFileHandle; path: string }> = [];
      
      async function scanDirectory(handle: FileSystemDirectoryHandle, path: string) {
        // @ts-expect-error FileSystemDirectoryHandle.values() is not in types
        for await (const entry of handle.values()) {
          if (entry.kind === 'file') {
            const name = entry.name.toLowerCase();
            if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp')) {
              imageFiles.push({ handle: entry as FileSystemFileHandle, path: `${path}/${entry.name}` });
            }
          } else if (entry.kind === 'directory') {
            await scanDirectory(entry as FileSystemDirectoryHandle, `${path}/${entry.name}`);
          }
        }
      }

      await scanDirectory(dirHandle, dirHandle.name);

      if (imageFiles.length === 0) {
        setDevProgress(null);
        alert('画像ファイルが見つかりませんでした');
        return;
      }

      if (!confirm(`${imageFiles.length} 個の画像をリサイズしますか？\n服/ドール: ${DEV_MAX_CLOTHING_SIZE}px\n背景: ${DEV_MAX_BACKGROUND_SIZE}px`)) {
        setDevProgress(null);
        return;
      }

      let processed = 0;
      let resized = 0;
      let totalSavedBytes = 0;

      for (const { handle, path } of imageFiles) {
        processed++;
        setDevProgress(`処理中... ${processed}/${imageFiles.length}\n${handle.name}`);

        try {
          const file = await handle.getFile();
          const originalSize = file.size;

          // 最大サイズを判定（パスに"background"が含まれるか）
          const maxSize = path.toLowerCase().includes('background') 
            ? DEV_MAX_BACKGROUND_SIZE 
            : DEV_MAX_CLOTHING_SIZE;

          // 画像を読み込み
          const bitmap = await createImageBitmap(file);
          const { width, height } = bitmap;

          // リサイズが必要か判定
          if (width <= maxSize && height <= maxSize) {
            bitmap.close();
            continue; // リサイズ不要
          }

          // アスペクト比を維持してリサイズ
          const ratio = Math.min(maxSize / width, maxSize / height);
          const newWidth = Math.round(width * ratio);
          const newHeight = Math.round(height * ratio);

          // Canvas でリサイズ
          const canvas = new OffscreenCanvas(newWidth, newHeight);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            bitmap.close();
            continue;
          }
          ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
          bitmap.close();

          // Blob に変換
          const mimeType = file.type || 'image/png';
          const blob = await canvas.convertToBlob({ 
            type: mimeType,
            quality: mimeType === 'image/jpeg' ? 0.85 : undefined,
          });

          // 上書き保存
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();

          resized++;
          totalSavedBytes += originalSize - blob.size;
        } catch (err) {
          console.error(`リサイズエラー: ${path}`, err);
        }
      }

      setDevProgress(null);
      const savedMB = (totalSavedBytes / 1024 / 1024).toFixed(1);
      alert(`完了！\n処理: ${processed}ファイル\nリサイズ: ${resized}ファイル\n削減: ${savedMB}MB`);

    } catch (error) {
      setDevProgress(null);
      if ((error as Error).name === 'AbortError') {
        // ユーザーがキャンセル
        return;
      }
      console.error('フォルダリサイズエラー:', error);
      alert('エラーが発生しました');
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
          <h2 
            style={{...styles.title, cursor: 'pointer', userSelect: 'none'}} 
            onClick={handleTitleTap}
          >
            ⚙️ せってい {devMode && '🔧'}
          </h2>
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

            {/* 公式プリセット案内 */}
            <div style={styles.presetGuide}>
              <p style={styles.guideText}>
                📦 <strong>公式プリセット</strong>をお持ちでない方：
              </p>
              <button
                style={styles.downloadLinkButton}
                onClick={handleOpenDownloadPage}
              >
                🌐 ダウンロードページを開く
              </button>
              <p style={styles.guideSubText}>
                ダウンロード後、上の「ZIPファイル」ボタンで読み込んでください
              </p>
            </div>

            {/* カスタムURL入力（折りたたみ） */}
            <button
              style={{
                ...styles.toggleUrlButton,
                ...(isImporting ? styles.buttonDisabled : {}),
              }}
              onClick={() => setShowUrlInput(!showUrlInput)}
              disabled={isImporting}
            >
              {showUrlInput ? '▲ カスタムURLを閉じる' : '▼ カスタムURLを入力'}
            </button>

            {showUrlInput && (
              <div style={styles.urlInputContainer}>
                <input
                  type="url"
                  placeholder="https://example.com/preset.zip"
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  style={styles.urlInput}
                  disabled={isImporting}
                />
                <button
                  style={{
                    ...styles.urlDownloadButton,
                    ...(isImporting ? styles.buttonDisabled : {}),
                  }}
                  onClick={handleUrlDownload}
                  disabled={isImporting || !downloadUrl.trim()}
                >
                  ダウンロード
                </button>
              </div>
            )}
            
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
            {isImporting && !importProgress && (
              <p style={styles.importingText}>📥 取り込み中...</p>
            )}
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

          {/* 開発者モード */}
          {devMode && (
            <div style={{...styles.section, backgroundColor: '#fff3cd', border: '2px solid #ffc107'}}>
              <h3 style={styles.sectionTitle}>🔧 開発者ツール</h3>
              <p style={{fontSize: '11px', color: '#856404', marginBottom: '12px'}}>
                プリセット画像を一括リサイズ（上書き保存）<br/>
                服/ドール: {DEV_MAX_CLOTHING_SIZE}px / 背景: {DEV_MAX_BACKGROUND_SIZE}px
              </p>
              <button 
                style={{
                  ...styles.importButton,
                  backgroundColor: '#ffc107',
                  color: '#212529',
                }}
                onClick={handleDevResizeFolder}
                disabled={!!devProgress}
              >
                📁 フォルダを選択してリサイズ
              </button>
              {devProgress && (
                <p style={{
                  marginTop: '12px',
                  fontSize: '12px',
                  color: '#856404',
                  whiteSpace: 'pre-wrap',
                }}>
                  {devProgress}
                </p>
              )}
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
  importButtonUrl: {
    background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
    border: 'none',
  },
  presetGuide: {
    marginTop: '16px',
    padding: '16px',
    background: 'linear-gradient(135deg, #fff5f8 0%, #ffe0eb 100%)',
    borderRadius: '12px',
    border: '2px dashed #ff6b9d',
    textAlign: 'center',
  },
  guideText: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    color: '#333',
  },
  downloadLinkButton: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#fff',
    background: 'linear-gradient(135deg, #ff6b9d 0%, #c44569 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(255, 107, 157, 0.3)',
  },
  guideSubText: {
    margin: '12px 0 0 0',
    fontSize: '12px',
    color: '#888',
  },
  toggleUrlButton: {
    width: '100%',
    marginTop: '8px',
    padding: '8px 12px',
    fontSize: '12px',
    color: '#666',
    background: 'transparent',
    border: '1px dashed #ccc',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  urlInputContainer: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  urlInput: {
    flex: 1,
    minWidth: '200px',
    padding: '10px 12px',
    fontSize: '13px',
    border: '2px solid #007bff',
    borderRadius: '8px',
    outline: 'none',
  },
  urlDownloadButton: {
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 'bold',
    color: 'white',
    background: '#007bff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
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
  progressContainer: {
    marginTop: '12px',
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
  progressDetail: {
    fontSize: '11px',
    color: '#1565c0',
    textAlign: 'center' as const,
    marginTop: '4px',
  },
};
