/**
 * 着せ替えゲーム メインアプリケーション
 * Kids 2D Dress-Up Game - Main Application
 *
 * 横でも縦でも遊べる（配置は src/components/layout.ts）。
 * ドール・服・背景の画像は、別リポジトリ（DressUpGame-content）から配信されたものを読む。
 */
import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { AvatarCanvas, DressUpMenu, ItemAdjustPanel, DragPreviewLayer, EquipFlash } from './components';
import type { AvatarCanvasHandle, DragPreviewHandle } from './components';
import { useDressUp } from './hooks/useDressUp';
import type { ItemAdjustment } from './hooks/useDressUp';
import { sheetsAbove } from './engine/layers';
import { adjustBaseId, partnerOf } from './engine/pairs';
import { stageUnit, toCanvasOffsets, toDollOffsets } from './engine/units';
import { computeLayout } from './components/layout';
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
import { saveOutfit, loadOutfit, isOutfitFromBeforeHairParts } from './services/outfitStorage';
import { playDressUpSound } from './services/sound';
import type { ClothingItemData, DollData, BackgroundData, DollTransform, Position } from './types';
import { DEFAULT_DOLL_TRANSFORM } from './types';
import { APP_VERSION } from './version';
import './App.css';


// 画面の大きさと、上下のあけておく高さ（時計や電池の表示の分・ホームの線の分）
interface Viewport {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

// 上下のあきは CSS でしか分からないので、見えない目印を一瞬置いて測る
function readViewport(): Viewport {
  // visualViewportを優先使用（iPad Safari対応）
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;box-sizing:content-box;visibility:hidden;pointer-events:none;height:var(--top-inset,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const top = parseFloat(style.height) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  probe.remove();
  return { width, height, top, bottom };
}

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

  // 画面の大きさから、配置（横・縦）を決める。
  // 横: キャンバスは画面いっぱい（メニューとボタンの分は描画側で差し引く）。縦: キャンバスは上の正方形、メニュー類は下
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  const layout = useMemo(
    () => computeLayout(viewport.width, viewport.height, { top: viewport.top, bottom: viewport.bottom }),
    [viewport],
  );
  const canvasSize = layout.canvas;

  // 画面サイズの変化（持ち替えを含む）に合わせる。CSS変数も同時に更新してレイアウト全体を制御
  useEffect(() => {
    const update = () => {
      const next = readViewport();
      // CSS変数に実際のビューポートサイズを設定
      document.documentElement.style.setProperty('--app-height', `${next.height}px`);
      document.documentElement.style.setProperty('--app-width', `${next.width}px`);
      setViewport((prev) =>
        prev.width === next.width && prev.height === next.height && prev.top === next.top && prev.bottom === next.bottom ? prev : next,
      );
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // visualViewportのリサイズも監視（iPad Safariのアドレスバー表示/非表示）
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
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
  const { equipItem, unequipItemById, equippedItems, resetAll, updateItemAdjustment, restoreEquipped } = useDressUp();

  // 保存された装備（ID・調整値のみ）。素材の読み込み完了時に1回だけ復元する
  const savedOutfitRef = useRef<ReturnType<typeof loadOutfit> | null>(null);
  if (savedOutfitRef.current === null) {
    // 更新の前の保存は、位置の調整値が「横画面のキャンバスの px」。横にしたときの縮尺で、ドールの絵の px に直す
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    savedOutfitRef.current = loadOutfit(stageUnit(Math.min(vw, vh)));
  }

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
        const start = resolveStartState(
          content,
          loadCurrentDollId(),
          loadCurrentBackgroundId(),
          savedOutfitRef.current ?? [],
          isOutfitFromBeforeHairParts(),
        );
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

  // 服の位置の調整値は、状態では「ドールの絵の px」。描画と調整画面には「キャンバスの px」に直して渡す
  // （画面の大きさや向きが変わっても、ドールに対して同じ位置になる）
  const unit = stageUnit(canvasSize.height);
  const canvasItems = useMemo(() => equippedItems.map((item) => toCanvasOffsets(item, unit)), [equippedItems, unit]);

  // アイテム調整モード（adjustingItemId === null の場合はドール調整モード）
  const [isAdjustingItem, setIsAdjustingItem] = useState(false);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);

  // 調整中のアイテム - nullの場合はドール調整
  const adjustingItem = useMemo(() => {
    if (adjustingItemId === null) return null;
    return canvasItems.find(item => item.id === adjustingItemId) ?? null;
  }, [adjustingItemId, canvasItems]);

  // 調整中の服より手前のもの（服・ドール）。調整画面が代わりに重ねて描くので、キャンバスには描かない。
  // 髪は、前髪とうしろがみが一緒に動くので、下にあるほう（うしろがみ）から上を、調整画面が描く
  const hiddenSheets = useMemo(() => {
    if (!isAdjustingItem || adjustingItemId === null) return undefined;
    const baseId = adjustBaseId(equippedItems, adjustingItemId);
    const above = sheetsAbove(equippedItems, baseId);
    return { items: [baseId, ...above.flatMap((s) => (s.kind === 'item' ? [s.item.id] : []))], doll: above.some((s) => s.kind === 'doll') };
  }, [isAdjustingItem, adjustingItemId, equippedItems]);

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
      updateItemAdjustment(adjustingItemId, toDollOffsets(adjustment, unit));
    }
  }, [adjustingItemId, updateItemAdjustment, unit]);

