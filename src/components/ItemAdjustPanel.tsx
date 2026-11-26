/**
 * アイテム調整パネル
 * タッチジェスチャーで位置・大きさ・傾きを調整
 * - 一本指タッチ: 位置移動
 * - ピンチ: 拡大縮小
 * - 二本指回転: 傾き
 * ドール調整モード: 服がない場合にドールの位置・サイズを調整
 */
import { useCallback, useMemo, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { PlacedDoll, PlacedFrame, PlacedImage, PlacedItem } from './PlacedItem';
import { canvasGeometry, itemOrigin, itemPivotOnCanvas, lookOf } from './placement';
import type { DollData, EquippedItem, DollTransform } from '../types';
import { DEFAULT_DOLL_TRANSFORM } from '../types';
import type { ItemAdjustment } from '../hooks/useDressUp';
import { activeHides, hidesFor } from '../engine/hides';
import { RAINBOW_TRACK, hueTrack, trackCss } from '../pipeline/hueTrack';
import { drawOrder, isBehindDoll, reorderShown, sortByLayer } from '../engine/layers';
import type { LayerChange } from '../engine/layers';
import { adjustBaseId, isPairedBack, partnerOf } from '../engine/pairs';

// 調整中の服の枠の層（服の重なりは 50〜、下の一覧とボタンは 300）
const FRAME_Z = 190;
// 角のつまみを、枠の角から外へ出す量（つまみの大きさに対する割合。縦横それぞれ）
const HANDLE_OUT = 0.26;

export interface PendingAdjust {
  item?: ItemAdjustment; // 服の調整（キャンバスの px）
  doll?: DollTransform; // ドールの調整
}

interface ItemAdjustPanelProps {
  item: EquippedItem | null;  // nullの場合はドール調整モード
  // 着ている服（重ね順に下から）。重なりの前後と、調整する服の切り替えに使う
  equippedItems?: EquippedItem[];
  onRemove?: (itemId: string) => void; // 枠の × で服を脱がせる
  onSelect?: (itemId: string) => void; // 別の服の調整に切り替える（いまの調整は先に反映される）
  onLayerChange?: (itemId: string, layerAdjust: number) => void; // 調整中でない服の、重なりの前後を変える（一覧のドラッグ）
  // 縦画面では、色・ボタンを画面の下に置く（一覧は、横画面と同じく左に縦並び）
  orientation?: 'landscape' | 'portrait';
  onAdjust: (adjustment: ItemAdjustment) => void;
  // まだ確定していない、いまの調整（変わるたびに知らせる。閉じる・開き直すときは null）。
  // 画面の大きさが変わって調整画面を開き直す前に、親が覚えておくのに使う
  onPending?: (pending: PendingAdjust | null) => void;
  onClose: () => void;
  canvasWidth: number;
  canvasHeight: number;
  // ドール調整用
  dollTransform: DollTransform;
  onDollTransformChange: (transform: DollTransform) => void;
  // メニュー・ボタン領域のオフセット
  menuOffset?: number;
  rightOffset?: number;
  // ドール（ドール調整モードのプレビュー用）
  doll?: DollData | null;
}

// タッチポイントの型
interface TouchPoint {
  clientX: number;
  clientY: number;
}

// 2点間の距離を計算
function getDistance(touch1: TouchPoint, touch2: TouchPoint): number {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// 2点間の角度を計算（度）
function getAngle(touch1: TouchPoint, touch2: TouchPoint): number {
  const dx = touch2.clientX - touch1.clientX;
  const dy = touch2.clientY - touch1.clientY;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function ItemAdjustPanel({
  item,
  onAdjust,
  onPending,
  onClose,
  canvasWidth,
  canvasHeight,
  dollTransform,
  onDollTransformChange,
  menuOffset = 0,
  rightOffset = 0,
  doll,
  equippedItems = [],
  onRemove,
  onSelect,
  onLayerChange,
  orientation = 'landscape',
}: ItemAdjustPanelProps) {
  // ドール調整モードかどうか
  const isDollMode = item === null;

  // キャンバス情報を計算する関数（位置とサイズ）
  const getCanvasInfo = useCallback(() => {
    // 実際のcanvas要素を直接取得（最も正確）
    const canvas = document.querySelector('#avatar-canvas') as HTMLCanvasElement | null;
    
    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      return { 
        left: canvasRect.left, 
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      };
    }
    
    // フォールバック：渡されたサイズを使用
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    
    const avatarSection = document.querySelector('.avatar-section') as HTMLElement | null;
    
    if (avatarSection) {
      const sectionRect = avatarSection.getBoundingClientRect();
      return {
        left: sectionRect.left + (sectionRect.width - canvasWidth) / 2,
        top: sectionRect.top + (sectionRect.height - canvasHeight) / 2,
        width: canvasWidth,
        height: canvasHeight,
      };
    }
    
    return {
      left: (viewportWidth - canvasWidth) / 2,
      top: (viewportHeight - canvasHeight) / 2,
      width: canvasWidth,
      height: canvasHeight,
    };
  }, [canvasWidth, canvasHeight]);

  // キャンバス情報の状態管理（初期値を同期的に計算）
  const [canvasInfo, setCanvasInfo] = useState(getCanvasInfo);
  
  // レイアウト変更後に情報を再計算
  useEffect(() => {
    // DOMリフロー完了を待つためにrequestAnimationFrameを使用
    const rafId = requestAnimationFrame(() => {
      // 2フレーム待ってレイアウトを安定させる
      requestAnimationFrame(() => {
        setCanvasInfo(getCanvasInfo());
      });
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [canvasWidth, canvasHeight, getCanvasInfo]);
  
  const canvasLeft = canvasInfo.left;
  const canvasTop = canvasInfo.top;
  // 実際のcanvasサイズを使用（プロップスではなく実測値）
  const actualCanvasWidth = canvasInfo.width;
  const actualCanvasHeight = canvasInfo.height;

  // Pixi(論理座標) → CSSピクセル 変換用スケール
  // 調整値(adjustOffsetX/Y)はPixiの論理座標系で保存されるため、
  // 入力(タッチ/マウス=CSSピクセル)と表示(CSS)の両方で変換して整合性を取る。
  const canvasScaleX = canvasWidth > 0 ? actualCanvasWidth / canvasWidth : 1;
  const canvasScaleY = canvasHeight > 0 ? actualCanvasHeight / canvasHeight : 1;
  const invCanvasScaleX = canvasScaleX !== 0 ? 1 / canvasScaleX : 1;
  const invCanvasScaleY = canvasScaleY !== 0 ? 1 / canvasScaleY : 1;

  // 元キャンバスの 1px が画面上で何 CSS px になるか（PixiEngine: 表示高さ × 0.9 ÷ 1024）
  const previewUnit = (actualCanvasHeight * 0.9) / 1024;

  // 背景領域の計算（PixiEngineと同じ計算）
  // ※ここはPixi(論理座標)で計算する
  const availableWidth = Math.max(0, canvasWidth - menuOffset - rightOffset);
  const availableCenterX = menuOffset + availableWidth / 2;
  // 背景は1:1正方形で画面縦幅いっぱい
  const bgSize = canvasHeight;
  const bgCenterX = availableCenterX;
  const bgCenterY = canvasHeight / 2;

  // 現在の調整値（ローカルステート）- アイテムモード用
  const [offsetX, setOffsetX] = useState(item?.adjustOffsetX ?? 0);
  const [offsetY, setOffsetY] = useState(item?.adjustOffsetY ?? 0);
  const [scale, setScale] = useState(item?.adjustScale ?? 1.0);
  const [rotation, setRotation] = useState(item?.adjustRotation ?? 0);
  const [layerAdjust, setLayerAdjust] = useState(item?.layerAdjust ?? 0);
  const [colorHue, setColorHue] = useState(item?.colorHue ?? 0);
  // 「色をもどす」の戻す先: クローゼットで決めた既定の色（無ければ、もとの色）
  const defaultHue = item?.defaultHue ?? 0;

  // ドール調整用ローカルステート
  const [dollX, setDollX] = useState(dollTransform.x);
  const [dollY, setDollY] = useState(dollTransform.y);
  const [dollScale, setDollScale] = useState(dollTransform.scale);

  // タッチ状態
  const touchStartRef = useRef<{
    // 一本指用
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    // 二本指用
    initialDistance: number;
    initialScale: number;
    initialAngle: number;
    initialRotation: number;
  } | null>(null);
  const [touchCount, setTouchCount] = useState(0);

  // ローカルの調整値は初期値として props から取り込む。
  // 調整対象が変わるときは親が key を変えてパネルごと作り直す。

  // onAdjustをrefで保持（依存配列から除外するため）
  const onAdjustRef = useRef(onAdjust);
  const onPendingRef = useRef(onPending);
  const onDollTransformChangeRef = useRef(onDollTransformChange);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onAdjustRef.current = onAdjust;
    onPendingRef.current = onPending;
    onDollTransformChangeRef.current = onDollTransformChange;
    onCloseRef.current = onClose;
  });
  // まだ確定していない調整を、変わるたびに親に知らせる（閉じるときは null）
  useEffect(() => {
    onPendingRef.current?.(
      isDollMode
        ? { doll: { x: dollX, y: dollY, scale: dollScale } }
        : { item: { adjustOffsetX: offsetX, adjustOffsetY: offsetY, adjustScale: scale, adjustRotation: rotation, layerAdjust, colorHue } },
    );
  }, [isDollMode, dollX, dollY, dollScale, offsetX, offsetY, scale, rotation, layerAdjust, colorHue]);
  useEffect(() => () => onPendingRef.current?.(null), []);

  // アイテム調整値は「完了」ボタンで親に反映（リアルタイム反映を廃止し高速化）

  // ドール調整値も「完了」ボタンで親に反映（リアルタイム反映を廃止し高速化）

  // 完了ボタン押下時：ローカルの調整値を親に反映してからclose
  const handleClose = useCallback(() => {
    if (isDollMode) {
      // ドールモード: ドールの位置・スケールを反映
      onDollTransformChangeRef.current({
        x: dollX,
        y: dollY,
        scale: dollScale,
      });
    } else {
      // アイテムモード: アイテムの調整値を反映
      onAdjustRef.current({
        adjustOffsetX: offsetX,
        adjustOffsetY: offsetY,
        adjustScale: scale,
        adjustRotation: rotation,
        layerAdjust: layerAdjust,
        colorHue: colorHue,
      });
    }
    onCloseRef.current();
  }, [isDollMode, dollX, dollY, dollScale, offsetX, offsetY, scale, rotation, layerAdjust, colorHue]);

  // 位置の範囲（論理キャンバスサイズの50%まで）
  // ※調整値はPixiの論理座標で保存される
  const maxOffset = Math.min(canvasWidth, canvasHeight) * 0.5;

  // 全リセット
  const handleResetAll = useCallback(() => {
    if (isDollMode) {
      // ドールモード: デフォルト初期位置に戻す
      setDollX(DEFAULT_DOLL_TRANSFORM.x);
      setDollY(DEFAULT_DOLL_TRANSFORM.y);
      setDollScale(DEFAULT_DOLL_TRANSFORM.scale);
    } else {
      // アイテムモード
      setOffsetX(0);
      setOffsetY(0);
      setScale(1.0);
      setRotation(0);
      setLayerAdjust(0);
      setColorHue(defaultHue);
      // 重なりの順番はその場でキャンバスに反映する
      onAdjustRef.current({ layerAdjust: 0 });
    }
  }, [isDollMode, defaultHue]);

  // 枠の右上: 位置・大きさ・傾きだけを元に戻す
  const handleResetPlacement = useCallback(() => {
    setOffsetX(0);
    setOffsetY(0);
    setScale(1.0);
    setRotation(0);
  }, []);

  // 髪は、前髪と対のうしろがみを一緒に動かす: 位置・大きさ・向き・色は、対の相手にも同じ値を入れる（重なりの順番は別々）
  const partner = item ? partnerOf(equippedItems, item.id) : null;
  // 黒っぽい絵か（絵を読んだときに分かる）。前髪とうしろがみは、どちらかが黒っぽければ、両方とも同じ色変えにする
  const [darkById, setDarkById] = useState<Record<string, boolean>>({});
  const reportDark = (id: string) => (dark: boolean) => setDarkById((prev) => (prev[id] === dark ? prev : { ...prev, [id]: dark }));
  const pairDark = item && partner ? !!(darkById[item.id] || darkById[partner.id]) : undefined;
  // 色のスライダーの帯: その服が実際になる色（まん中 = 元の絵の色）。元の絵の画素は、調整中の服のプレビューが読んだもの。
  // 黒っぽい絵かどうかは、服の表示と同じ判定。画素を読めるまで・読めないときは、決まった虹色
  const [itemPixels, setItemPixels] = useState<Uint8ClampedArray | null>(null);
  const trackDark = pairDark ?? (item ? darkById[item.id] : undefined) ?? false;
  const trackStops = useMemo(() => (itemPixels ? hueTrack(itemPixels, trackDark) : null), [itemPixels, trackDark]);
  // つまみの半分（縦は 44px の半分、横は 32px の半分）だけ、色を内側に置く
  const hueTrackStyle = { background: orientation === 'portrait' ? trackCss(trackStops ?? RAINBOW_TRACK, 'right', 22) : trackCss(trackStops ?? RAINBOW_TRACK, 'top', 16) };

  // 重なりの前後: 着ている服（調整中の服は、調整中の値）とドールを、下から並べた一覧の中で動かす。
  // ドールより下へ動かすと、ドールの後ろに回る
  const current = item
    ? equippedItems.map((i) =>
        i.id === item.id
          ? { ...item, layerAdjust }
          : i.id === partner?.id
            ? { ...i, adjustOffsetX: offsetX, adjustOffsetY: offsetY, adjustScale: scale, adjustRotation: rotation, colorHue }
            : i,
      )
    : [];
  const stack = sortByLayer(current);
  // 対のうしろがみは一覧に出さない（前髪だけを並べ替える。うしろがみの重なりは、そのまま）
  const hiddenIds = new Set(current.filter((i) => isPairedBack(current, i.id)).map((i) => i.id));
  // 一覧に出す行（上が手前）。null がドールの行
  const shownRows: (EquippedItem | null)[] = [
    ...stack.filter((i) => !isBehindDoll(i) && !hiddenIds.has(i.id)).reverse(),
    null,
    ...stack.filter((i) => isBehindDoll(i) && !hiddenIds.has(i.id)).reverse(),
  ];
  const ownRow = item ? shownRows.findIndex((r) => r?.id === item.id) : -1;
  // まえへ（+1）= 一覧の 1 つ上、うしろへ（-1）= 1 つ下。番号は、調整中の服を抜いた一覧の中で数える
  const canMove = (direction: 1 | -1) => ownRow >= 0 && ownRow - direction >= 0 && ownRow - direction <= shownRows.length - 1;
  const moveLayer = (direction: 1 | -1) => {
    if (!item || !canMove(direction)) return;
    // 重なりの順番は、調整中でもその場でキャンバスに反映する
    applyLayerChanges(reorderShown(current, item.id, ownRow - direction, hiddenIds) ?? []);
  };

  // 一覧のドラッグで並べ替える: 行をつかんで上下に動かすと、離した位置に重なりが入る。
  // 行は指に付いてきて、ほかの行（ドールの行も）は 1 行分ずれて場所をあける。
  // 指で「なぞる = 一覧を流す」と「つかんで動かす = 並べ替え」がぶつからないように、一覧が画面に収まらないときは、
  // 指でつかんで動かせるのは、いま選んでいる服（⇅ の印）だけ。ほかの服は、なぞると一覧が流れ、押すとその服を選ぶ
  // （選んでから動かす）。一覧が収まるとき（流れないとき）と、マウスでは、どの行もすぐ動かせる
  const DRAG_START_PX = 6; // これより動かさなければ「押した」（調整する服の切り替え）
  const EDGE_SCROLL_PX = 24; // 一覧の端からこの幅に指があるあいだ、一覧を流し続ける
  const EDGE_SCROLL_STEP = 6; // 1 フレームに流す量
  const pickerItemsRef = useRef<HTMLDivElement>(null);
  const scrollRange = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);
  // 一覧が画面に収まらないか（行の touch-action を決める。指が触れる前に決まっていないといけない）
  const [overflow, setOverflow] = useState(false);
  const rowCount = shownRows.length;
  useLayoutEffect(() => {
    const container = pickerItemsRef.current;
    if (!container) return undefined;
    const check = () => setOverflow(scrollRange(container) > 1);
    check();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    observer?.observe(container);
    window.addEventListener('resize', check);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [rowCount]);
  const touchDraggable = (id: string) => !overflow || id === item?.id;
  const rowDragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    lastY: number;
    startScroll: number;
    maxScroll: number; // 流せる上限（つかんだ時点。動かしている行は transform で外へ出るので、あとからは測れない）
    from: number; // 一覧の上からの番号（ドールの行も数える）
    to: number;
    slots: number[]; // 全部の行の中心（上から。つかんだ時点の画面の位置）
    pitch: number;
    mode: 'pending' | 'drag';
    frame: number | null;
    moved: boolean;
  } | null>(null);
  const [rowDrag, setRowDrag] = useState<{ id: string; dy: number; from: number; to: number; pitch: number } | null>(null);
  const suppressClickRef = useRef(false);
  function applyLayerChanges(changes: LayerChange[]) {
    for (const change of changes) {
      if (item && change.id === item.id) {
        setLayerAdjust(change.layerAdjust);
        onAdjustRef.current({ layerAdjust: change.layerAdjust });
      } else {
        onLayerChange?.(change.id, change.layerAdjust);
      }
    }
  }
  // 指の位置（と一覧の流れた量）から、行のずれと、入れる位置を決める
  const updateRowDrag = () => {
    const d = rowDragRef.current;
    const container = pickerItemsRef.current;
    if (!d || !container) return;
    const dy = d.lastY - d.startY + (container.scrollTop - d.startScroll);
    const own = d.slots[d.from] + dy;
    // いちばん近い行の位置に入る（となりの行までの半分を越えたら、入れ替わる）
    let to = 0;
    for (let k = 1; k < d.slots.length; k++) if (Math.abs(d.slots[k] - own) < Math.abs(d.slots[to] - own)) to = k;
    d.to = to;
    setRowDrag({ id: d.id, dy, from: d.from, to, pitch: d.pitch });
  };
  // 指が一覧の端にあるあいだ、一覧を流し続ける（指を止めていても流れる）
  const edgeScroll = () => {
    const d = rowDragRef.current;
    const container = pickerItemsRef.current;
    if (!d || !container || d.mode !== 'drag') return;
    const box = container.getBoundingClientRect();
    const before = container.scrollTop;
    if (d.lastY < box.top + EDGE_SCROLL_PX) container.scrollTop = Math.max(0, before - EDGE_SCROLL_STEP);
    else if (d.lastY > box.bottom - EDGE_SCROLL_PX) container.scrollTop = Math.min(d.maxScroll, before + EDGE_SCROLL_STEP);
    if (container.scrollTop !== before) updateRowDrag();
    d.frame = requestAnimationFrame(edgeScroll);
  };
  const stopRowDragTimers = () => {
    const d = rowDragRef.current;
    if (!d) return;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    d.frame = null;
  };
  const startRowDrag = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const container = pickerItemsRef.current;
    if (!container || rowDragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // 指で、選んでいない服をなぞったときは、一覧を流す（ブラウザに任せる）。押しただけなら click で選ぶ
    if (e.pointerType !== 'mouse' && !touchDraggable(id)) return;
    const rows = [...container.children];
    const from = rows.indexOf(e.currentTarget);
    if (from < 0) return;
    const rects = rows.map((r) => r.getBoundingClientRect());
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pitch = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) : rects[0].height;
    rowDragRef.current = {
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      startScroll: container.scrollTop,
      maxScroll: scrollRange(container),
      from,
      to: from,
      slots: rects.map((r) => r.top + r.height / 2),
      pitch,
      mode: 'pending',
      frame: null,
      moved: false,
    };
  };
  const moveRowDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = rowDragRef.current;
    const container = pickerItemsRef.current;
    if (!d || !container || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
    if (d.mode === 'pending') {
      if (Math.abs(d.lastY - d.startY) < DRAG_START_PX) return;
      d.mode = 'drag';
    }
    d.moved = true;
    updateRowDrag();
    if (d.frame === null) d.frame = requestAnimationFrame(edgeScroll);
  };
  const endRowDrag = (e: React.PointerEvent<HTMLElement>, commit: boolean) => {
    const d = rowDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    stopRowDragTimers();
    rowDragRef.current = null;
    setRowDrag(null);
    if (!d.moved) return;
    // ドラッグのあとの click では、調整する服を切り替えない
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (!commit || d.mode !== 'drag' || d.to === d.from) return;
    // d.to は、動かす服を抜いた一覧（上から、見えている行だけ）の中の番号と同じ
    applyLayerChanges(reorderShown(current, d.id, d.to, hiddenIds) ?? []);
  };
  // 画面を閉じるとき・別の服に切り替わるときは、タイマーを止める
  useEffect(() => () => stopRowDragTimers(), []);
  // 行の見た目: 動かしている行は指に付いていき、ほかの行は場所をあける。index は一覧の上からの番号（ドールの行も数える）
  const rowStyle = (index: number): React.CSSProperties | undefined => {
    if (!rowDrag) return undefined;
    if (index === rowDrag.from) return { transform: `translateY(${rowDrag.dy}px)` };
    const order = index < rowDrag.from ? index : index - 1; // ほかの行の中での番号
    const next = order < rowDrag.to ? order : order + 1; // 入れたあとの番号
    return next === index ? undefined : { transform: `translateY(${(next - index) * rowDrag.pitch}px)` };
  };

  // 枠の角の「拡大・回転」つまみ（シールの調整と同じ操作）
  const handleRef = useRef<{ cx: number; cy: number; distance: number; angle: number; scale: number; rotation: number } | null>(null);
  const startHandle = (e: React.PointerEvent, cx: number, cy: number) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    handleRef.current = { cx, cy, distance: Math.max(1, Math.hypot(dx, dy)), angle: (Math.atan2(dy, dx) * 180) / Math.PI, scale, rotation };
  };
  const moveHandle = (e: React.PointerEvent) => {
    const h = handleRef.current;
    if (!h) return;
    e.stopPropagation();
    const dx = e.clientX - h.cx;
    const dy = e.clientY - h.cy;
    setScale(Math.max(0.3, Math.min(2.5, h.scale * (Math.hypot(dx, dy) / h.distance))));
    let next = h.rotation + (Math.atan2(dy, dx) * 180) / Math.PI - h.angle;
    while (next > 180) next -= 360;
    while (next < -180) next += 360;
    setRotation(next);
  };
  const endHandle = (e: React.PointerEvent) => {
    e.stopPropagation();
    handleRef.current = null;
  };
  // つまみに触れたときは、背景の「移動」の操作を始めない
  const stopGesture = { onTouchStart: (e: React.TouchEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

  // 別の服に切り替える前に、いまの調整を反映する
  const switchTo = (id: string) => {
    if (suppressClickRef.current) return;
    if (!item || id === item.id) return;
    onAdjustRef.current({ adjustOffsetX: offsetX, adjustOffsetY: offsetY, adjustScale: scale, adjustRotation: rotation, layerAdjust, colorHue });
    onSelect?.(id);
  };

  // タッチ開始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    setTouchCount(touches.length);

    // ドールモードとアイテムモードで使う値を切り替え
    const currentOffsetX = isDollMode ? dollX : offsetX;
    const currentOffsetY = isDollMode ? dollY : offsetY;
    const currentScale = isDollMode ? dollScale : scale;
    const currentRotation = isDollMode ? 0 : rotation; // ドールモードでは回転なし

    if (touches.length === 1) {
      // 一本指: 位置移動開始
      touchStartRef.current = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        offsetX: currentOffsetX,
        offsetY: currentOffsetY,
        initialDistance: 0,
        initialScale: currentScale,
        initialAngle: 0,
        initialRotation: currentRotation,
      };
    } else if (touches.length === 2) {
      // 二本指: ピンチ・回転開始
      const distance = getDistance(touches[0], touches[1]);
      const angle = getAngle(touches[0], touches[1]);
      touchStartRef.current = {
        x: 0,
        y: 0,
        offsetX: currentOffsetX,
        offsetY: currentOffsetY,
        initialDistance: distance,
        initialScale: currentScale,
        initialAngle: angle,
        initialRotation: currentRotation,
      };
    }
  }, [isDollMode, dollX, dollY, dollScale, offsetX, offsetY, scale, rotation]);

  // タッチ移動
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    if (!touchStartRef.current) return;

    if (touches.length === 1 && touchCount === 1) {
      // 一本指: 位置移動
      const deltaX = touches[0].clientX - touchStartRef.current.x;
      const deltaY = touches[0].clientY - touchStartRef.current.y;

      // 入力はCSSピクセルなので、論理座標(Pixi)に変換
      const logicalDeltaX = deltaX * invCanvasScaleX;
      const logicalDeltaY = deltaY * invCanvasScaleY;
      
      if (isDollMode) {
        // ドールモード: パーセンテージで移動（bgSize=canvasHeightを基準）
        const percentX = (logicalDeltaX / canvasHeight) * 100;
        const percentY = (logicalDeltaY / canvasHeight) * 100;
        const newX = Math.max(-50, Math.min(150, touchStartRef.current.offsetX + percentX));
        const newY = Math.max(-50, Math.min(150, touchStartRef.current.offsetY + percentY));
        setDollX(newX);
        setDollY(newY);
      } else {
        // アイテムモード: 論理ピクセルで移動
        const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetX + logicalDeltaX));
        const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetY + logicalDeltaY));
        setOffsetX(newOffsetX);
        setOffsetY(newOffsetY);
      }
    } else if (touches.length === 2) {
      // 二本指: ピンチ（スケール）と回転
      const currentDistance = getDistance(touches[0], touches[1]);
      const currentAngle = getAngle(touches[0], touches[1]);

      // スケール変更（ピンチ）
      if (touchStartRef.current.initialDistance > 0) {
        const scaleRatio = currentDistance / touchStartRef.current.initialDistance;
        if (isDollMode) {
          const newScale = Math.max(0.3, Math.min(2.0, touchStartRef.current.initialScale * scaleRatio));
          setDollScale(newScale);
        } else {
          const newScale = Math.max(0.3, Math.min(2.5, touchStartRef.current.initialScale * scaleRatio));
          setScale(newScale);
        }
      }

      // 回転変更（アイテムモードのみ）
      if (!isDollMode) {
        const angleDelta = currentAngle - touchStartRef.current.initialAngle;
        let newRotation = touchStartRef.current.initialRotation + angleDelta;
        while (newRotation > 180) newRotation -= 360;
        while (newRotation < -180) newRotation += 360;
        setRotation(newRotation);
      }
    }
  }, [isDollMode, maxOffset, touchCount, canvasHeight, invCanvasScaleX, invCanvasScaleY]);

  // タッチ終了
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    setTouchCount(touches.length);

    // ドールモードとアイテムモードで使う値を切り替え
    const currentOffsetX = isDollMode ? dollX : offsetX;
    const currentOffsetY = isDollMode ? dollY : offsetY;
    const currentScale = isDollMode ? dollScale : scale;
    const currentRotation = isDollMode ? 0 : rotation; // ドールモードでは回転なし

    if (touches.length === 0) {
      touchStartRef.current = null;
    } else if (touches.length === 1) {
      // 二本指から一本指に戻った場合、一本指モードに切り替え
      touchStartRef.current = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        offsetX: currentOffsetX,
        offsetY: currentOffsetY,
        initialDistance: 0,
        initialScale: currentScale,
        initialAngle: 0,
        initialRotation: currentRotation,
      };
    }
  }, [isDollMode, dollX, dollY, dollScale, offsetX, offsetY, scale, rotation]);

  // マウス操作（PC用）
  const [isMouseDragging, setIsMouseDragging] = useState(false);
  const mouseStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // ボタンクリックは無視
    if ((e.target as HTMLElement).closest('button')) return;
    
    // ドールモードとアイテムモードで使う値を切り替え
    const currentOffsetX = isDollMode ? dollX : offsetX;
    const currentOffsetY = isDollMode ? dollY : offsetY;
    
    setIsMouseDragging(true);
    mouseStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
    };
  }, [isDollMode, dollX, dollY, offsetX, offsetY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isMouseDragging || !mouseStartRef.current) return;

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;

    // 入力はCSSピクセルなので、論理座標(Pixi)に変換
    const logicalDeltaX = deltaX * invCanvasScaleX;
    const logicalDeltaY = deltaY * invCanvasScaleY;

    if (isDollMode) {
      // ドールモード: パーセンテージで移動（bgSize=canvasHeightを基準）
      const percentX = (logicalDeltaX / canvasHeight) * 100;
      const percentY = (logicalDeltaY / canvasHeight) * 100;
      const newX = Math.max(-50, Math.min(150, mouseStartRef.current.offsetX + percentX));
      const newY = Math.max(-50, Math.min(150, mouseStartRef.current.offsetY + percentY));
      setDollX(newX);
      setDollY(newY);
    } else {
      // アイテムモード
      const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetX + logicalDeltaX));
      const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetY + logicalDeltaY));
      setOffsetX(newOffsetX);
      setOffsetY(newOffsetY);
    }
  }, [isDollMode, isMouseDragging, maxOffset, canvasHeight, invCanvasScaleX, invCanvasScaleY]);

  const handleMouseUp = useCallback(() => {
    setIsMouseDragging(false);
    mouseStartRef.current = null;
  }, []);

  // ホイールでスケール・回転（Shift押しながらで回転、アイテムモードのみ）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey && !isDollMode) {
      // Shift + ホイール: 回転（アイテムモードのみ）
      const delta = e.deltaY > 0 ? 5 : -5;
      setRotation((prev) => {
        let newRotation = prev + delta;
        while (newRotation > 180) newRotation -= 360;
        while (newRotation < -180) newRotation += 360;
        return newRotation;
      });
    } else {
      // ホイール: スケール
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      if (isDollMode) {
        setDollScale((prev) => Math.max(0.3, Math.min(2.0, prev + delta)));
      } else {
        setScale((prev) => Math.max(0.3, Math.min(2.5, prev + delta)));
      }
    }
  }, [isDollMode]);

  return (
    <div
      className="item-adjust-overlay"
      data-mode={isDollMode ? 'doll' : 'item'}
      // 一覧の行を動かしているあいだは、ほかの指（手のひら）で服を動かさない
      onTouchStart={(e) => (rowDragRef.current ? e.preventDefault() : handleTouchStart(e))}
      onTouchMove={(e) => (rowDragRef.current ? e.preventDefault() : handleTouchMove(e))}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isMouseDragging ? 'grabbing' : 'grab' }}
    >
      {/* アイテムモード時：調整中のアイテムをCSSでリアルタイムプレビュー。
          調整中の服より手前の服も、キャンバスではなくここに重ねて、重なりの順番をその場で見せる */}
      {!isDollMode && item && (() => {
        const geometry = canvasGeometry(canvasInfo, canvasWidth, canvasHeight, menuOffset, rightOffset);
        const look = { offsetX, offsetY, scale, rotation, hue: colorHue };
        const origin = itemOrigin(item, look, geometry, dollTransform);
        const { box, canvasW, canvasH } = item;
        const k = previewUnit * dollTransform.scale; // 元キャンバスの 1px → 画面の px
        // 拡大・回転の軸（ふつうは服の中心。うしろがみは、前髪の中心）。画面の座標
        const pivot = itemPivotOnCanvas(item);
        const centerX = origin.x + (pivot.x - canvasW / 2) * k;
        const centerY = origin.y + (pivot.y - canvasH / 2) * k;
        const counter = 1 / Math.max(0.01, scale * dollTransform.scale); // つまみの大きさを一定にする
        // つまみは、枠の角の外側に置く（服に重ねない）: 中心を、角から縦横それぞれ「つまみの大きさの 26%」だけ外へ。
        // 大きさは CSS の --sticker-size（スマホは 34px、ほかは 40px）。服を大きく・小さくしても、画面での大きさと離れ方は一定
        const out = (sign: 1 | -1) => `calc(${sign * 50}% + var(--sticker-size, 40px) * ${(sign * HANDLE_OUT * counter).toFixed(4)})`;
        const handleAt = (sx: 1 | -1, sy: 1 | -1) => `translate(${out(sx)}, ${out(sy)}) scale(${counter})`;

        // シールのような枠: 左上 × で脱がせる、右上で位置などを元に戻す、右下で拡大・回転
        const frame = (
          <div
            className="sticker-frame"
            data-testid="sticker-frame"
            style={{
              left: `${box.x * previewUnit}px`,
              top: `${box.y * previewUnit}px`,
              width: `${box.w * previewUnit}px`,
              height: `${box.h * previewUnit}px`,
              borderWidth: `${2 * counter}px`,
            }}
          >
            {onRemove && (
              <button
                className="sticker-handle sticker-remove"
                style={{ transform: handleAt(-1, -1) }}
                {...stopGesture}
                onClick={() => onRemove(item.id)}
                title="ぬがせる"
                aria-label="ぬがせる"
                data-testid="sticker-remove"
              >
                ×
              </button>
            )}
            <button
              className="sticker-handle sticker-reset"
              style={{ transform: handleAt(1, -1) }}
              {...stopGesture}
              onClick={handleResetPlacement}
              title="位置・大きさ・向きをもどす"
              aria-label="位置・大きさ・向きをもどす"
              data-testid="sticker-reset"
            >
              ↺
            </button>
            <div
              className="sticker-handle sticker-rotate"
              style={{ transform: handleAt(1, 1) }}
              {...stopGesture}
              onPointerDown={(e) => startHandle(e, centerX, centerY)}
              onPointerMove={moveHandle}
              onPointerUp={endHandle}
              onPointerCancel={endHandle}
              title="ひっぱって大きさと向きを変える"
              aria-label="大きさと向き"
              data-testid="sticker-rotate"
            >
              ⤡
            </div>
          </div>
        );

        // キャンバスの代わりに、ここに重ねて描くもの（下から）: 調整中の服と対の相手のうち下にあるほうと、それより手前の服・ドール。
        // 重なりの順番と、対の相手の位置・色を、その場で見せる
        const order = drawOrder(current);
        const sheets = order.slice(order.findIndex((s) => s.kind === 'item' && s.item.id === adjustBaseId(current, item.id)));
        // 手前の服のうち、ほかの服が隠す所を持つもの（くつの下の靴下など）。キャンバスと同じように消して描く
        const clip = hidesFor(current, item.id, { w: doll?.canvasW ?? 1024, h: doll?.canvasH ?? 1024 }).items;
        const layers = sheets.map((sheet, i) => {
          if (sheet.kind === 'doll') {
            return doll && <PlacedDoll key="doll" doll={doll} hides={activeHides(current, item.id)} geometry={geometry} dollTransform={dollTransform} zIndex={50 + i} />;
          }
          if (sheet.item.id === item.id) {
            return (
              <PlacedItem key={item.id} item={item} look={look} geometry={geometry} dollTransform={dollTransform} zIndex={50 + i} alwaysHue dark={pairDark} onDark={reportDark(item.id)} onPixels={setItemPixels} showUnder testId="adjust-preview" />
            );
          }
          if (sheet.item.id === partner?.id) {
            return (
              <PlacedItem key={partner.id} item={partner} look={look} geometry={geometry} dollTransform={dollTransform} zIndex={50 + i} alwaysHue dark={pairDark} onDark={reportDark(partner.id)} testId="adjust-partner" />
            );
          }
          return (
            <PlacedItem
              key={sheet.item.id}
              item={sheet.item}
              look={lookOf(sheet.item)}
              clip={clip.get(sheet.item.id)}
              geometry={geometry}
              dollTransform={dollTransform}
              zIndex={50 + i}
              className="adjust-front-item"
            />
          );
        });
        // 枠とつまみは、服の重なりの順に関係なく、どの服・ドールよりも手前に出す（服の絵は、重なりの順のまま）
        return [
          ...layers,
          <PlacedFrame key="frame" item={item} look={look} geometry={geometry} dollTransform={dollTransform} zIndex={FRAME_Z}>
            {frame}
          </PlacedFrame>,
        ];
      })()}

      {/* ドールモード時：ドール画像のプレビュー */}
      {isDollMode && (() => {
        // ドール中心位置を計算（PixiEngineと同じ計算）
        const dollCenterX = bgCenterX + ((dollX - 50) / 100) * bgSize;
        const dollCenterY = bgCenterY + ((dollY - 50) / 100) * bgSize;
        
        // キャンバス内座標(Pixi:論理) → window座標(CSSピクセル)に変換
        const windowX = canvasLeft + dollCenterX * canvasScaleX;
        const windowY = canvasTop + dollCenterY * canvasScaleY;

        return (
          <div
            style={{
              position: 'absolute',
              left: `${windowX}px`,
              top: `${windowY}px`,
              transform: `translate(-50%, -50%) scale(${dollScale})`,
              transformOrigin: 'center center',
              pointerEvents: 'none',
              zIndex: 50,
              opacity: 0.85,
              filter: 'drop-shadow(0 0 8px rgba(255,105,180,0.6))',
            }}
          >
            {doll ? (
              <PlacedImage
                src={doll.bodyImageUrl}
                alt="ドールプレビュー"
                canvasW={doll.canvasW}
                canvasH={doll.canvasH}
                box={doll.box}
                unit={previewUnit}
              />
            ) : (
              /* ドール画像がない場合は十字線 */
              <>
                <div style={{
                  width: '80px',
                  height: '2px',
                  backgroundColor: 'rgba(255, 105, 180, 0.8)',
                  position: 'absolute',
                  left: '-40px',
                  top: '-1px',
                }} />
                <div style={{
                  width: '2px',
                  height: '80px',
                  backgroundColor: 'rgba(255, 105, 180, 0.8)',
                  position: 'absolute',
                  left: '-1px',
                  top: '-40px',
                }} />
              </>
            )}
          </div>
        );
      })()}

      {/* 右上ボタン（完了・リセット・カラー） */}
      <div className="item-adjust-top-buttons">
        <button className="item-adjust-done-btn-small" onClick={handleClose} title="完了">
          ✓
        </button>
        <button className="item-adjust-reset-btn-small" onClick={handleResetAll} title="リセット">
          ↺
        </button>
        {/* 色相スライダー（アイテムモードのみ） */}
        {!isDollMode && (
          <div 
            className="item-adjust-hue-slider"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="hue-label">🎨</div>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={colorHue}
              onChange={(e) => setColorHue(Number(e.target.value))}
              className="hue-slider-vertical"
              style={hueTrackStyle}
              title={`色相: ${colorHue}°`}
            />
            <div className="hue-value">{colorHue}°</div>
            <button
              className="hue-reset-btn"
              onClick={() => setColorHue(defaultHue)}
              disabled={colorHue === defaultHue}
              title="色をもどす"
              aria-label="色をもどす"
              data-testid="hue-reset"
            >
              ↺
            </button>
          </div>
        )}
      </div>

      {/* 着ている服とドール（重なりの順番。手前が上）。服を押すと、その服の調整に切り替える。
          上下のボタンで、調整中の服の重なりを前後に入れ替える。ドールより下へ動かすと、ドールの後ろに回る */}
      {!isDollMode && item && (
        <div className="item-adjust-picker" onTouchStart={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-testid="adjust-picker">
          <button className="item-adjust-layer-btn" onClick={() => moveLayer(1)} disabled={!canMove(1)} title="まえへ" aria-label="まえへ" data-testid="layer-front">
            ▲
          </button>
          <div ref={pickerItemsRef} className={`item-adjust-picker-items${rowDrag ? ' sorting' : ''}`} data-testid="adjust-picker-items" data-overflow={overflow ? 'true' : 'false'}>
            {shownRows.map((i, index) =>
              i === null ? (
                <div key="doll" className="item-adjust-picker-doll" style={rowStyle(index)} title="ドール（これより下は、ドールのうしろ）" data-testid="adjust-picker-doll">
                  {doll && <img src={doll.bodyImageUrl} alt="ドール" draggable={false} />}
                </div>
              ) : (
                <button
                  key={i.id}
                  className={[i.id === item.id ? 'on' : '', rowDrag?.id === i.id ? 'dragging' : ''].filter(Boolean).join(' ')}
                  // 指でつかめない行は、なぞると一覧が流れる（縦だけ）
                  style={{ ...rowStyle(index), touchAction: touchDraggable(i.id) ? 'none' : 'pan-y' }}
                  onClick={() => switchTo(i.id)}
                  onPointerDown={(e) => startRowDrag(e, i.id)}
                  onPointerMove={moveRowDrag}
                  onPointerUp={(e) => endRowDrag(e, true)}
                  onPointerCancel={(e) => endRowDrag(e, false)}
                  onContextMenu={(e) => e.preventDefault()} // 長押しのメニューを出さない
                  title={i.name}
                  data-dragging={rowDrag?.id === i.id ? 'true' : undefined}
                  data-testid="adjust-picker-item"
                >
                  <img src={i.thumbnailUrl || i.imageUrl} alt={i.name} draggable={false} />
                  {/* 選んでいる服: つかんで上下に動かせる印 */}
                  {i.id === item.id && <span className="item-adjust-picker-grip" aria-hidden="true">⇅</span>}
                </button>
              ),
            )}
          </div>
          <button className="item-adjust-layer-btn" onClick={() => moveLayer(-1)} disabled={!canMove(-1)} title="うしろへ" aria-label="うしろへ" data-testid="layer-back">
            ▼
          </button>
        </div>
      )}
    </div>
  );
}
