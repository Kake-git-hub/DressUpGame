/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 *
 * iPad 横向き専用。
 * ドール・服・背景の画像は、別リポジトリ（DressUpGame-content）から配信されたものを読む。
 */
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { AvatarCanvas, DressUpMenu, ItemAdjustPanel, DragPreviewLayer } from './components';
import type { AvatarCanvasHandle, DragPreviewHandle } from './components';
import { useDressUp } from './hooks/useDressUp';
import type { ItemAdjustment } from './hooks/useDressUp';
import { loadContent, resolveContentUrl } from './content/loadContent';
import { cleanupLegacyData, deleteLegacyDatabase } from './content/legacyCleanup';
import { resolveStartState } from './content/startState';
import { contentUrlsForDoll, prefetchUrls, waitForServiceWorkerControl } from './content/prefetch';
import {
  loadDollTransform,
  saveDollTransform,
  saveCurrentDollId,
  loadCurrentDollId,
  saveCurrentBackgroundId,
  loadCurrentBackgroundId,
} from './services/stateStorage';
import { saveOutfit, loadOutfit } from './services/outfitStorage';
import type { ClothingItemData, DollData, BackgroundData, DollTransform, Position } from './types';
import { DEFAULT_DOLL_TRANSFORM } from './types';
import './App.css';

// アプリバージョン
const APP_VERSION = '0.12.0';

// メニュー幅（px）
const MENU_WIDTH = 160;
// 右ボタン領域幅（px）- ボタン44px + 余白16px
const RIGHT_BUTTON_WIDTH = 60;

// 旧方式（アプリ内取り込み）のデータを、状態を読む前に片付ける
cleanupLegacyData();

// 素材の置き場所
const CONTENT_URL = resolveContentUrl(window.location.search, window.location.href);
// 画面が出てから先読みを始めるまでの待ち時間（最初の表示を邪魔しない）
const PREFETCH_DELAY_MS = 3000;
// サービスワーカーの準備を待つ上限（初回は本体のダウンロードが終わるまでかかる）
const SERVICE_WORKER_WAIT_MS = 60_000;

type LoadState = 'loading' | 'ready' | 'error';