  // 調整モード終了
  const handleAdjustClose = useCallback(() => {
    setIsAdjustingItem(false);
    setAdjustingItemId(null);
  }, []);

  // 調整画面の枠の × で、その服を脱がせる（髪は、前髪とうしろがみを一緒に）。調整は続け、いちばん手前の服に切り替える（服が無くなったら終える）
  const handleAdjustRemove = useCallback(
    (itemId: string) => {
      const partnerId = partnerOf(equippedItems, itemId)?.id;
      const rest = equippedItems.filter((item) => item.id !== itemId && item.id !== partnerId);
      unequipItemById(itemId);
      if (rest.length > 0) {
        setAdjustingItemId(rest[rest.length - 1].id); // equippedItems は重ね順（最後がいちばん手前）
      } else {
        setIsAdjustingItem(false);
        setAdjustingItemId(null);
      }
    },
    [equippedItems, unequipItemById],
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

  // 着せた服を一瞬光らせる（同じ服を続けて着せても、もう一度光るように回数も持つ）
  const [flash, setFlash] = useState<{ id: string; count: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [flash]);
  const flashItem = flash ? canvasItems.find((item) => item.id === flash.id) ?? null : null;

  // 服をドロップした時の処理（全アイテム通常装着）
  const handleItemDrop = useCallback(
    (item: ClothingItemData) => {
      // 髪なら、対のうしろがみも一緒に着せる
      equipItem(item, item.backItemId ? allClothing.find((c) => c.id === item.backItemId) : undefined);
      dragPreviewRef.current?.hide();
      setFlash((prev) => ({ id: item.id, count: (prev?.count ?? 0) + 1 }));
      playDressUpSound();
    },
    [equipItem, allClothing]
  );

  // アイテムドラッグ中のコールバック（全アイテム対象）
  const isPortrait = layout.orientation === 'portrait';
  const handleDragMove = useCallback((item: { thumbnailUrl?: string; imageUrl: string }, position: Position) => {
    const preview = dragPreviewRef.current;
    if (!preview || !avatarSectionRef.current) return;
    const inside = (rect: DOMRect) => position.x >= rect.left && position.x <= rect.right && position.y >= rect.top && position.y <= rect.bottom;
    // 横: ドラッグ位置が avatar-section 内のときだけ表示（メニューの中では、服そのものが動いて見える）。
    // 縦: 服の行を出たら表示（服そのものは行の外では見えないので、カテゴリの行の上を通るあいだも絵を出す）
    const row = isPortrait ? document.querySelector('.portrait-items') : null;
    const show = row ? !inside(row.getBoundingClientRect()) : inside(avatarSectionRef.current.getBoundingClientRect());
    if (show) preview.move(item.thumbnailUrl || item.imageUrl, position.x, position.y);
    else preview.hide();
  }, [isPortrait]);

  const handleDragEnd = useCallback(() => {
    dragPreviewRef.current?.hide();
  }, []);

  // 持ち替えたとき、ドラッグの途中だった絵が残らないようにする
  useEffect(() => {
    dragPreviewRef.current?.hide();
  }, [isPortrait]);

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

  // 版数（右上に小さく。読み込み中・失敗の画面にも出して、どの版で止まっているかが分かるようにする）
  const versionBadge = <div className="version-badge">v{APP_VERSION}</div>;

  if (loadState !== 'ready') {
    return (
      <div className="app">
        {versionBadge}
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
      </div>
    );
  }

  const portrait = layout.orientation === 'portrait';

  // ボタン（横では画面の右、縦では下のボタンの行に置く）
  const screenshotButton = currentDoll && (
    <button className="screenshot-button" onClick={handleScreenshot} title="スクショ" data-testid="screenshot-button">
      📷
    </button>
  );
  // リセットボタン（服を着ている場合のみ表示）
  const resetButton = equippedItems.length > 0 && (
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
  );
  const adjustButton = currentDoll && (
    <button className="tool-button" onClick={handleAdjustButtonClick} title={equippedItems.length > 0 ? '服を調整' : 'ドール調整'}>
      {equippedItems.length > 0 ? '👗' : '📐'}
    </button>
  );

  return (
    <div className="app" data-orientation={layout.orientation}>
      {versionBadge}

      {/* 写真の保存（リセットから離して、押し間違えないようにする）- 調整中は非表示 */}
      {!portrait && !isAdjustingItem && screenshotButton}

      {/* 右下ボタングループ - 調整中は非表示 */}
      {!portrait && !isAdjustingItem && <div className="bottom-right-buttons">{resetButton}</div>}

      <main className="app-main">
        {/* ドールが存在する場合のみ表示 */}
        {currentDoll && (
          <section
            ref={avatarSectionRef}
            className="avatar-section"
            // 縦: キャンバスは上のあきの下に、正方形の高さで置く（横は CSS のまま）
            style={portrait ? { top: layout.canvas.top, height: layout.canvas.height } : undefined}
          >
            <AvatarCanvas
              ref={avatarCanvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              equippedItems={canvasItems}
              doll={currentDoll}
              backgroundImageUrl={currentBackground?.imageUrl}
              dollTransform={dollTransform}
              menuOffset={layout.menuOffset}
              rightOffset={layout.rightOffset}
              adjustingItemId={isAdjustingItem ? adjustingItemId : null}
              hidden={hiddenSheets}
            />
          </section>
        )}

        {/* ツールボタン（調整モードでないとき表示）- avatar-sectionの外に配置 */}
        {!portrait && !isAdjustingItem && adjustButton && <div className="tool-buttons">{adjustButton}</div>}

        {/* ドレスアップメニュー - アイテム調整中は非表示。縦では画面の下（カテゴリ → 服 → ボタンの行） */}
        {!isAdjustingItem && (
          <section className="palette-section" style={portrait ? { height: layout.menuHeight } : undefined}>
            <DressUpMenu
              items={filteredClothing}
              onItemDrop={handleItemDrop}
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
              // 縦では、背景も行の外で絵を出す（横は今までどおり、背景そのものが動いて見える）
              onBackgroundDragMove={portrait ? handleDragMove : undefined}
              onBackgroundDragEnd={handleDragEnd}
              layout={layout.orientation}
              itemRows={layout.itemRows}
            />
            {portrait && (
              <div className="portrait-tools" data-testid="portrait-tools">
                {adjustButton}
                {screenshotButton}
                {resetButton}
              </div>
            )}
          </section>
        )}
      </main>

      {/* アイテム/ドール調整オーバーレイ（画面全体） */}
      {isAdjustingItem && (
        <ItemAdjustPanel
          // 縮尺が変わったら（画面の大きさが変わる持ち替えなど）、新しい縮尺で開き直す。
          // 縦と横で正方形の一辺が同じ端末（iPad・スマホのふつうの持ち替え）では、縮尺は変わらないので、開いたまま
          key={`${adjustingItemId ?? 'doll'}@${unit}`}
          item={adjustingItem}
          onAdjust={handleItemAdjust}
          onClose={handleAdjustClose}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          dollTransform={dollTransform}
          onDollTransformChange={setDollTransform}
          menuOffset={layout.menuOffset}
          rightOffset={layout.rightOffset}
          doll={currentDoll}
          equippedItems={canvasItems}
          onRemove={handleAdjustRemove}
          onSelect={setAdjustingItemId}
          onLayerChange={(id, layerAdjust) => updateItemAdjustment(id, { layerAdjust })}
          orientation={layout.orientation}
        />
      )}

      {/* 着せた服を一瞬光らせる */}
      {flashItem && !isAdjustingItem && (
        <EquipFlash
          key={flash!.count}
          item={flashItem}
          dollTransform={dollTransform}
          canvasWidth={canvasSize.width}
          canvasHeight={canvasSize.height}
          menuOffset={layout.menuOffset}
          rightOffset={layout.rightOffset}
        />
      )}

      {/* アイテムドラッグ中のプレビュー（サムネイル表示） */}
      <DragPreviewLayer ref={dragPreviewRef} aboveMenu={portrait} />
    </div>
  );
}

export default App;
