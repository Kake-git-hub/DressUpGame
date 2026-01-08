/**
 * アイテム調整パネル
 * タッチジェスチャーで位置・大きさ・傾きを調整
 * - 一本指タッチ: 位置移動
 * - ピンチ: 拡大縮小
 * - 二本指回転: 傾き
 * ドール調整モード: 服がない場合にドールの位置・サイズを調整
 */
import { useCallback, useState, useEffect, useRef } from 'react';
import type { EquippedItem, DollTransform } from '../types';
import type { ItemAdjustment } from '../hooks/useDressUp';

// デバウンス用タイマーID型
type TimerId = ReturnType<typeof setTimeout>;

interface ItemAdjustPanelProps {
  item: EquippedItem | null;  // nullの場合はドール調整モード
  allItems: EquippedItem[];   // 全装備アイテム（切り替え用）
  onAdjust: (adjustment: ItemAdjustment) => void;
  onItemChange: (itemId: string | null) => void;  // null = ドール調整
  onClose: () => void;
  canvasWidth: number;
  canvasHeight: number;
  // ドール調整用
  dollTransform: DollTransform;
  onDollTransformChange: (transform: DollTransform) => void;
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
  allItems,
  onAdjust,
  onItemChange,
  onClose,
  canvasWidth,
  canvasHeight,
  dollTransform,
  onDollTransformChange,
}: ItemAdjustPanelProps) {
  // ドール調整モードかどうか
  const isDollMode = item === null;

  // 現在の調整値（ローカルステート）- アイテムモード用
  const [offsetX, setOffsetX] = useState(item?.adjustOffsetX ?? 0);
  const [offsetY, setOffsetY] = useState(item?.adjustOffsetY ?? 0);
  const [scale, setScale] = useState(item?.adjustScale ?? 1.0);
  const [rotation, setRotation] = useState(item?.adjustRotation ?? 0);

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

  // アイテムが変わったらリセット
  useEffect(() => {
    if (item) {
      setOffsetX(item.adjustOffsetX ?? 0);
      setOffsetY(item.adjustOffsetY ?? 0);
      setScale(item.adjustScale ?? 1.0);
      setRotation(item.adjustRotation ?? 0);
    }
  }, [item?.id, item?.adjustOffsetX, item?.adjustOffsetY, item?.adjustScale, item?.adjustRotation]);

  // ドールTransformが変わったらローカルステートも更新
  useEffect(() => {
    setDollX(dollTransform.x);
    setDollY(dollTransform.y);
    setDollScale(dollTransform.scale);
  }, [dollTransform.x, dollTransform.y, dollTransform.scale]);

  // onAdjustをrefで保持（依存配列から除外するため）
  const onAdjustRef = useRef(onAdjust);
  onAdjustRef.current = onAdjust;

  const onDollTransformChangeRef = useRef(onDollTransformChange);
  onDollTransformChangeRef.current = onDollTransformChange;

  // デバウンスタイマー
  const debounceTimerRef = useRef<TimerId | null>(null);
  const dollDebounceTimerRef = useRef<TimerId | null>(null);

  // アイテム値が変わったら親に通知（震え対策: デバウンス + 前回値比較）
  const prevValuesRef = useRef({ offsetX, offsetY, scale, rotation });
  useEffect(() => {
    if (isDollMode) return; // ドールモードでは無視
    
    const prev = prevValuesRef.current;
    // 値が実際に変わった場合のみ通知
    if (
      prev.offsetX !== offsetX ||
      prev.offsetY !== offsetY ||
      prev.scale !== scale ||
      prev.rotation !== rotation
    ) {
      prevValuesRef.current = { offsetX, offsetY, scale, rotation };
      
      // 既存タイマーをクリア
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      // 16ms後に通知（60fps相当）
      debounceTimerRef.current = setTimeout(() => {
        onAdjustRef.current({
          adjustOffsetX: offsetX,
          adjustOffsetY: offsetY,
          adjustScale: scale,
          adjustRotation: rotation,
        });
      }, 16);
    }
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [offsetX, offsetY, scale, rotation, isDollMode]);

  // ドール値が変わったら親に通知
  const prevDollValuesRef = useRef({ dollX, dollY, dollScale });
  useEffect(() => {
    if (!isDollMode) return; // アイテムモードでは無視
    
    const prev = prevDollValuesRef.current;
    if (
      prev.dollX !== dollX ||
      prev.dollY !== dollY ||
      prev.dollScale !== dollScale
    ) {
      prevDollValuesRef.current = { dollX, dollY, dollScale };
      
      if (dollDebounceTimerRef.current) {
        clearTimeout(dollDebounceTimerRef.current);
      }
      
      dollDebounceTimerRef.current = setTimeout(() => {
        onDollTransformChangeRef.current({
          x: dollX,
          y: dollY,
          scale: dollScale,
        });
      }, 16);
    }
    
    return () => {
      if (dollDebounceTimerRef.current) {
        clearTimeout(dollDebounceTimerRef.current);
      }
    };
  }, [dollX, dollY, dollScale, isDollMode]);

  // 位置の範囲（キャンバスサイズの50%まで）
  const maxOffset = Math.min(canvasWidth, canvasHeight) * 0.5;

  // 全リセット
  const handleResetAll = useCallback(() => {
    if (isDollMode) {
      // ドールモード: 中央に戻す
      setDollX(50);
      setDollY(50);
      setDollScale(1.0);
    } else {
      // アイテムモード
      setOffsetX(0);
      setOffsetY(0);
      setScale(1.0);
      setRotation(0);
    }
  }, [isDollMode]);

  // 前のアイテムへ
  const handlePrevItem = useCallback(() => {
    if (isDollMode) {
      // ドールモード → 最後のアイテムへ
      if (allItems.length > 0) {
        const lastItem = allItems[allItems.length - 1];
        onItemChange(lastItem.id);
      }
    } else {
      const currentIndex = allItems.findIndex(i => i.id === item?.id);
      if (currentIndex > 0) {
        // 前のアイテムへ
        onItemChange(allItems[currentIndex - 1].id);
      } else if (currentIndex === 0) {
        // 最初のアイテム → ドールへは行かない（服がある場合）
        // 循環して最後のアイテムへ
        onItemChange(allItems[allItems.length - 1].id);
      }
    }
  }, [isDollMode, allItems, item?.id, onItemChange]);

  // 次のアイテムへ
  const handleNextItem = useCallback(() => {
    if (isDollMode) {
      // ドールモード → 最初のアイテムへ
      if (allItems.length > 0) {
        onItemChange(allItems[0].id);
      }
    } else {
      const currentIndex = allItems.findIndex(i => i.id === item?.id);
      if (currentIndex < allItems.length - 1) {
        // 次のアイテムへ
        onItemChange(allItems[currentIndex + 1].id);
      } else {
        // 最後のアイテム → ドールモードへ（服がある場合はスキップ）
        // 循環して最初のアイテムへ
        onItemChange(allItems[0].id);
      }
    }
  }, [isDollMode, allItems, item?.id, onItemChange]);

  // 現在の調整対象名
  const currentTargetName = isDollMode ? 'ドール' : (item?.name ?? '');
  const currentIndex = isDollMode ? -1 : allItems.findIndex(i => i.id === item?.id);
  const totalItems = allItems.length;

  // タッチ開始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    setTouchCount(touches.length);

    // ドールモードとアイテムモードで使う値を切り替え
    const currentOffsetX = isDollMode ? dollX : offsetX;
    const currentOffsetY = isDollMode ? dollY : offsetY;
    const currentScale = isDollMode ? dollScale : scale;

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
        initialRotation: rotation,
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
        initialRotation: rotation,
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
      
      if (isDollMode) {
        // ドールモード: パーセンテージで移動
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const baseSize = Math.min(rect.width, rect.height);
        const percentX = (deltaX / baseSize) * 100;
        const percentY = (deltaY / baseSize) * 100;
        const newX = Math.max(-50, Math.min(150, touchStartRef.current.offsetX + percentX));
        const newY = Math.max(-50, Math.min(150, touchStartRef.current.offsetY + percentY));
        setDollX(newX);
        setDollY(newY);
      } else {
        // アイテムモード: ピクセルで移動
        const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetX + deltaX));
        const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, touchStartRef.current.offsetY + deltaY));
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
          const newScale = Math.max(0.5, Math.min(2.0, touchStartRef.current.initialScale * scaleRatio));
          setScale(newScale);
        }
      }

      // 回転変更（アイテムモードのみ）
      if (!isDollMode) {
        const angleDelta = currentAngle - touchStartRef.current.initialAngle;
        let newRotation = touchStartRef.current.initialRotation + angleDelta;
        // -180〜180の範囲に正規化
        while (newRotation > 180) newRotation -= 360;
        while (newRotation < -180) newRotation += 360;
        setRotation(newRotation);
      }
    }
  }, [isDollMode, maxOffset, touchCount]);

  // タッチ終了
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const touches = e.touches;
    setTouchCount(touches.length);

    // ドールモードとアイテムモードで使う値を切り替え
    const currentOffsetX = isDollMode ? dollX : offsetX;
    const currentOffsetY = isDollMode ? dollY : offsetY;
    const currentScale = isDollMode ? dollScale : scale;

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
        initialRotation: rotation,
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

    if (isDollMode) {
      // ドールモード: パーセンテージで移動
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const baseSize = Math.min(rect.width, rect.height);
      const percentX = (deltaX / baseSize) * 100;
      const percentY = (deltaY / baseSize) * 100;
      const newX = Math.max(-50, Math.min(150, mouseStartRef.current.offsetX + percentX));
      const newY = Math.max(-50, Math.min(150, mouseStartRef.current.offsetY + percentY));
      setDollX(newX);
      setDollY(newY);
    } else {
      // アイテムモード
      const newOffsetX = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetX + deltaX));
      const newOffsetY = Math.max(-maxOffset, Math.min(maxOffset, mouseStartRef.current.offsetY + deltaY));
      setOffsetX(newOffsetX);
      setOffsetY(newOffsetY);
    }
  }, [isDollMode, isMouseDragging, maxOffset]);

  const handleMouseUp = useCallback(() => {
    setIsMouseDragging(false);
    mouseStartRef.current = null;
  }, []);

  // ホイールでスケール・回転（Shift押しながらで回転）
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
        setScale((prev) => Math.max(0.5, Math.min(2.0, prev + delta)));
      }
    }
  }, [isDollMode]);

  // 前後ボタンを表示するか（服がある場合のみ）
  const showNavButtons = totalItems > 0;

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
      {/* 上部: 対象名と操作ガイド */}
      <div className="item-adjust-header">
        <span className="item-adjust-target-name">
          {isDollMode ? '🎀 ドール' : `👗 ${currentTargetName}`}
          {!isDollMode && totalItems > 1 && ` (${currentIndex + 1}/${totalItems})`}
        </span>
        <span className="item-adjust-guide">
          {isDollMode ? 'ドラッグで移動 / ピンチでサイズ' : 'ドラッグで移動 / ピンチでサイズ / 二本指で回転'}
        </span>
      </div>

      {/* 右上ボタン（完了・リセット） */}
      <div className="item-adjust-top-buttons">
        <button className="item-adjust-done-btn-small" onClick={onClose} title="完了">
          ✓
        </button>
        <button className="item-adjust-reset-btn-small" onClick={handleResetAll} title="リセット">
          ↺
        </button>
      </div>

      {/* 下部: 前後切り替えボタン（服がある場合のみ） */}
      {showNavButtons && (
        <div className="item-adjust-nav-buttons">
          <button className="item-adjust-nav-btn" onClick={handlePrevItem} title="前へ">
            ◀
          </button>
          <button className="item-adjust-nav-btn item-adjust-nav-btn-doll" onClick={() => onItemChange(null)} title="ドール調整">
            🎀
          </button>
          <button className="item-adjust-nav-btn" onClick={handleNextItem} title="次へ">
            ▶
          </button>
        </div>
      )}
    </div>
  );
}
