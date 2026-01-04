/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 */
import { useCallback, useState } from 'react';
import { AvatarCanvas, ClothingPalette } from './components';
import { useDressUp } from './hooks/useDressUp';
import { AIFaceGenerator } from './components/AIFaceGenerator';
import type { ClothingItemData } from './types';
import './App.css';

// E2Eテスト時はPixiJSを無効化するフラグ（URLパラメータで制御）
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// デフォルトの下着
const defaultUnderwear: ClothingItemData[] = [
  {
    id: 'underwear-top-default',
    name: '白いキャミソール',
    type: 'underwear_top',
    imageUrl: '/images/underwear-top.png',
    position: { x: 0, y: -30 },
    baseZIndex: 0,
  },
  {
    id: 'underwear-bottom-default',
    name: '白いショーツ',
    type: 'underwear_bottom',
    imageUrl: '/images/underwear-bottom.png',
    position: { x: 0, y: 30 },
    baseZIndex: 1,
  },
];

// サンプルの服アイテムデータ
const sampleClothingItems: ClothingItemData[] = [
  {
    id: 'top-1',
    name: '青いTシャツ',
    type: 'top',
    imageUrl: '/images/top-1.png',
    position: { x: 0, y: -30 },
    baseZIndex: 20,
  },
  {
    id: 'top-2',
    name: '赤いTシャツ',
    type: 'top',
    imageUrl: '/images/top-2.png',
    position: { x: 0, y: -30 },
    baseZIndex: 20,
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 30 },
    baseZIndex: 10,
  },
  {
    id: 'bottom-2',
    name: '青いパンツ',
    type: 'bottom',
    imageUrl: '/images/bottom-2.png',
    position: { x: 0, y: 30 },
    baseZIndex: 10,
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 15,
  },
  {
    id: 'shoes-1',
    name: '茶色のくつ',
    type: 'shoes',
    imageUrl: '/images/shoes-1.png',
    position: { x: 0, y: 135 },
    baseZIndex: 5,
  },
  {
    id: 'accessory-1',
    name: 'ピンクのリボン',
    type: 'accessory',
    imageUrl: '/images/accessory-1.png',
    position: { x: 0, y: -125 },
    baseZIndex: 30,
  },
];

function App() {
  // 着せ替え状態管理フック（下着付き）
  const { equipItem, getEquippedItems, resetAll } = useDressUp(sampleClothingItems, defaultUnderwear);

  // AI顔生成モーダル表示状態
  const [showAIGenerator, setShowAIGenerator] = useState(false);

  // 生成した顔画像URL
  const [generatedFaceUrl, setGeneratedFaceUrl] = useState<string | null>(null);

  // 装備中のアイテム
  const equippedItems = getEquippedItems();

  // 服を選択した時の処理
  const handleItemSelect = useCallback(
    (item: ClothingItemData) => {
      equipItem(item);
    },
    [equipItem]
  );

  // リセットボタン
  const handleReset = useCallback(() => {
    resetAll();
  }, [resetAll]);

  // AI顔生成完了時
  const handleFaceGenerated = useCallback((imageUrl: string) => {
    setGeneratedFaceUrl(imageUrl);
    setShowAIGenerator(false);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎀 きせかえゲーム 🎀</h1>
        <p className="subtitle">すきなふくをえらんで、おにんぎょうにきせてね！</p>
      </header>

      <main className="app-main">
        {/* ドール表示エリア */}
        <section className="avatar-section">
          {isTestMode ? (
            // テストモード時はシンプルなプレースホルダー
            <div
              data-testid="avatar-canvas"
              style={{
                width: 400,
                height: 500,
                backgroundColor: '#fff5ee',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
              }}
            >
              🎀 ドール表示エリア
            </div>
          ) : (
            <AvatarCanvas
              width={400}
              height={500}
              equippedItems={equippedItems}
              customFaceUrl={generatedFaceUrl ?? undefined}
            />
          )}

          {/* ボタンエリア */}
          <div className="button-area">
            {/* AI顔生成ボタン */}
            <button 
              className="ai-button" 
              onClick={() => setShowAIGenerator(true)}
              data-testid="ai-face-button"
            >
              🎨 AIでかおをつくる
            </button>

            {/* リセットボタン */}
            {equippedItems.length > 2 && (
              <button className="reset-button" onClick={handleReset}>
                🔄 リセット
              </button>
            )}
          </div>
        </section>

        {/* 服選択パレット */}
        <section className="palette-section">
          <ClothingPalette
            items={sampleClothingItems}
            onItemSelect={handleItemSelect}
            equippedItems={equippedItems}
          />
        </section>
      </main>

      <footer className="app-footer">
        <p>👆 ふくをドラッグしてドールにきせてね！</p>
      </footer>

      {/* AI顔生成モーダル */}
      {showAIGenerator && (
        <AIFaceGenerator
          onGenerate={handleFaceGenerated}
          onClose={() => setShowAIGenerator(false)}
        />
      )}
    </div>
  );
}

export default App;
