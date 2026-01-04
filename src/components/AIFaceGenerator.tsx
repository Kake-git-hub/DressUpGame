/**
 * AI顔生成コンポーネント
 * Webアプリ上でドールの顔を生成するUI
 */
import { useState, useCallback } from 'react';

// 顔のスタイルオプション
const FACE_STYLES = [
  { id: 'cute', name: 'かわいい', emoji: '🥰' },
  { id: 'cool', name: 'かっこいい', emoji: '😎' },
  { id: 'happy', name: 'にこにこ', emoji: '😊' },
  { id: 'princess', name: 'おひめさま', emoji: '👸' },
  { id: 'fairy', name: 'ようせい', emoji: '🧚' },
];

// 髪の色オプション
const HAIR_COLORS = [
  { id: 'black', name: 'くろ', color: '#333333' },
  { id: 'brown', name: 'ちゃいろ', color: '#8B4513' },
  { id: 'blonde', name: 'きんいろ', color: '#FFD700' },
  { id: 'pink', name: 'ピンク', color: '#FF69B4' },
  { id: 'blue', name: 'あお', color: '#4169E1' },
];

// 目の色オプション
const EYE_COLORS = [
  { id: 'black', name: 'くろ', color: '#333333' },
  { id: 'brown', name: 'ちゃいろ', color: '#8B4513' },
  { id: 'blue', name: 'あお', color: '#4169E1' },
  { id: 'green', name: 'みどり', color: '#32CD32' },
  { id: 'purple', name: 'むらさき', color: '#9370DB' },
];

interface AIFaceGeneratorProps {
  onGenerate: (imageUrl: string) => void;
  onClose: () => void;
}

