/**
 * アイテム調整パネル
 * タッチジェスチャーで位置・大きさ・傾きを調整
 * - 一本指タッチ: 位置移動
 * - ピンチ: 拡大縮小
 * - 二本指回転: 傾き
 * ドール調整モード: 服がない場合にドールの位置・サイズを調整
 */
import { useCallback, useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { HueCanvas } from './HueCanvas';
import type { Box, DollData, EquippedItem, DollTransform } from '../types';
import { DEFAULT_DOLL_TRANSFORM } from '../types';
import type { ItemAdjustment } from '../hooks/useDressUp';

interface ItemAdjustPanelProps {
  item: EquippedItem | null;  // nullの場合はドール調整モード
  // 着ている服（重ね順に下から）。重なりの前後と、調整する服の切り替えに使う
  equippedItems?: EquippedItem[];
  onRemove?: (itemId: string) => void; // 枠の × で服を脱がせる
  onSelect?: (itemId: string) => void; // 別の服の調整に切り替える（いまの調整は先に反映される）
  onAdjust: (adjustment: ItemAdjustment) => void;
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

// 切り抜き画像を、元キャンバスの中での位置に置いて表示する。
// 外枠が元キャンバス全体の大きさなので、外枠の中心＝元キャンバスの中心（PixiEngine の原点と同じ）。
function PlacedImage({ src, alt, canvasW, canvasH, box, unit, hue }: {
  src: string;
  alt: string;
  canvasW: number;
  canvasH: number;
  box: Box;
  unit: number;
  hue?: number; // 指定すると、色相を変えた状態で表示する（服の調整用）
}) {
  const placed: CSSProperties = {
    position: 'absolute',
    display: 'block',
    left: `${box.x * unit}px`,
    top: `${box.y * unit}px`,
    width: `${box.w * unit}px`,
    height: `${box.h * unit}px`,
  };
  return (
    <div style={{ position: 'relative', width: `${canvasW * unit}px`, height: `${canvasH * unit}px` }}>
      {hue === undefined ? (
        <img src={src} alt={alt} draggable={false} style={placed} />
      ) : (
        <HueCanvas src={src} hue={hue} style={placed} testId="adjust-preview" />
      )}
    </div>
  );
}

export function ItemAdjustPanel({
  item,
  onAdjust,
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
  const onDollTransformChangeRef = useRef(onDollTransformChange);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onAdjustRef.current = onAdjust;
    onDollTransformChangeRef.current = onDollTransformChange;
    onCloseRef.current = onClose;
  });

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
      setColorHue(0);
    }
  }, [isDollMode]);

  // 重なりの前後: いまの重ね順（調整中の値を使う）で、1 つ前・1 つ後ろの服との間に入る
  const effective = (i: EquippedItem) => (i.layerOrder ?? i.baseZIndex ?? 0) + (item && i.id === item.id ? layerAdjust : (i.layerAdjust ?? 0));
  const stack = item
    ? [...equippedItems.filter((i) => i.id !== item.id), item].sort((a, b) => effective(a) - effective(b) || a.equipOrder - b.equipOrder)
    : [];
  const stackIndex = item ? stack.findIndex((i) => i.id === item.id) : -1;
  const moveLayer = useCallback(
    (direction: 1 | -1) => {
      if (!item || stackIndex < 0) return;
      const neighbor = stack[stackIndex + direction];
      if (!neighbor) return;
      const beyond = stack[stackIndex + direction * 2];
      const near = effective(neighbor);
      // 隣の服を越えた所（その先の服との中間。先が無ければ 1 つ分先）に置く
      const far = beyond && effective(beyond) !== near ? effective(beyond) : near + direction;
      const target = (near + far) / 2;
      setLayerAdjust(target - (item.layerOrder ?? item.baseZIndex ?? 0));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stack と effective は item・layerAdjust・equippedItems から決まる
    [item, stackIndex, layerAdjust, equippedItems],
  );

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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isMouseDragging ? 'grabbing' : 'grab' }}
    >
      {/* アイテムモード時：調整中のアイテムをCSSでリアルタイムプレビュー */}
      {!isDollMode && item && (() => {
        // ドール中心位置を計算（PixiEngineと同じ計算）
        // dollTransformのx,yは背景領域内での%位置（50%=中央）
        const dollCenterX = bgCenterX + ((dollTransform.x - 50) / 100) * bgSize;
        const dollCenterY = bgCenterY + ((dollTransform.y - 50) / 100) * bgSize;
        
        // アイテムの基準位置を計算（キャンバス内座標）
        let baseX: number;
        let baseY: number;
        
        if (item?.movable && ((item.offsetX ?? 0) !== 0 || (item.offsetY ?? 0) !== 0)) {
          // movableアイテム: bgCenter + offset で計算（PixiEngineと同じ）
          baseX = bgCenterX + ((item.offsetX ?? 0) / 100) * bgSize;
          baseY = bgCenterY + ((item.offsetY ?? 0) / 100) * bgSize;
        } else {
          // 通常アイテム: ドール中心
          baseX = dollCenterX;
          baseY = dollCenterY;
        }
        
        // 調整オフセットを適用
        baseX += offsetX;
        baseY += offsetY;
        
        // キャンバス内座標(Pixi:論理) → window座標(CSSピクセル)に変換
        const windowX = canvasLeft + baseX * canvasScaleX;
        const windowY = canvasTop + baseY * canvasScaleY;
        const { box, canvasW, canvasH } = item;
        const k = previewUnit * dollTransform.scale; // 元キャンバスの 1px → 画面の px
        // 服の中心（拡大・回転の軸）。画面の座標
        const centerX = windowX + (box.x + box.w / 2 - canvasW / 2) * k;
        const centerY = windowY + (box.y + box.h / 2 - canvasH / 2) * k;
        const counter = 1 / Math.max(0.01, scale * dollTransform.scale); // つまみの大きさを一定にする

        return (
          <div
            style={{
              position: 'absolute',
              left: `${windowX}px`,
              top: `${windowY}px`,
              transform: `translate(-50%, -50%) scale(${dollTransform.scale})`,
              transformOrigin: 'center center',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            <div
              style={{
                position: 'relative',
                transform: `rotate(${rotation}deg) scale(${scale})`,
                transformOrigin: `${(box.x + box.w / 2) * previewUnit}px ${(box.y + box.h / 2) * previewUnit}px`,
              }}
            >
              <PlacedImage
                src={item.imageUrl}
                alt="調整プレビュー"
                hue={colorHue}
                canvasW={canvasW}
                canvasH={canvasH}
                box={box}
                unit={previewUnit}
              />
              {/* シールのような枠: 左上 × で脱がせる、右下で拡大・回転 */}
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
                    style={{ transform: `translate(-50%, -50%) scale(${counter})` }}
                    {...stopGesture}
                    onClick={() => onRemove(item.id)}
                    title="ぬがせる"
                    aria-label="ぬがせる"
                    data-testid="sticker-remove"
                  >
                    ×
                  </button>
                )}
                <div
                  className="sticker-handle sticker-rotate"
                  style={{ transform: `translate(50%, 50%) scale(${counter})` }}
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
            </div>
          </div>
        );
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

      {/* 右上ボタン（完了・リセット・最前面・カラー） */}
      <div className="item-adjust-top-buttons">
        <button className="item-adjust-done-btn-small" onClick={handleClose} title="完了">
          ✓
        </button>
        <button className="item-adjust-reset-btn-small" onClick={handleResetAll} title="リセット">
          ↺
        </button>
        {/* 重なりの前後（アイテムモードのみ） */}
        {!isDollMode && (
          <div className="item-adjust-layer" onTouchStart={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <button className="item-adjust-front-btn" onClick={() => moveLayer(1)} disabled={stackIndex >= stack.length - 1} title="まえへ" data-testid="layer-front">
              ⬆
            </button>
            <div className="item-adjust-layer-pos" data-testid="layer-pos">{stackIndex + 1}/{stack.length}</div>
            <button className="item-adjust-front-btn" onClick={() => moveLayer(-1)} disabled={stackIndex <= 0} title="うしろへ" data-testid="layer-back">
              ⬇
            </button>
          </div>
        )}
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
              title={`色相: ${colorHue}°`}
            />
            <div className="hue-value">{colorHue}°</div>
          </div>
        )}
      </div>

      {/* 着ている服（手前が上）。押すと、その服の調整に切り替える */}
      {!isDollMode && item && stack.length > 1 && (
        <div className="item-adjust-picker" onTouchStart={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-testid="adjust-picker">
          {[...stack].reverse().map((i) => (
            <button key={i.id} className={i.id === item.id ? 'on' : ''} onClick={() => switchTo(i.id)} title={i.name}>
              <img src={i.thumbnailUrl || i.imageUrl} alt={i.name} draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
