/**
 * ItemImporter コンポーネント
 * アイテムをインポートするためのUI
 */
import { useState, useCallback, useRef } from 'react';
import type { ClothingItemData, ClothingType } from '../types';
import {
  fileToDataUrl,
  addCustomItem,
} from '../services/dataManager';

interface ItemImporterProps {
  onImport: (item: ClothingItemData) => void;
  onClose: () => void;
}

// タイプ選択オプション
const TYPE_OPTIONS: { value: ClothingType; label: string; emoji: string }[] = [
  { value: 'top', label: 'トップス', emoji: '👕' },
  { value: 'bottom', label: 'ボトムス', emoji: '👖' },
  { value: 'dress', label: 'ワンピース', emoji: '👗' },
  { value: 'shoes', label: 'くつ', emoji: '👟' },
  { value: 'accessory', label: 'アクセサリー', emoji: '🎀' },
  { value: 'underwear_top', label: 'したぎ(うえ)', emoji: '🩱' },
  { value: 'underwear_bottom', label: 'したぎ(した)', emoji: '🩲' },
];

// baseZIndexのデフォルト値
const DEFAULT_Z_INDEX: Record<ClothingType, number> = {
  underwear_top: 0,
  underwear_bottom: 1,
  shoes: 5,
  bottom: 10,
  dress: 15,
  top: 20,
  accessory: 30,
};

// positionのデフォルト値
const DEFAULT_POSITION: Record<ClothingType, { x: number; y: number }> = {
  underwear_top: { x: 0, y: -30 },
  underwear_bottom: { x: 0, y: 30 },
  top: { x: 0, y: -30 },
  bottom: { x: 0, y: 30 },
  dress: { x: 0, y: 0 },
  shoes: { x: 0, y: 135 },
  accessory: { x: 0, y: -125 },
};

export function ItemImporter({ onImport, onClose }: ItemImporterProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ClothingType>('top');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(-30);
  const [tags, setTags] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // タイプ変更時にデフォルト値を設定
  const handleTypeChange = useCallback((newType: ClothingType) => {
    setType(newType);
    const defaultPos = DEFAULT_POSITION[newType];
    setPositionX(defaultPos.x);
    setPositionY(defaultPos.y);
  }, []);

  // 画像ファイル選択
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 画像ファイルのみ許可
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください');
      return;
    }

    setImageFile(file);
    setError(null);

    // プレビュー生成
    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreview(dataUrl);
    } catch {
      setError('画像の読み込みに失敗しました');
    }
  }, []);

  // インポート実行
  const handleImport = useCallback(async () => {
    if (!name.trim()) {
      setError('名前を入力してください');
      return;
    }
    if (!imageFile) {
      setError('画像を選択してください');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const imageDataUrl = await fileToDataUrl(imageFile);
      
      // ユニークIDを生成
      const id = `custom-${type}-${Date.now()}`;
      
      const newItem: ClothingItemData = {
        id,
        name: name.trim(),
        type,
        imageUrl: imageDataUrl,
        position: { x: positionX, y: positionY },
        baseZIndex: DEFAULT_Z_INDEX[type],
        tags: tags.split(',').map(t => t.trim()).filter(t => t),
        createdAt: new Date().toISOString().split('T')[0],
        isCustom: true,
      };

      // ローカルストレージに保存
      addCustomItem(newItem);
      
      // 親に通知
      onImport(newItem);
    } catch (err) {
      setError('インポートに失敗しました');
      console.error('Import error:', err);
    } finally {
      setIsImporting(false);
    }
  }, [name, imageFile, type, positionX, positionY, tags, onImport]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={styles.title}>📦 アイテムをついか</h2>

        {/* 画像選択 */}
        <div style={styles.section}>
          <label style={styles.label}>がぞう</label>
          <div 
            style={styles.dropZone}
            onClick={() => fileInputRef.current?.click()}
          >
            {imagePreview ? (
              <img src={imagePreview} alt="プレビュー" style={styles.preview} />
            ) : (
              <div style={styles.dropZoneText}>
                📁 クリックしてがぞうをえらぶ
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* 名前 */}
        <div style={styles.section}>
          <label style={styles.label}>なまえ</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ピンクのTシャツ"
            style={styles.input}
          />
        </div>

        {/* タイプ選択 */}
        <div style={styles.section}>
          <label style={styles.label}>しゅるい</label>
          <div style={styles.typeGrid}>
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                style={{
                  ...styles.typeButton,
                  ...(type === opt.value ? styles.typeSelected : {}),
                }}
                onClick={() => handleTypeChange(opt.value)}
              >
                <span style={styles.emoji}>{opt.emoji}</span>
                <span style={styles.typeLabel}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 位置調整 */}
        <div style={styles.section}>
          <label style={styles.label}>いち（びちょうせい）</label>
          <div style={styles.positionInputs}>
            <div style={styles.positionInput}>
              <span>X:</span>
              <input
                type="number"
                value={positionX}
                onChange={e => setPositionX(Number(e.target.value))}
                style={styles.numberInput}
              />
            </div>
            <div style={styles.positionInput}>
              <span>Y:</span>
              <input
                type="number"
                value={positionY}
                onChange={e => setPositionY(Number(e.target.value))}
                style={styles.numberInput}
              />
            </div>
          </div>
        </div>

        {/* タグ */}
        <div style={styles.section}>
          <label style={styles.label}>タグ（カンマくぎり）</label>
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="ピンク, かわいい, カジュアル"
            style={styles.input}
          />
        </div>

        {/* エラー */}
        {error && <div style={styles.error}>{error}</div>}

        {/* ボタン */}
        <div style={styles.buttonArea}>
          <button
            style={styles.importButton}
            onClick={handleImport}
            disabled={isImporting || !imageFile || !name.trim()}
          >
            {isImporting ? '⏳ よみこみちゅう...' : '✅ ついかする！'}
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
    maxWidth: '450px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
  },
  title: {
    textAlign: 'center',
    margin: '0 0 16px 0',
    fontSize: '20px',
    color: '#333',
  },
  section: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: 'bold',
    color: '#333',
    fontSize: '14px',
  },
  dropZone: {
    width: '100%',
    height: '120px',
    border: '2px dashed #ccc',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backgroundColor: '#f8f9fa',
    transition: 'border-color 0.2s',
  },
  dropZoneText: {
    color: '#666',
    fontSize: '14px',
  },
  preview: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  typeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
  },
  typeButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 4px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  typeSelected: {
    borderColor: '#ff69b4',
    backgroundColor: '#fff0f5',
  },
  emoji: {
    fontSize: '20px',
  },
  typeLabel: {
    fontSize: '10px',
    marginTop: '4px',
  },
  positionInputs: {
    display: 'flex',
    gap: '16px',
  },
  positionInput: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  numberInput: {
    width: '80px',
    padding: '8px',
    fontSize: '14px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    textAlign: 'center',
  },
  error: {
    backgroundColor: '#ffebee',
    color: '#c62828',
    padding: '8px 12px',
    borderRadius: '8px',
    marginBottom: '16px',
    textAlign: 'center',
    fontSize: '12px',
  },
  buttonArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '16px',
  },
  importButton: {
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#4caf50',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  closeButton: {
    padding: '10px 24px',
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#f0f0f0',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};
