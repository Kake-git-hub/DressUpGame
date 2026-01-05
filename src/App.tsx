/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 * 
 * iPad 10.3横向き（2360x1640）最適化
 * GitHub Pages（無料）で画像配信
 */
import { useCallback, useState, useEffect, useMemo } from 'react';
import { AvatarCanvas, DressUpMenu, DollControlPanel } from './components';
import { SettingsPanel } from './components/SettingsPanel';
import { useDressUp } from './hooks/useDressUp';
import {
  loadCustomDolls,
  loadCustomBackgrounds,
  loadCustomClothing,
} from './services/assetStorage';
import type { ClothingItemData, DollData, DollDimensions, BackgroundData, DollTransform } from './types';
import './App.css';

// アプリバージョン
const APP_VERSION = '0.4.0';

// Viteのbase pathを取得（GitHub Pages対応）
const BASE_PATH = import.meta.env.BASE_URL;

// E2Eテスト時はPixiJSを無効化するフラグ
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// デフォルトのドールリスト（GitHub Pages同梱）
const DEFAULT_DOLLS: DollData[] = [
  {
    id: 'doll-base-001',
    name: 'ちびドール',
    bodyImageUrl: `${BASE_PATH}assets/dolls/doll-base-1.png`,
    skinTone: 'fair',
    dimensions: {
      width: 512,
      height: 1024,
      anchorPoints: {
        headTop: { x: 0.5, y: 0.05 },
        neckCenter: { x: 0.5, y: 0.18 },
        torsoCenter: { x: 0.5, y: 0.4 },
        hipCenter: { x: 0.5, y: 0.55 },
        footBottom: { x: 0.5, y: 0.98 },
      },
    },
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
  },
  {
    id: 'doll-base-002',
    name: 'スリムドール',
    bodyImageUrl: `${BASE_PATH}assets/dolls/doll-base-2.png`,
    skinTone: 'fair',
    dimensions: {
      width: 400,
      height: 800,
      anchorPoints: {
        headTop: { x: 0.5, y: 0.02 },
        neckCenter: { x: 0.5, y: 0.12 },
        torsoCenter: { x: 0.5, y: 0.35 },
        hipCenter: { x: 0.5, y: 0.5 },
        footBottom: { x: 0.5, y: 0.98 },
      },
    },
    joints: {
      head: { id: 'head', name: '頭', position: { x: 0.5, y: 0.06 } },
      neck: { id: 'neck', name: '首', position: { x: 0.5, y: 0.12 }, parentId: 'head' },
      leftShoulder: { id: 'leftShoulder', name: '左肩', position: { x: 0.3, y: 0.16 }, parentId: 'neck' },
      rightShoulder: { id: 'rightShoulder', name: '右肩', position: { x: 0.7, y: 0.16 }, parentId: 'neck' },
      leftElbow: { id: 'leftElbow', name: '左肘', position: { x: 0.2, y: 0.28 }, parentId: 'leftShoulder' },
      rightElbow: { id: 'rightElbow', name: '右肘', position: { x: 0.8, y: 0.28 }, parentId: 'rightShoulder' },
      leftWrist: { id: 'leftWrist', name: '左手首', position: { x: 0.15, y: 0.4 }, parentId: 'leftElbow' },
      rightWrist: { id: 'rightWrist', name: '右手首', position: { x: 0.85, y: 0.4 }, parentId: 'rightElbow' },
      hip: { id: 'hip', name: '腰', position: { x: 0.5, y: 0.5 }, parentId: 'neck' },
      leftKnee: { id: 'leftKnee', name: '左膝', position: { x: 0.42, y: 0.7 }, parentId: 'hip' },
      rightKnee: { id: 'rightKnee', name: '右膝', position: { x: 0.58, y: 0.7 }, parentId: 'hip' },
      leftAnkle: { id: 'leftAnkle', name: '左足首', position: { x: 0.42, y: 0.92 }, parentId: 'leftKnee' },
      rightAnkle: { id: 'rightAnkle', name: '右足首', position: { x: 0.58, y: 0.92 }, parentId: 'rightKnee' },
    },
  },
];

// デフォルトの背景リスト（空 - ユーザーが追加）
const DEFAULT_BACKGROUNDS: BackgroundData[] = [];

// 基準ドールサイズ（アイテムのposition値はこのサイズ基準）
const REFERENCE_DOLL_SIZE = { width: 200, height: 300 };

