/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 */
import { useCallback, useState } from 'react';
import { AvatarCanvas, ClothingPalette } from './components';
import { useDressUp } from './hooks/useDressUp';
import type { ClothingItemData } from './types';
import './App.css';

// E2Eテスト時はPixiJSを無効化するフラグ（URLパラメータで制御）
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// サンプルの服アイテムデータ
const sampleClothingItems: ClothingItemData[] = [
  {
    id: 'top-1',
    name: '青いTシャツ',
    type: 'top',
    imageUrl: '/images/top-1.png',
    position: { x: 0, y: -30 },
    zIndex: 2,
  },
  {
    id: 'top-2',
    name: '赤いTシャツ',
    type: 'top',
    imageUrl: '/images/top-2.png',
    position: { x: 0, y: -30 },
    zIndex: 2,
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 30 },
    zIndex: 3,
  },
  {
    id: 'bottom-2',
    name: '青いパンツ',
    type: 'bottom',
    imageUrl: '/images/bottom-2.png',
    position: { x: 0, y: 30 },
    zIndex: 3,
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    zIndex: 2,
  },
  {
    id: 'shoes-1',
    name: '茶色のくつ',
    type: 'shoes',
    imageUrl: '/images/shoes-1.png',
    position: { x: 0, y: 135 },
    zIndex: 4,
  },
  {
    id: 'accessory-1',
    name: 'ピンクのリボン',
    type: 'accessory',
    imageUrl: '/images/accessory-1.png',
    position: { x: 0, y: -125 },
    zIndex: 5,
  },
];

function App() {
  // 着せ替え状態管理フック
  const { equipItem, getEquippedItems, resetAll } = useDressUp(sampleClothingItems);

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
            />
          )}

          {/* リセットボタン */}
          {equippedItems.length > 0 && (
            <button className="reset-button" onClick={handleReset}>
              🔄 リセット
            </button>
          )}
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
        <p>👆 ふくをタップしてきせてね！</p>
      </footer>
    </div>
  );
}

export default App;
