/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 * 
 * iPad 10.3横向き（2360x1640）最適化
 * GitHub Pages（無料）で画像配信
 */
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { AvatarCanvas, DressUpMenu, DollControlPanel } from './components';
import { SettingsPanel } from './components/SettingsPanel';
import { useDressUp } from './hooks/useDressUp';
import {
  loadCustomDolls,
  loadCustomBackgrounds,
  loadCustomClothing,
  restoreDollImages,
  restoreBackgroundImages,
  restoreClothingImages,
} from './services/assetStorage';
import type { ClothingItemData, DollData, DollDimensions, BackgroundData, DollTransform, Position } from './types';
import './App.css';

// アプリバージョン
const APP_VERSION = '0.7.0';

// E2Eテスト時はPixiJSを無効化するフラグ
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// デフォルトのドールリスト（空 - プリセットからインポート）
const DEFAULT_DOLLS: DollData[] = [];

// デフォルトの背景リスト（空 - ユーザーが追加）
const DEFAULT_BACKGROUNDS: BackgroundData[] = [];

// ドールが未登録でも落ちないためのフォールバック寸法
// メニュー幅（px）
const MENU_WIDTH = 160;

const FALLBACK_DOLL_DIMENSIONS: DollDimensions = {
  width: 400,
  height: 800,
  anchorPoints: {
    headTop: { x: 0.5, y: 0.05 },
    neckCenter: { x: 0.5, y: 0.18 },
    torsoCenter: { x: 0.5, y: 0.4 },
    hipCenter: { x: 0.5, y: 0.55 },
    footBottom: { x: 0.5, y: 0.98 },
  },
};

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

  // 現在のドールID（ドール0件を許容）
  const [currentDollId, setCurrentDollId] = useState<string>(DEFAULT_DOLLS[0]?.id ?? '');

  // 現在のドール（0件ならnull）
  const currentDoll = useMemo(() => {
    if (allDolls.length === 0) return null;
    return allDolls.find(d => d.id === currentDollId) ?? allDolls[0];
  }, [currentDollId, allDolls]);

  // メニュー幅はコンポーネント外で定義済み

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

  // 初期化時にカスタムアイテムを読み込み（IndexedDBから画像を復元）
  useEffect(() => {
    const loadCustomData = async () => {
      try {
        // LocalStorageからメタデータを読み込み
        const customDolls = loadCustomDolls();
        const customBackgrounds = loadCustomBackgrounds();
        const customClothing = loadCustomClothing();

        // IndexedDBから画像を復元
        const restoredDolls = await restoreDollImages(customDolls);
        const restoredBackgrounds = await restoreBackgroundImages(customBackgrounds);
        const restoredClothing = await restoreClothingImages(customClothing);

        setAllDolls([...DEFAULT_DOLLS, ...restoredDolls]);
        setAllBackgrounds([...DEFAULT_BACKGROUNDS, ...restoredBackgrounds]);
        setAllClothing([...DEFAULT_CLOTHING, ...restoredClothing]);
      } catch (error) {
        console.error('カスタムデータ読み込みエラー:', error);
      }
    };

    loadCustomData();
  }, []);

  // ドールが読み込まれたら、先頭を初期ドールとして選択
  useEffect(() => {
    if (allDolls.length === 0) {
      if (currentDollId !== '') setCurrentDollId('');
      return;
    }
    const exists = allDolls.some(d => d.id === currentDollId);
    if (!exists) {
      setCurrentDollId(allDolls[0].id);
    }
  }, [allDolls, currentDollId]);

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
  const activeDimensions = currentDoll?.dimensions ?? FALLBACK_DOLL_DIMENSIONS;

  const scaledItems = useMemo(() => {
    if (!currentDoll) return [];
    return filteredClothing.map(item => scaleItemPosition(item, activeDimensions, canvasSize.height));
  }, [filteredClothing, activeDimensions, canvasSize.height, currentDoll]);

  // スケーリングされた下着
  const scaledUnderwear = useMemo(() => {
    if (!currentDoll) return [];
    return DEFAULT_UNDERWEAR.map(item => scaleItemPosition(item, activeDimensions, canvasSize.height));
  }, [activeDimensions, canvasSize.height, currentDoll]);

  // 着せ替え状態管理フック
  const { equipItem, unequipItem, getEquippedItems, resetAll } = useDressUp(scaledItems, scaledUnderwear);

  // 装備中のアイテム
  const equippedItems = getEquippedItems();

  // 服をドロップした時の処理（全アイテム通常装着）
  const handleItemDrop = useCallback(
    (item: ClothingItemData) => {
      if (!currentDoll) return;
      const scaledItem = scaledItems.find(i => i.id === item.id) || item;
      equipItem(scaledItem);
      setDraggingPreview(null);
    },
    [equipItem, scaledItems, currentDoll]
  );

  // アイテムドラッグ中のコールバック（全アイテム対象）
  const handleDragMove = useCallback((item: ClothingItemData, position: Position) => {
    if (!avatarSectionRef.current) return;
    const rect = avatarSectionRef.current.getBoundingClientRect();
    // ドラッグ位置がavatar-section内かチェック
    if (
      position.x >= rect.left &&
      position.x <= rect.right &&
      position.y >= rect.top &&
      position.y <= rect.bottom
    ) {
      setDraggingPreview({ item, position });
    } else {
      setDraggingPreview(null);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingPreview(null);
  }, []);

  // 服を脱がせる処理（「なし」選択時）
  const handleItemRemove = useCallback(
    (type: string) => {
      unequipItem(type);
    },
    [unequipItem]
  );

  // リセット
  const handleReset = useCallback(() => {
    resetAll();
  }, [resetAll]);

  // ドール切り替え
  const handleDollChange = useCallback(
    (dollId: string) => {
      setCurrentDollId(dollId);
      resetAll();
    },
    [resetAll]
  );

  // 背景ID
  const [currentBackgroundId, setCurrentBackgroundId] = useState<string | null>(null);

  // ドール位置・スケール調整
  // x: メニューを除いた領域の中央（メニュー幅%の半分 + 残り幅の中央）
  const menuWidthPercent = (MENU_WIDTH / window.innerWidth) * 100;
  const initialDollX = menuWidthPercent + (100 - menuWidthPercent) / 2;
  const [dollTransform, setDollTransform] = useState<DollTransform>({ x: initialDollX, y: 50, scale: 1.0 });

  const currentDollSafe = currentDoll ?? (allDolls[0] ?? null);
  const [showDollControls, setShowDollControls] = useState(false);

  // movableアイテムのドラッグ中プレビュー用
  const [draggingPreview, setDraggingPreview] = useState<{
    item: ClothingItemData;
    position: Position;
  } | null>(null);
  const avatarSectionRef = useRef<HTMLElement>(null);

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
    // プリセット取り込みは「全上書き」なので、そのまま置き換える
    setAllDolls(newDolls);
  }, []);

  // カスタム背景更新（SettingsPanelから呼ばれる）
  const handleBackgroundsChange = useCallback((newBgs: BackgroundData[]) => {
    // プリセット取り込みは「全上書き」なので、そのまま置き換える
    setAllBackgrounds(newBgs);
  }, []);

  // カスタム服更新（SettingsPanelから呼ばれる）
  const handleClothingChange = useCallback((newItems: ClothingItemData[]) => {
    // プリセット取り込みは「全上書き」なので、そのまま置き換える
    setAllClothing(newItems);
  }, []);

  return (
    <div className="app">
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
        {/* ドールが存在する場合のみ表示 */}
        {currentDollSafe && (
          <section 
            ref={avatarSectionRef}
            className={`avatar-section ${showDollControls ? 'adjusting' : ''}`}
          >
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
                dollImageUrl={currentDollSafe.bodyImageUrl}
                backgroundImageUrl={currentBackground?.imageUrl}
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

            {/* アイテムドラッグ中のプレビュー（サムネイル表示） */}
            {draggingPreview && avatarSectionRef.current && (() => {
              const rect = avatarSectionRef.current.getBoundingClientRect();
              const left = draggingPreview.position.x - rect.left;
              const top = draggingPreview.position.y - rect.top;
              return (
                <img
                  src={draggingPreview.item.thumbnailUrl || draggingPreview.item.imageUrl}
                  alt={draggingPreview.item.name}
                  style={{
                    position: 'absolute',
                    left: left,
                    top: top,
                    transform: 'translate(-50%, -50%)',
                    maxWidth: '120px',
                    maxHeight: '120px',
                    opacity: 0.8,
                    pointerEvents: 'none',
                    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
                    zIndex: 100,
                  }}
                />
              );
            })()}
          </section>
        )}

        {/* ドレスアップメニュー - 位置調整中は非表示 */}
        {!showDollControls && (
          <section className="palette-section">
            <DressUpMenu
              items={filteredClothing}
              onItemDrop={handleItemDrop}
              onItemRemove={handleItemRemove}
              equippedItems={equippedItems}
              onReset={handleReset}
              dolls={allDolls}
              currentDollId={currentDollId}
              onDollChange={handleDollChange}
              dropTargetId="avatar-canvas"
              backgrounds={allBackgrounds}
              currentBackgroundId={currentBackgroundId}
              onBackgroundChange={handleBackgroundChange}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
            />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>ドラッグしてドールにきせてね！</p>
        <span className="version-badge">v{APP_VERSION}</span>
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
