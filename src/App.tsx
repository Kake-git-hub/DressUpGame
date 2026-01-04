/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 * 
 * iPad 10.3横向き（2360x1640）最適化
 */
import { useCallback, useState, useEffect, useMemo } from 'react';
import { AvatarCanvas, CategorySelector } from './components';
import { useDressUp } from './hooks/useDressUp';
import { loadCustomItems } from './services/dataManager';
import type { ClothingItemData, DollData, DollDimensions } from './types';
import './App.css';

// E2Eテスト時はPixiJSを無効化するフラグ
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// デフォルトのドールベース情報
const DEFAULT_DOLL: DollData = {
  id: 'doll-base-001',
  name: 'ベーシックドール',
  bodyImageUrl: '/assets/dolls/doll-base.png',
  skinTone: 'fair',
  dimensions: {
    width: 512, // 添付画像の実際の幅
    height: 1024, // 添付画像の実際の高さ（推定）
    anchorPoints: {
      headTop: { x: 0.5, y: 0.05 },
      neckCenter: { x: 0.5, y: 0.18 },
      torsoCenter: { x: 0.5, y: 0.4 },
      hipCenter: { x: 0.5, y: 0.55 },
      footBottom: { x: 0.5, y: 0.98 },
    },
  },
  // 将来のVtuber連携用関節データ
  joints: {
    head: { id: 'head', name: '頭', position: { x: 0.5, y: 0.08 } },
    neck: { id: 'neck', name: '首', position: { x: 0.5, y: 0.18 }, parentId: 'head' },
    leftShoulder: { id: 'leftShoulder', name: '左肩', position: { x: 0.3, y: 0.22 }, parentId: 'neck' },
    rightShoulder: { id: 'rightShoulder', name: '右肩', position: { x: 0.7, y: 0.22 }, parentId: 'neck' },
    leftElbow: { id: 'leftElbow', name: '左肘', position: { x: 0.2, y: 0.35 }, parentId: 'leftShoulder' },
    rightElbow: { id: 'rightElbow', name: '右肘', position: { x: 0.8, y: 0.35 }, parentId: 'rightShoulder' },
    leftWrist: { id: 'leftWrist', name: '左手首', position: { x: 0.15, y: 0.48 }, parentId: 'leftElbow' },
    rightWrist: { id: 'rightWrist', name: '右手首', position: { x: 0.85, y: 0.48 }, parentId: 'rightElbow' },
    hip: { id: 'hip', name: '腰', position: { x: 0.5, y: 0.55 }, parentId: 'neck' },
    leftKnee: { id: 'leftKnee', name: '左膝', position: { x: 0.4, y: 0.72 }, parentId: 'hip' },
    rightKnee: { id: 'rightKnee', name: '右膝', position: { x: 0.6, y: 0.72 }, parentId: 'hip' },
    leftAnkle: { id: 'leftAnkle', name: '左足首', position: { x: 0.4, y: 0.92 }, parentId: 'leftKnee' },
    rightAnkle: { id: 'rightAnkle', name: '右足首', position: { x: 0.6, y: 0.92 }, parentId: 'rightKnee' },
  },
};

// 基準ドールサイズ（アイテムのposition値はこのサイズ基準）
const REFERENCE_DOLL_SIZE = { width: 200, height: 300 };

// デフォルトの下着
const defaultUnderwear: ClothingItemData[] = [
  {
    id: 'underwear-top-default',
    name: '白いキャミソール',
    type: 'underwear_top',
    imageUrl: '/images/underwear-top.png',
    position: { x: 0, y: -30 },
    baseZIndex: 0,
    anchorType: 'torso',
  },
  {
    id: 'underwear-bottom-default',
    name: '白いショーツ',
    type: 'underwear_bottom',
    imageUrl: '/images/underwear-bottom.png',
    position: { x: 0, y: 30 },
    baseZIndex: 1,
    anchorType: 'hip',
  },
];

// デフォルトの服アイテムデータ
const defaultClothingItems: ClothingItemData[] = [
  {
    id: 'top-1',
    name: '青いTシャツ',
    type: 'top',
    imageUrl: '/images/top-1.png',
    position: { x: 0, y: -30 },
    baseZIndex: 20,
    anchorType: 'torso',
  },
  {
    id: 'top-2',
    name: '赤いTシャツ',
    type: 'top',
    imageUrl: '/images/top-2.png',
    position: { x: 0, y: -30 },
    baseZIndex: 20,
    anchorType: 'torso',
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 30 },
    baseZIndex: 10,
    anchorType: 'hip',
  },
  {
    id: 'bottom-2',
    name: '青いパンツ',
    type: 'bottom',
    imageUrl: '/images/bottom-2.png',
    position: { x: 0, y: 30 },
    baseZIndex: 10,
    anchorType: 'hip',
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 15,
    anchorType: 'torso',
  },
  {
    id: 'shoes-1',
    name: '茶色のくつ',
    type: 'shoes',
    imageUrl: '/images/shoes-1.png',
    position: { x: 0, y: 135 },
    baseZIndex: 5,
    anchorType: 'feet',
  },
  {
    id: 'accessory-1',
    name: 'ピンクのリボン',
    type: 'accessory',
    imageUrl: '/images/accessory-1.png',
    position: { x: 0, y: -125 },
    baseZIndex: 30,
    anchorType: 'head',
  },
];

