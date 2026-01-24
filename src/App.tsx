/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 * 
 * iPad 10.3横向き（2360x1640）最適化
 * GitHub Pages（無料）で画像配信
 */
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { AvatarCanvas, DressUpMenu, ItemAdjustPanel, DrawingCanvas, EraserCanvas } from './components';
import type { AvatarCanvasHandle } from './components';
import { SettingsPanel } from './components/SettingsPanel';
import { useDressUp } from './hooks/useDressUp';
import type { ItemAdjustment } from './hooks/useDressUp';
import {
  loadCustomDolls,
  loadCustomBackgrounds,
  loadCustomClothing,
  restoreDollImages,
  restoreBackgroundImages,
  restoreClothingImages,
} from './services/assetStorage';
import {
  saveEquippedItems,
  loadEquippedItems,
  loadDollTransform,
  saveDollTransform,
  saveCurrentDollId,
  loadCurrentDollId,
  saveCurrentBackgroundId,
  loadCurrentBackgroundId,
} from './services/stateStorage';
import type { ClothingItemData, DollData, DollDimensions, BackgroundData, DollTransform, Position } from './types';
import { DEFAULT_DOLL_TRANSFORM } from './types';
import './App.css';

// アプリバージョン
const APP_VERSION = '0.9.6';

// E2Eテスト時はPixiJSを無効化するフラグ
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test=true');

// デフォルトのドールリスト（空 - プリセットからインポート）
const DEFAULT_DOLLS: DollData[] = [];

// デフォルトの背景リスト（空 - ユーザーが追加）
const DEFAULT_BACKGROUNDS: BackgroundData[] = [];