// デフォルトの下着（ユーザーが設定から追加）
const DEFAULT_UNDERWEAR: ClothingItemData[] = [];
// 注: デフォルト下着画像を使う場合は以下のようにpublic/assets/clothing/に配置
// {
//   id: 'underwear-top-default',
//   name: '白いキャミソール',
//   type: 'underwear_top',
//   imageUrl: `${BASE_PATH}assets/clothing/underwear-top.png`,
//   position: { x: 0, y: -30 },
//   baseZIndex: 0,
//   anchorType: 'torso',
// },

// デフォルトの服アイテムデータ（ユーザーが設定から追加）
const DEFAULT_CLOTHING: ClothingItemData[] = [];
// 注: デフォルト服画像を使う場合はpublic/assets/clothing/に配置して以下のように定義
// 例:
// {
//   id: 'top-1',
//   name: '青いTシャツ',
//   type: 'top',
//   imageUrl: `${BASE_PATH}assets/clothing/top-1.png`,
//   position: { x: 0, y: -30 },
//   baseZIndex: 20,
//   anchorType: 'torso',
// },

// アイテムの位置をドールサイズに合わせてスケーリング
function scaleItemPosition(
  item: ClothingItemData,
  _dollDimensions: DollDimensions | undefined,
  canvasHeight: number
): ClothingItemData {
  const dollDisplayHeight = canvasHeight * 0.9;
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
  // 設定画面の表示状態
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ドール一覧（デフォルト + カスタム）
  const [allDolls, setAllDolls] = useState<DollData[]>(DEFAULT_DOLLS);

  // 背景一覧（デフォルト + カスタム）
  const [allBackgrounds, setAllBackgrounds] = useState<BackgroundData[]>(DEFAULT_BACKGROUNDS);

  // 服アイテム一覧（デフォルト + カスタム）
  const [allClothing, setAllClothing] = useState<ClothingItemData[]>(DEFAULT_CLOTHING);

  // 現在のドールID
  const [currentDollId, setCurrentDollId] = useState<string>(DEFAULT_DOLLS[0].id);

  // 現在のドール
  const currentDoll = useMemo(() => 
    allDolls.find(d => d.id === currentDollId) || allDolls[0],
    [currentDollId, allDolls]
  );

  // メニュー幅
  const MENU_WIDTH = 340;

  // キャンバスサイズ（iPad横向き最適化）
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 800 });

  // 画面サイズに応じてキャンバスサイズを計算（メニュー幅を除いた中央エリア）
  useEffect(() => {
    const updateCanvasSize = () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      // メニューを除いたエリアの中央に配置
      const availableWidth = vw - MENU_WIDTH - 40; // 左右マージン
      const maxHeight = vh - 80;

      const dollAspect = 0.5;
      let height = maxHeight;
      let width = height * dollAspect;

      if (width > availableWidth) {
        width = availableWidth;
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
    const customDolls = loadCustomDolls();
    const customBackgrounds = loadCustomBackgrounds();
    const customClothing = loadCustomClothing();

    setAllDolls([...DEFAULT_DOLLS, ...customDolls]);
    setAllBackgrounds([...DEFAULT_BACKGROUNDS, ...customBackgrounds]);
    setAllClothing([...DEFAULT_CLOTHING, ...customClothing]);
  }, []);

  // 現在のドールに紐付けられたアイテムのみフィルタ
  const filteredClothing = useMemo(() => {
    return allClothing.filter(item => {
      // dollIdがない（デフォルト）アイテムは全ドールで表示
      if (!item.dollId) return true;
      // dollIdがある場合は現在のドールのみ
      return item.dollId === currentDollId;
    });
  }, [allClothing, currentDollId]);

  // アイテムをスケーリング
  const scaledItems = useMemo(() => {
    return filteredClothing.map(item =>
      scaleItemPosition(item, currentDoll.dimensions, canvasSize.height)
    );
  }, [filteredClothing, currentDoll.dimensions, canvasSize.height]);

  // スケーリングされた下着
  const scaledUnderwear = useMemo(() => {
    return DEFAULT_UNDERWEAR.map(item =>
      scaleItemPosition(item, currentDoll.dimensions, canvasSize.height)
    );
  }, [currentDoll.dimensions, canvasSize.height]);

  // 着せ替え状態管理フック
  const { equipItem, getEquippedItems, resetAll } = useDressUp(scaledItems, scaledUnderwear);

  // 装備中のアイテム
  const equippedItems = getEquippedItems();

  // 服をドロップした時の処理
  const handleItemDrop = useCallback(
    (item: ClothingItemData) => {
      const scaledItem = scaledItems.find(i => i.id === item.id) || item;
      equipItem(scaledItem);
    },
    [equipItem, scaledItems]
  );

  // リセット
  const handleReset = useCallback(() => {
    resetAll();
  }, [resetAll]);

  // ドール切り替え
  const handleDollChange = useCallback((dollId: string) => {
    setCurrentDollId(dollId);
    resetAll();
  }, [resetAll]);

  // 背景ID
  const [currentBackgroundId, setCurrentBackgroundId] = useState<string | null>(null);

  // ドール位置・スケール調整
  const [dollTransform, setDollTransform] = useState<DollTransform>({ x: 50, y: 50, scale: 1.0 });
  const [showDollControls, setShowDollControls] = useState(false);

  // 現在の背景
  const currentBackground = useMemo(() => 
    currentBackgroundId ? allBackgrounds.find(bg => bg.id === currentBackgroundId) : null,
    [currentBackgroundId, allBackgrounds]
  );

  // 背景切り替え
  const handleBackgroundChange = useCallback((bgId: string | null) => {
    setCurrentBackgroundId(bgId);
  }, []);

  // カスタムドール更新（SettingsPanelから呼ばれる）
  const handleDollsChange = useCallback((newDolls: DollData[]) => {
    // 新規追加されたドール（既存にないもの）をマージ
    setAllDolls(prev => {
      const existingIds = new Set(prev.map(d => d.id));
      const uniqueNew = newDolls.filter(d => !existingIds.has(d.id));
      return [...prev, ...uniqueNew];
    });
  }, []);

  // カスタム背景更新（SettingsPanelから呼ばれる）
  const handleBackgroundsChange = useCallback((newBgs: BackgroundData[]) => {
    // 新規追加された背景（既存にないもの）をマージ
    setAllBackgrounds(prev => {
      const existingIds = new Set(prev.map(b => b.id));
      const uniqueNew = newBgs.filter(b => !existingIds.has(b.id));
      return [...prev, ...uniqueNew];
    });
  }, []);

  // カスタム服更新（SettingsPanelから呼ばれる）
  const handleClothingChange = useCallback((newItems: ClothingItemData[]) => {
    // 新規追加された服（既存にないもの）をマージ
    setAllClothing(prev => {
      const existingIds = new Set(prev.map(i => i.id));
      const uniqueNew = newItems.filter(i => !existingIds.has(i.id));
      return [...prev, ...uniqueNew];
    });
  }, []);

  return (
    <div className="app">
      {/* バージョン表示 */}
      <div className="version-badge">v{APP_VERSION}</div>

      {/* 設定ボタン - 位置調整中は非表示 */}
      {!showDollControls && (
        <button
          className="settings-button"
          onClick={() => setIsSettingsOpen(true)}
          title="せってい"
        >
          ⚙️
        </button>
      )}

      {/* ドール調整ボタン */}
      <button
        className={`doll-control-button ${showDollControls ? 'active' : ''}`}
        onClick={() => setShowDollControls(!showDollControls)}
        title={showDollControls ? '調整を終了' : 'ドール調整'}
      >
        {showDollControls ? '✓' : '📐'}
      </button>

      <main className="app-main">
        {/* ドール表示エリア */}
        {/* 背景をドールエリア全体に表示 */}
        {currentBackground && (
          <div
            className="background-layer"
            style={{
              backgroundImage: `url(${currentBackground.imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}

        <section className={`avatar-section ${showDollControls ? 'adjusting' : ''}`}>
          {isTestMode ? (
            <div
              id="avatar-canvas"
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
              dollTransform={dollTransform}
            />
          )}

          {/* ドール調整パネル（キャンバス上に表示） */}
          {showDollControls && (
            <DollControlPanel
              transform={dollTransform}
              onChange={setDollTransform}
              isVisible={showDollControls}
              canvasWidth={canvasSize.width}
              canvasHeight={canvasSize.height}
            />
          )}
        </section>

        {/* ドレスアップメニュー - 位置調整中は非表示 */}
        {!showDollControls && (
          <section className="palette-section">
            <DressUpMenu
              items={filteredClothing}
              onItemDrop={handleItemDrop}
              equippedItems={equippedItems}
              onReset={handleReset}
              dolls={allDolls}
              currentDollId={currentDollId}
              onDollChange={handleDollChange}
              dropTargetId="avatar-canvas"
              backgrounds={allBackgrounds}
              currentBackgroundId={currentBackgroundId}
              onBackgroundChange={handleBackgroundChange}
            />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>ドラッグしてドールにきせてね！</p>
      </footer>

      {/* 設定パネル */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        dolls={allDolls}
        backgrounds={allBackgrounds}
        clothingItems={allClothing}
        onDollsChange={handleDollsChange}
        onBackgroundsChange={handleBackgroundsChange}
        onClothingChange={handleClothingChange}
      />
    </div>
  );
}

export default App;