// アイテムの位置をドールサイズに合わせてスケーリング
function scaleItemPosition(
  item: ClothingItemData,
  _dollDimensions: DollDimensions | undefined,
  canvasHeight: number
): ClothingItemData {
  // スケール係数を計算（キャンバスに収まるドールサイズ）
  const dollDisplayHeight = canvasHeight * 0.9; // キャンバスの90%
  const scale = dollDisplayHeight / REFERENCE_DOLL_SIZE.height;

  return {
    ...item,
    position: {
      x: item.position.x * scale,
      y: item.position.y * scale,
    },
  };
}

function App() {
  // 現在のドール
  const [currentDoll] = useState<DollData>(DEFAULT_DOLL);

  // 全アイテム（デフォルト + カスタム）
  const [allItems, setAllItems] = useState<ClothingItemData[]>(defaultClothingItems);

  // キャンバスサイズ（iPad横向き最適化）
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 800 });

  // 画面サイズに応じてキャンバスサイズを計算
  useEffect(() => {
    const updateCanvasSize = () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      // iPad 10.3横向き: 2360x1640 (CSS px: 1180x820程度)
      // ドールを最大表示するため、高さベースで計算
      const maxHeight = vh - 120; // ヘッダー・フッター分を除く
      const maxWidth = vw - 360; // パレット分を除く

      // ドールの縦横比を維持（1:2程度）
      const dollAspect = 0.5; // width / height
      let height = maxHeight;
      let width = height * dollAspect;

      if (width > maxWidth) {
        width = maxWidth;
        height = width / dollAspect;
      }

      setCanvasSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  // 初期化時にカスタムアイテムを読み込み
  useEffect(() => {
    const customItems = loadCustomItems();
    setAllItems([...defaultClothingItems, ...customItems]);
  }, []);

  // アイテムをスケーリング
  const scaledItems = useMemo(() => {
    return allItems.map(item =>
      scaleItemPosition(item, currentDoll.dimensions, canvasSize.height)
    );
  }, [allItems, currentDoll.dimensions, canvasSize.height]);

  // スケーリングされた下着
  const scaledUnderwear = useMemo(() => {
    return defaultUnderwear.map(item =>
      scaleItemPosition(item, currentDoll.dimensions, canvasSize.height)
    );
  }, [currentDoll.dimensions, canvasSize.height]);

  // 着せ替え状態管理フック
  const { equipItem, getEquippedItems, resetAll } = useDressUp(scaledItems, scaledUnderwear);

  // 装備中のアイテム
  const equippedItems = getEquippedItems();

  // 服を選択した時の処理（上書き可能）
  const handleItemSelect = useCallback(
    (item: ClothingItemData) => {
      // スケーリングされたバージョンを見つける
      const scaledItem = scaledItems.find(i => i.id === item.id) || item;
      equipItem(scaledItem);
    },
    [equipItem, scaledItems]
  );

  // リセットボタン
  const handleReset = useCallback(() => {
    resetAll();
  }, [resetAll]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎀 きせかえゲーム 🎀</h1>
      </header>

      <main className="app-main">
        {/* ドール表示エリア */}
        <section className="avatar-section">
          {isTestMode ? (
            <div
              data-testid="avatar-canvas"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
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
              width={canvasSize.width}
              height={canvasSize.height}
              equippedItems={equippedItems}
              dollImageUrl={currentDoll.bodyImageUrl}
            />
          )}

          {/* リセットボタン（下着以外を着ている時のみ表示） */}
          {equippedItems.length > 2 && (
            <button className="reset-button" onClick={handleReset}>
              🔄 リセット
            </button>
          )}
        </section>

        {/* カテゴリー・アイテム選択パレット */}
        <section className="palette-section">
          <CategorySelector
            items={allItems}
            onItemSelect={handleItemSelect}
            equippedItems={equippedItems}
          />
        </section>
      </main>

      <footer className="app-footer">
        <p>カテゴリーをえらんで、すきなふくをきせてね！</p>
      </footer>
    </div>
  );
}

export default App;