export function AIFaceGenerator({ onGenerate, onClose }: AIFaceGeneratorProps) {
  const [selectedStyle, setSelectedStyle] = useState('cute');
  const [selectedHairColor, setSelectedHairColor] = useState('brown');
  const [selectedEyeColor, setSelectedEyeColor] = useState('brown');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFace, setGeneratedFace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // プロンプトを生成
  const generatePrompt = useCallback(() => {
    const style = FACE_STYLES.find(s => s.id === selectedStyle)?.name ?? 'かわいい';
    const hairColor = HAIR_COLORS.find(h => h.id === selectedHairColor)?.name ?? 'ちゃいろ';
    const eyeColor = EYE_COLORS.find(e => e.id === selectedEyeColor)?.name ?? 'ちゃいろ';

    return `${style}顔の女の子、${hairColor}の髪、${eyeColor}の目、着せ替え人形風、シンプルなアニメスタイル、白背景`;
  }, [selectedStyle, selectedHairColor, selectedEyeColor]);

  // AI生成を実行（現在はモック実装）
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      // プロンプト生成
      const prompt = generatePrompt();
      console.log('生成プロンプト:', prompt);

      // モック実装：選択に基づいて顔を生成
      // 実際のAPI連携時はここでStable Diffusion等を呼び出す
      await new Promise(resolve => setTimeout(resolve, 1500));

      // モックの顔画像（SVGでシンプルな顔を生成）
      const hairColor = HAIR_COLORS.find(h => h.id === selectedHairColor)?.color ?? '#8B4513';
      const eyeColor = EYE_COLORS.find(e => e.id === selectedEyeColor)?.color ?? '#333333';
      const style = selectedStyle;

      // SVGで顔を生成
      const svg = generateFaceSVG(hairColor, eyeColor, style);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      setGeneratedFace(url);
    } catch (err) {
      setError('生成に失敗しました。もう一度お試しください。');
      console.error('Face generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [generatePrompt, selectedHairColor, selectedEyeColor, selectedStyle]);

  // 生成した顔を適用
  const handleApply = useCallback(() => {
    if (generatedFace) {
      onGenerate(generatedFace);
    }
  }, [generatedFace, onGenerate]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={styles.title}>🎨 AIでかおをつくろう！</h2>
        
        {/* プレビューエリア */}
        <div style={styles.previewArea}>
          {generatedFace ? (
            <img src={generatedFace} alt="生成された顔" style={styles.preview} />
          ) : (
            <div style={styles.previewPlaceholder}>
              {isGenerating ? '✨ つくってるよ...' : '👆 したのボタンでつくってね'}
            </div>
          )}
        </div>

        {/* スタイル選択 */}
        <div style={styles.section}>
          <label style={styles.label}>スタイル</label>
          <div style={styles.optionGrid}>
            {FACE_STYLES.map(style => (
              <button
                key={style.id}
                style={{
                  ...styles.optionButton,
                  ...(selectedStyle === style.id ? styles.optionSelected : {}),
                }}
                onClick={() => setSelectedStyle(style.id)}
              >
                <span style={styles.emoji}>{style.emoji}</span>
                <span style={styles.optionName}>{style.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 髪の色選択 */}
        <div style={styles.section}>
          <label style={styles.label}>かみのいろ</label>
          <div style={styles.colorGrid}>
            {HAIR_COLORS.map(color => (
              <button
                key={color.id}
                style={{
                  ...styles.colorButton,
                  backgroundColor: color.color,
                  ...(selectedHairColor === color.id ? styles.colorSelected : {}),
                }}
                onClick={() => setSelectedHairColor(color.id)}
                title={color.name}
              />
            ))}
          </div>
        </div>

        {/* 目の色選択 */}
        <div style={styles.section}>
          <label style={styles.label}>めのいろ</label>
          <div style={styles.colorGrid}>
            {EYE_COLORS.map(color => (
              <button
                key={color.id}
                style={{
                  ...styles.colorButton,
                  backgroundColor: color.color,
                  ...(selectedEyeColor === color.id ? styles.colorSelected : {}),
                }}
                onClick={() => setSelectedEyeColor(color.id)}
                title={color.name}
              />
            ))}
          </div>
        </div>

        {/* エラーメッセージ */}
        {error && <div style={styles.error}>{error}</div>}

        {/* ボタン */}
        <div style={styles.buttonArea}>
          <button
            style={styles.generateButton}
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? '✨ つくってるよ...' : '🎨 かおをつくる！'}
          </button>

          {generatedFace && (
            <button style={styles.applyButton} onClick={handleApply}>
              ✅ このかおにする！
            </button>
          )}

          <button style={styles.closeButton} onClick={onClose}>
            ❌ とじる
          </button>
        </div>
      </div>
    </div>
  );
}

// SVGで顔を生成するヘルパー関数
function generateFaceSVG(hairColor: string, eyeColor: string, style: string): string {
  // スタイルに応じた口の形
  let mouthPath = '';
  switch (style) {
    case 'cute':
      mouthPath = '<path d="M 35 55 Q 50 65 65 55" stroke="#ff6b6b" stroke-width="2" fill="none"/>';
      break;
    case 'cool':
      mouthPath = '<path d="M 38 55 L 62 55" stroke="#ff6b6b" stroke-width="2" fill="none"/>';
      break;
    case 'happy':
      mouthPath = `
        <path d="M 35 52 Q 50 68 65 52" stroke="#ff6b6b" stroke-width="2" fill="none"/>
        <ellipse cx="30" cy="45" rx="5" ry="3" fill="#ffb6c1" opacity="0.6"/>
        <ellipse cx="70" cy="45" rx="5" ry="3" fill="#ffb6c1" opacity="0.6"/>
      `;
      break;
    case 'princess':
      mouthPath = `
        <path d="M 40 55 Q 50 62 60 55" stroke="#ff6b6b" stroke-width="2" fill="none"/>
        <circle cx="50" cy="15" r="5" fill="#FFD700"/>
      `;
      break;
    case 'fairy':
      mouthPath = `
        <path d="M 35 55 Q 50 65 65 55" stroke="#ff6b6b" stroke-width="2" fill="none"/>
        <circle cx="25" cy="30" r="2" fill="#fff" opacity="0.8"/>
        <circle cx="75" cy="30" r="2" fill="#fff" opacity="0.8"/>
      `;
      break;
    default:
      mouthPath = '<path d="M 35 55 Q 50 65 65 55" stroke="#ff6b6b" stroke-width="2" fill="none"/>';
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <!-- 髪（後ろ） -->
  <ellipse cx="50" cy="45" rx="42" ry="45" fill="${hairColor}"/>
  
  <!-- 顔 -->
  <ellipse cx="50" cy="50" rx="35" ry="38" fill="#ffe4c4"/>
  
  <!-- 髪（前髪） -->
  <path d="M 15 45 Q 25 20 50 18 Q 75 20 85 45 L 80 35 Q 70 25 50 25 Q 30 25 20 35 Z" fill="${hairColor}"/>
  
  <!-- 目 -->
  <ellipse cx="35" cy="45" rx="8" ry="10" fill="white"/>
  <ellipse cx="65" cy="45" rx="8" ry="10" fill="white"/>
  <circle cx="35" cy="45" r="5" fill="${eyeColor}"/>
  <circle cx="65" cy="45" r="5" fill="${eyeColor}"/>
  <circle cx="33" cy="43" r="2" fill="white"/>
  <circle cx="63" cy="43" r="2" fill="white"/>
  
  <!-- まつげ -->
  <path d="M 27 38 Q 35 35 43 38" stroke="${hairColor}" stroke-width="1" fill="none"/>
  <path d="M 57 38 Q 65 35 73 38" stroke="${hairColor}" stroke-width="1" fill="none"/>
  
  <!-- 鼻 -->
  <ellipse cx="50" cy="50" rx="2" ry="1" fill="#f0c8b0"/>
  
  <!-- 口 -->
  ${mouthPath}
</svg>
  `.trim();
}

// スタイル定義
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
    maxWidth: '400px',
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
  previewArea: {
    width: '120px',
    height: '120px',
    margin: '0 auto 16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    border: '3px solid #e0e0e0',
  },
  preview: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewPlaceholder: {
    textAlign: 'center',
    color: '#999',
    fontSize: '12px',
    padding: '8px',
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
  optionGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'center',
  },
  optionButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 12px',
    border: '2px solid #e0e0e0',
    borderRadius: '12px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
    minWidth: '60px',
  },
  optionSelected: {
    borderColor: '#ff69b4',
    backgroundColor: '#fff0f5',
  },
  emoji: {
    fontSize: '24px',
  },
  optionName: {
    fontSize: '10px',
    marginTop: '4px',
  },
  colorGrid: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  colorButton: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '3px solid white',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    transition: 'all 0.2s',
  },
  colorSelected: {
    border: '3px solid #ff69b4',
    transform: 'scale(1.15)',
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
  generateButton: {
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: '#ff69b4',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  applyButton: {
    padding: '12px 24px',
    fontSize: '14px',
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