function App() {
  // キャンバスへの参照
  const avatarCanvasRef = useRef<AvatarCanvasHandle>(null);

  // 配信された素材
  const [allDolls, setAllDolls] = useState<DollData[]>([]);
  const [allBackgrounds, setAllBackgrounds] = useState<BackgroundData[]>([]);
  const [allClothing, setAllClothing] = useState<ClothingItemData[]>([]);

  // 素材の読み込み状態（装備の復元と保存の開始条件でもある）
  const [loadState, setLoadState] = useState<LoadState>('loading');
  // 「もういちど」を押すたびに増やして、読み込みをやり直す
  const [loadAttempt, setLoadAttempt] = useState(0);

  // 現在のドールID・背景ID（保存から復元）
  const [currentDollId, setCurrentDollId] = useState<string>(() => loadCurrentDollId() ?? '');
  const [currentBackgroundId, setCurrentBackgroundId] = useState<string | null>(() => loadCurrentBackgroundId());

  // 現在のドール（0件ならnull）
  const currentDoll = useMemo(() => {
    if (allDolls.length === 0) return null;
    return allDolls.find(d => d.id === currentDollId) ?? allDolls[0];
  }, [currentDollId, allDolls]);

  // キャンバスサイズ（画面いっぱい。メニューとボタンの分は描画側で差し引く）
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 800 });

  // 画面サイズに応じてキャンバスサイズを計算
  // CSS変数も同時に更新してレイアウト全体を制御
  useEffect(() => {
    const updateCanvasSize = () => {
      // visualViewportを優先使用（iPad Safari対応）
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const vw = window.visualViewport?.width ?? window.innerWidth;

      // CSS変数に実際のビューポートサイズを設定
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      document.documentElement.style.setProperty('--app-width', `${vw}px`);

      setCanvasSize({ width: Math.floor(vw), height: Math.floor(vh) });
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

  // 現在のドールの素材を先読みして、オフラインでも遊べるようにする
  useEffect(() => {
    if (loadState !== 'ready' || !currentDoll) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      // キャッシュに入るよう、サービスワーカーの準備を待ってから始める
      await waitForServiceWorkerControl(SERVICE_WORKER_WAIT_MS);
      if (cancelled) return;
      await prefetchUrls(contentUrlsForDoll(CONTENT_URL, currentDoll, allClothing, allBackgrounds));
      // 完了の目印（オフライン動作のテストが待ち合わせに使う）
      if (!cancelled) document.documentElement.dataset.prefetch = currentDoll.id;
    }, PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadState, currentDoll, allClothing, allBackgrounds]);

  // 着せ替え状態管理フック（選べる服の絞り込みはメニュー側で行う）
  const { equipItem, unequipItem, unequipItemById, equippedItems, resetAll, updateItemAdjustment, restoreEquipped } = useDressUp();

  // 保存された装備（ID・調整値のみ）。素材の読み込み完了時に1回だけ復元する
  const savedOutfitRef = useRef<ReturnType<typeof loadOutfit> | null>(null);
  if (savedOutfitRef.current === null) savedOutfitRef.current = loadOutfit();

  // 配信された素材の一覧を読み込む
  useEffect(() => {
    let cancelled = false;
    loadContent(CONTENT_URL)
      .then((content) => {
        if (cancelled) return;
        setAllDolls(content.dolls);
        setAllBackgrounds(content.backgrounds);
        setAllClothing(content.clothing);
        // 保存されていたドール・背景・服装を、いまの素材と突き合わせて決める
        const start = resolveStartState(content, loadCurrentDollId(), loadCurrentBackgroundId(), savedOutfitRef.current ?? []);
        setCurrentDollId(start.dollId);
        saveCurrentDollId(start.dollId);
        setCurrentBackgroundId(start.backgroundId);
        saveCurrentBackgroundId(start.backgroundId);
        if (start.outfit.length > 0) restoreEquipped(start.outfit);
        setLoadState('ready');
        // 新しい素材が読めたので、旧方式の画像データベースを片付ける
        deleteLegacyDatabase();
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('素材の読み込みエラー:', error);
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, restoreEquipped]);

  const handleRetryLoad = useCallback(() => {
    setLoadState('loading');
    setLoadAttempt((n) => n + 1);
  }, []);

  // 現在のドールの服だけ
  const filteredClothing = useMemo(() => {
    return allClothing.filter(item => !item.dollId || item.dollId === currentDoll?.id);
  }, [allClothing, currentDoll]);

  // 現在のドールの背景（共通の背景を含む）
  const filteredBackgrounds = useMemo(() => {
    return allBackgrounds.filter(bg => !bg.dollId || bg.dollId === currentDoll?.id);
  }, [allBackgrounds, currentDoll]);

  // 装備変更時に保存。
  // 復元直後の状態は保存しない: 欠けた（または空の）服装が保存済みデータを
  // 上書きしてしまうのを防ぐ。復元後に装備が変わったとき（＝ユーザーの操作）だけ保存する。
  const outfitBaselineRef = useRef<typeof equippedItems | null>(null);
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (outfitBaselineRef.current === null) {
      outfitBaselineRef.current = equippedItems;
      return;
    }
    if (outfitBaselineRef.current === equippedItems) return;
    saveOutfit(equippedItems);
  }, [equippedItems, loadState]);

  // パフォーマンス最適化：描画安定後にレンダリングループを停止
  // 操作がなければTickerを停止してCPU/GPU負荷を削減
  useEffect(() => {
    avatarCanvasRef.current?.resumeRendering();
    const timer = setTimeout(() => {
      avatarCanvasRef.current?.pauseRendering();
    }, 1000);
    return () => clearTimeout(timer);
  }, [equippedItems]);

  // アイテム調整モード（adjustingItemId === null の場合はドール調整モード）
  const [isAdjustingItem, setIsAdjustingItem] = useState(false);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);

  // 調整中のアイテム - nullの場合はドール調整
  const adjustingItem = useMemo(() => {
    if (adjustingItemId === null) return null;
    return equippedItems.find(item => item.id === adjustingItemId) ?? null;
  }, [adjustingItemId, equippedItems]);

  // 調整ボタンクリックで調整モード開始
  const handleAdjustButtonClick = useCallback(() => {
    if (isAdjustingItem) return;

    if (equippedItems.length === 0) {
      // 服がない場合のみドール調整モードに入る
      setAdjustingItemId(null);
      setIsAdjustingItem(true);
      return;
    }

    // 最後に着せたアイテム（最大equipOrder）を調整する
    const lastItem = equippedItems.reduce((latest, item) =>
      item.equipOrder > latest.equipOrder ? item : latest
    );
    setAdjustingItemId(lastItem.id);
    setIsAdjustingItem(true);
  }, [isAdjustingItem, equippedItems]);

  // アイテム調整値を更新
  const handleItemAdjust = useCallback((adjustment: ItemAdjustment) => {
    if (adjustingItemId) {
      updateItemAdjustment(adjustingItemId, adjustment);
    }
  }, [adjustingItemId, updateItemAdjustment]);

  // 調整モード終了
  const handleAdjustClose = useCallback(() => {
    setIsAdjustingItem(false);
    setAdjustingItemId(null);
  }, []);

  // 調整画面の枠の × で、その服を脱がせて調整を終える
  const handleAdjustRemove = useCallback(
    (itemId: string) => {
      unequipItemById(itemId);
      setIsAdjustingItem(false);
      setAdjustingItemId(null);
    },
    [unequipItemById],
  );

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

        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            return; // 共有成功
          } catch (shareError) {
            // ユーザーがキャンセルした場合は何もしない
            if ((shareError as Error).name === 'AbortError') {
              return;
            }
            // その他のエラーはダウンロードへ
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

  // ドラッグ中プレビュー（再レンダリングなしで動かす）
  const dragPreviewRef = useRef<DragPreviewHandle>(null);
  const avatarSectionRef = useRef<HTMLElement>(null);

  // 服をドロップした時の処理（全アイテム通常装着）
  const handleItemDrop = useCallback(
    (item: ClothingItemData) => {
      equipItem(item);
      dragPreviewRef.current?.hide();
    },
    [equipItem]
  );

  // アイテムドラッグ中のコールバック（全アイテム対象）
  const handleDragMove = useCallback((item: ClothingItemData, position: Position) => {
    const preview = dragPreviewRef.current;
    if (!preview || !avatarSectionRef.current) return;
    const rect = avatarSectionRef.current.getBoundingClientRect();
    // ドラッグ位置がavatar-section内のときだけ表示
    if (
      position.x >= rect.left &&
      position.x <= rect.right &&
      position.y >= rect.top &&
      position.y <= rect.bottom
    ) {
      preview.move(item.thumbnailUrl || item.imageUrl, position.x, position.y);
    } else {
      preview.hide();
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    dragPreviewRef.current?.hide();
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
      // 前のドール専用の背景は外す（共通の背景はそのまま）
      const bg = allBackgrounds.find((b) => b.id === currentBackgroundId);
      if (bg?.dollId && bg.dollId !== dollId) {
        setCurrentBackgroundId(null);
        saveCurrentBackgroundId(null);
      }
    },
    [resetAll, allBackgrounds, currentBackgroundId]
  );

  // ドール位置・スケール調整（デフォルトは背景中央）
  const [dollTransform, setDollTransform] = useState<DollTransform>(() => {
    return loadDollTransform() ?? DEFAULT_DOLL_TRANSFORM;
  });

  // ドール位置変更時に保存
  useEffect(() => {
    saveDollTransform(dollTransform);
  }, [dollTransform]);

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

  // 横画面専用: 縦に持ったときの案内（表示の切り替えはCSS）
  const rotateNotice = (
    <div className="rotate-notice" data-testid="rotate-notice">
      <span>📱</span>
      <span>よこにしてね</span>
    </div>
  );

  if (loadState !== 'ready') {
    return (
      <div className="app">
        <div className="status-screen" data-testid="status-screen">
          {loadState === 'loading' ? (
            <p>よみこみちゅう…</p>
          ) : (
            <>
              <p>インターネットにつないでね</p>
              <button onClick={handleRetryLoad}>もういちど</button>
            </>
          )}
        </div>
        {rotateNotice}
      </div>
    );
  }

  return (
    <div className="app">
      {/* 右下ボタングループ - 調整中は非表示 */}
      {!isAdjustingItem && (
        <div className="bottom-right-buttons">
          {/* リセットボタン（服を着ている場合のみ表示） */}
          {equippedItems.length > 0 && (
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
        </div>
      )}

      <main className="app-main">
        {/* ドールが存在する場合のみ表示 */}
        {currentDoll && (
          <section
            ref={avatarSectionRef}
            className="avatar-section"
          >
            <AvatarCanvas
              ref={avatarCanvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              equippedItems={equippedItems}
              doll={currentDoll}
              backgroundImageUrl={currentBackground?.imageUrl}
              dollTransform={dollTransform}
              menuOffset={MENU_WIDTH}
              rightOffset={RIGHT_BUTTON_WIDTH}
              adjustingItemId={isAdjustingItem ? adjustingItemId : null}
            />
          </section>
        )}

        {/* ツールボタン（調整モードでないとき表示）- avatar-sectionの外に配置 */}
        {currentDoll && !isAdjustingItem && (
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
          <section className="palette-section">
            <DressUpMenu
              items={filteredClothing}
              onItemDrop={handleItemDrop}
              onItemRemove={handleItemRemove}
              equippedItems={equippedItems}
              dolls={allDolls}
              currentDollId={currentDoll?.id ?? ''}
              onDollChange={handleDollChange}
              dropTargetId="avatar-canvas"
              backgrounds={filteredBackgrounds}
              currentBackgroundId={currentBackgroundId}
              onBackgroundChange={handleBackgroundChange}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onBackgroundDragEnd={handleDragEnd}
            />

            {/* バージョン表示（メニュー下） */}
            <div className="version-badge">v{APP_VERSION}</div>
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
          key={adjustingItemId ?? 'doll'}
          item={adjustingItem}
          onAdjust={handleItemAdjust}
          onClose={handleAdjustClose}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          dollTransform={dollTransform}
          onDollTransformChange={setDollTransform}
          menuOffset={MENU_WIDTH}
          rightOffset={RIGHT_BUTTON_WIDTH}
          doll={currentDoll}
          equippedItems={equippedItems}
          onRemove={handleAdjustRemove}
          onSelect={setAdjustingItemId}
        />
      )}

      {/* アイテムドラッグ中のプレビュー（サムネイル表示） */}
      <DragPreviewLayer ref={dragPreviewRef} />

      {rotateNotice}
    </div>
  );
}

export default App;