// ドールが未登録でも落ちないためのフォールバック寸法
// メニュー幅（px）
const MENU_WIDTH = 160;
// 右ボタン領域幅（px）- ボタン44px + 余白16px
const RIGHT_BUTTON_WIDTH = 60;

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
  // キャンバスへの参照
  const avatarCanvasRef = useRef<AvatarCanvasHandle>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // 設定画面の表示状態
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // お絵描きモード（現在未使用）
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  // 消しゴムモード（現在未使用）
  const [isEraserMode, setIsEraserMode] = useState(false);
  // クロマキー（グリーンバック透過）常時ON
  const chromaKeyEnabled = true;

  // ドール一覧（デフォルト + カスタム）
  const [allDolls, setAllDolls] = useState<DollData[]>(DEFAULT_DOLLS);

  // 背景一覧（デフォルト + カスタム）
  const [allBackgrounds, setAllBackgrounds] = useState<BackgroundData[]>(DEFAULT_BACKGROUNDS);

  // 服アイテム一覧（デフォルト + カスタム）
  const [allClothing, setAllClothing] = useState<ClothingItemData[]>(DEFAULT_CLOTHING);

  // 保存されたドールID・背景IDを復元
  const savedDollId = loadCurrentDollId();
  const savedBackgroundId = loadCurrentBackgroundId();

  // 現在のドールID（保存から復元、なければデフォルト）
  const [currentDollId, setCurrentDollId] = useState<string>(savedDollId ?? DEFAULT_DOLLS[0]?.id ?? '');

  // 現在の背景ID（保存から復元）
  const [currentBackgroundId, setCurrentBackgroundId] = useState<string | null>(savedBackgroundId);

  // 現在のドール（0件ならnull）
  const currentDoll = useMemo(() => {
    if (allDolls.length === 0) return null;
    return allDolls.find(d => d.id === currentDollId) ?? allDolls[0];
  }, [currentDollId, allDolls]);

  // メニュー幅はコンポーネント外で定義済み
  // 下部メニュー高さ（縦画面用）
  const BOTTOM_MENU_HEIGHT = 140;

  // キャンバスサイズ（メニュー以外の画面いっぱい）
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 800 });
  
  // 縦画面判定
  const [isPortrait, setIsPortrait] = useState(false);

  // 画面サイズに応じてキャンバスサイズを計算（メニュー幅を除いた全体）
  // CSS変数も同時に更新してレイアウト全体を制御
  useEffect(() => {
    const updateCanvasSize = () => {
      // visualViewportを優先使用（iPad Safari対応）
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const vw = window.visualViewport?.width ?? window.innerWidth;
      
      // 縦画面判定（幅768px以下かつ縦長）
      const portrait = vw <= 768 && vh > vw;
      setIsPortrait(portrait);

      // CSS変数に実際のビューポートサイズを設定
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      document.documentElement.style.setProperty('--app-width', `${vw}px`);
      document.documentElement.style.setProperty('--is-portrait', portrait ? '1' : '0');

      // 縦画面：下部メニュー分を引く / 横画面：左メニュー分を引く
      const width = portrait ? vw : vw - MENU_WIDTH;
      const height = portrait ? vh - BOTTOM_MENU_HEIGHT : vh;

      setCanvasSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    window.addEventListener('orientationchange', updateCanvasSize);
    // visualViewportのリサイズも監視（iPad Safariのアドレスバー表示/非表示）
    window.visualViewport?.addEventListener('resize', updateCanvasSize);
    window.visualViewport?.addEventListener('scroll', updateCanvasSize);
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      window.removeEventListener('orientationchange', updateCanvasSize);
      window.visualViewport?.removeEventListener('resize', updateCanvasSize);
      window.visualViewport?.removeEventListener('scroll', updateCanvasSize);
    };
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

  // 保存された装備アイテム（初期化時に1回だけ読み込み）
  const savedEquipped = useMemo(() => loadEquippedItems(), []);

  // 着せ替え状態管理フック（保存された装備を渡す）
  const { equipItem, unequipItem, getEquippedItems, resetAll, updateItemAdjustment } = useDressUp(scaledItems, scaledUnderwear, savedEquipped);

  // 装備中のアイテム
  const equippedItems = getEquippedItems();

  // 装備変更時に保存
  useEffect(() => {
    saveEquippedItems(equippedItems);
  }, [equippedItems]);

  // パフォーマンス最適化：描画安定後にレンダリングループを停止
  // 操作がなければTickerを停止してCPU/GPU負荷を削減
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    // 前回のタイマーをキャンセル
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
    }
    
    // レンダリングを再開（操作があった）
    avatarCanvasRef.current?.resumeRendering();
    
    // 1秒後にレンダリングを一時停止
    pauseTimerRef.current = setTimeout(() => {
      avatarCanvasRef.current?.pauseRendering();
    }, 1000);
    
    return () => {
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
      }
    };
  }, [equippedItems]);  // 装備が変わった時に再開→停止

  // アイテム調整モード（adjustingItemId === null の場合はドール調整モード）
  const [isAdjustingItem, setIsAdjustingItem] = useState(false);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);

  // 調整中のアイテム（IDが変わった時のみ再計算）- nullの場合はドール調整
  const adjustingItem = useMemo(() => {
    if (adjustingItemId === null) return null;  // ドール調整モード
    return equippedItems.find(item => item.id === adjustingItemId) ?? null;
  }, [adjustingItemId, equippedItems]);

  // 装備アイテムをRefで保持（即座にアクセスするため）
  const equippedItemsRef = useRef(equippedItems);
  equippedItemsRef.current = equippedItems;

  // 調整ボタンクリックで調整モード開始
  const handleAdjustButtonClick = useCallback(() => {
    // 既に調整モード中は無視
    if (isAdjustingItem) return;
    
    // Refから直接取得
    const items = equippedItemsRef.current;
    
    if (items.length === 0) {
      // 服がない場合のみドール調整モードに入る
      setAdjustingItemId(null);
      setIsAdjustingItem(true);
      return;
    }
    
    // 最後に着せたアイテムを取得（最大equipOrder）
    const lastItem = items.reduce((latest, item) =>
      item.equipOrder > latest.equipOrder ? item : latest
    );
    
    // 即座にアイテム調整モードに入る
    setAdjustingItemId(lastItem.id);
    setIsAdjustingItem(true);
  }, [isAdjustingItem]);

  // アイテム調整値を更新（useRefで安定化）
  const adjustingItemIdRef = useRef(adjustingItemId);
  adjustingItemIdRef.current = adjustingItemId;
  
  const handleItemAdjust = useCallback((adjustment: ItemAdjustment) => {
    const itemId = adjustingItemIdRef.current;
    if (itemId) {
      updateItemAdjustment(itemId, adjustment);
    }
  }, [updateItemAdjustment]);

  // 調整モード終了
  const handleAdjustClose = useCallback(() => {
    setIsAdjustingItem(false);
    setAdjustingItemId(null);
  }, []);

  // スクリーンショットを撮影して保存（Web Share API対応）
  const handleScreenshot = useCallback(async () => {
    if (!avatarCanvasRef.current) return;
    
    try {
      const dataUrl = await avatarCanvasRef.current.takeScreenshot();
      if (!dataUrl) return;
      
      // Data URL を Blob に変換
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const fileName = `dressup-${Date.now()}.png`;
      
      // Web Share API が使えるかチェック（iOS/iPadOS Safari対応）
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'image/png' });
        const shareData = { files: [file] };
        
        // ファイル共有がサポートされているかチェック
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            return; // 共有成功
          } catch (shareError) {
            // ユーザーがキャンセルした場合は何もしない
            if ((shareError as Error).name === 'AbortError') {
              return;
            }
            // その他のエラーはフォールバックへ
            console.log('共有失敗、ダウンロードにフォールバック');
          }
        }
      }
      
      // フォールバック: 従来のダウンロード方式
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('スクリーンショット保存エラー:', error);
    }
  }, []);

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
    // 背景もクリア
    setCurrentBackgroundId(null);
    saveCurrentBackgroundId(null);
  }, [resetAll]);

  // ドール切り替え（保存も行う）
  const handleDollChange = useCallback(
    (dollId: string) => {
      setCurrentDollId(dollId);
      saveCurrentDollId(dollId);
      resetAll();
    },
    [resetAll]
  );

  // ドール位置・スケール調整
  // デフォルトは背景中央（DEFAULT_DOLL_TRANSFORMを使用）
  const [dollTransform, setDollTransform] = useState<DollTransform>(() => {
    const saved = loadDollTransform();
    return saved ?? DEFAULT_DOLL_TRANSFORM;
  });

  // ドール位置変更時に保存
  useEffect(() => {
    saveDollTransform(dollTransform);
  }, [dollTransform]);

  const currentDollSafe = currentDoll ?? (allDolls[0] ?? null);

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

  // 背景切り替え（保存も行う）
  const handleBackgroundChange = useCallback((bgId: string | null) => {
    setCurrentBackgroundId(bgId);
    saveCurrentBackgroundId(bgId);
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
      {/* 右下ボタングループ - 調整中は非表示 */}
      {!isAdjustingItem && (
        <div className="bottom-right-buttons">
          {/* リセットボタン（服を着ている場合のみ表示） */}
          {equippedItems.filter(i => i.type !== 'underwear_top' && i.type !== 'underwear_bottom').length > 0 && (
            <button
              className="reset-button-fixed"
              onClick={() => {
                if (window.confirm('きせかえをリセットしますか？')) {
                  handleReset();
                }
              }}
              title="リセット"
            >
              🔄
            </button>
          )}
          {/* 設定ボタン */}
          <button
            className="settings-button"
            onClick={() => setIsSettingsOpen(true)}
            title="せってい"
          >
            ⚙️
          </button>
        </div>
      )}

      <main className="app-main">
        {/* ドールが存在する場合のみ表示 */}
        {currentDollSafe && (
          <section 
            ref={avatarSectionRef}
            className="avatar-section"
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
                ref={avatarCanvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                equippedItems={equippedItems}
                dollImageUrl={currentDollSafe.bodyImageUrl}
                backgroundImageUrl={currentBackground?.imageUrl}
                dollTransform={dollTransform}
                menuOffset={isPortrait ? 0 : MENU_WIDTH}
                rightOffset={isPortrait ? 0 : RIGHT_BUTTON_WIDTH}
                chromaKeyEnabled={chromaKeyEnabled}
                adjustingItemId={isAdjustingItem ? adjustingItemId : null}
                isPortrait={isPortrait}
              />
            )}

            {/* お絵描きキャンバス */}
            <DrawingCanvas
              width={canvasSize.width}
              height={canvasSize.height}
              isActive={isDrawingMode}
              onClose={() => setIsDrawingMode(false)}
              canvasRef={drawingCanvasRef}
            />

            {/* 消しゴムキャンバス */}
            <EraserCanvas
              width={canvasSize.width}
              height={canvasSize.height}
              isActive={isEraserMode}
              onClose={() => setIsEraserMode(false)}
            />

            {/* 消しゴムマスクはPixiEngine側で処理 */}

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

        {/* ツールボタン（調整モードでないとき表示）- avatar-sectionの外に配置 */}
        {currentDollSafe && !isAdjustingItem && !isDrawingMode && !isEraserMode && (
          <div className="tool-buttons">
            <button
              className="tool-button"
              onClick={handleAdjustButtonClick}
              title={equippedItems.length > 0 ? '服を調整' : 'ドール調整'}
            >
              {equippedItems.length > 0 ? '👗' : '📐'}
            </button>
            <button
              className="tool-button"
              onClick={handleScreenshot}
              title="スクショ"
            >
              📷
            </button>
          </div>
        )}

        {/* ドレスアップメニュー - アイテム調整中は非表示 */}
        {!isAdjustingItem && (
          <section className={`palette-section ${isPortrait ? 'palette-section--portrait' : ''}`}>
            <DressUpMenu
              items={filteredClothing}
              onItemDrop={handleItemDrop}
              onItemRemove={handleItemRemove}
              equippedItems={equippedItems}
              dolls={allDolls}
              currentDollId={currentDollId}
              onDollChange={handleDollChange}
              dropTargetId="avatar-canvas"
              backgrounds={allBackgrounds}
              currentBackgroundId={currentBackgroundId}
              onBackgroundChange={handleBackgroundChange}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onBackgroundDragEnd={handleDragEnd}
              isPortrait={isPortrait}
            />

            {/* バージョン表示（メニュー下、横画面のみ） */}
            {!isPortrait && <div className="version-badge">v{APP_VERSION}</div>}
          </section>
        )}
      </main>

      {/* フッター - 調整中は非表示 */}
      {!isAdjustingItem && (
        <footer className="app-footer">
          <p>ドラッグしてドールにきせてね！</p>
        </footer>
      )}

      {/* アイテム/ドール調整オーバーレイ（画面全体） */}
      {isAdjustingItem && (
        <ItemAdjustPanel
          item={adjustingItem}
          onAdjust={handleItemAdjust}
          onClose={handleAdjustClose}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          dollTransform={dollTransform}
          onDollTransformChange={setDollTransform}
          menuOffset={isPortrait ? 0 : MENU_WIDTH}
          rightOffset={isPortrait ? 0 : RIGHT_BUTTON_WIDTH}
          dollImageUrl={currentDollSafe?.bodyImageUrl}
          isPortrait={isPortrait}
        />
      )}

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
