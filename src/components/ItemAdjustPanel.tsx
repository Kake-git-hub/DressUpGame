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
import { DEFAULT_DOLL_TRANSFORM } from '../types';
import type { ItemAdjustment } from '../hooks/useDressUp';
import { getTransparentImage } from '../services/assetStorage';

interface ItemAdjustPanelProps {
  item: EquippedItem | null;  // nullの場合はドール調整モード
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
  // ドール画像URL（ドール調整モードのプレビュー用）
  dollImageUrl?: string;
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
  onClose,
  canvasWidth,
  canvasHeight,
  dollTransform,
  onDollTransformChange,
  menuOffset = 0,
  rightOffset = 0,
  dollImageUrl,
}: ItemAdjustPanelProps) {
  // ドール調整モードかどうか
  const isDollMode = item === null;

  // キャンバスは画面中央に配置されているため、左上の位置を計算
  const canvasLeft = (window.innerWidth - canvasWidth) / 2;
  const canvasTop = (window.innerHeight - canvasHeight) / 2;

  // 利用可能領域の計算（PixiEngineと同じ計算、キャンバス内座標）
  const availableWidth = Math.max(0, canvasWidth - menuOffset - rightOffset);
  const availableX = menuOffset;

  // 現在の調整値（ローカルステート）- アイテムモード用
  const [offsetX, setOffsetX] = useState(item?.adjustOffsetX ?? 0);
  const [offsetY, setOffsetY] = useState(item?.adjustOffsetY ?? 0);
  const [scale, setScale] = useState(item?.adjustScale ?? 1.0);
  const [rotation, setRotation] = useState(item?.adjustRotation ?? 0);
  const [layerAdjust, setLayerAdjust] = useState(item?.layerAdjust ?? 0);

  // ドール調整用ローカルステート
  const [dollX, setDollX] = useState(dollTransform.x);
  const [dollY, setDollY] = useState(dollTransform.y);
  const [dollScale, setDollScale] = useState(dollTransform.scale);

  // プレビュー用の透過処理済み画像URL
  const [transparentImageUrl, setTransparentImageUrl] = useState<string | null>(null);

  // アイテムが変わったら透過画像を取得
  useEffect(() => {
    if (item?.id && item?.imageUrl) {
      getTransparentImage(item.id, item.imageUrl)
        .then(setTransparentImageUrl)
        .catch(() => setTransparentImageUrl(item.imageUrl)); // フォールバック
    } else {
      setTransparentImageUrl(null);
    }
  }, [item?.id, item?.imageUrl]);

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
      setLayerAdjust(item.layerAdjust ?? 0);
    }
  }, [item?.id, item?.adjustOffsetX, item?.adjustOffsetY, item?.adjustScale, item?.adjustRotation, item?.layerAdjust]);

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

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      });
    }
    onCloseRef.current();
  }, [isDollMode, dollX, dollY, dollScale, offsetX, offsetY, scale, rotation, layerAdjust]);

  // 位置の範囲（キャンバスサイズの50%まで）
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
    }
  }, [isDollMode]);

  // レイヤーを手前に
  const handleLayerUp = useCallback(() => {
    setLayerAdjust((prev) => Math.min(prev + 5, 50));
  }, []);

  // レイヤーを奥に
  const handleLayerDown = useCallback(() => {
    setLayerAdjust((prev) => Math.max(prev - 5, -50));
  }, []);

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
        setScale((prev) => Math.max(0.5, Math.min(2.0, prev + delta)));
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
      {!isDollMode && transparentImageUrl && (() => {
        // ドール中心位置を計算（PixiEngineと同じ計算: 利用可能領域内の%位置）
        const dollCenterX = availableX + (availableWidth * dollTransform.x) / 100;
        const dollCenterY = (canvasHeight * dollTransform.y) / 100;
        
        // アイテムの基準位置を計算（キャンバス内座標）
        let baseX: number;
        let baseY: number;
        
        if (item?.movable && ((item.offsetX ?? 0) !== 0 || (item.offsetY ?? 0) !== 0)) {
          // movableアイテム: 中央(50%) + offset で計算（PixiEngineと同じ）
          baseX = availableX + (availableWidth * (50 + (item.offsetX ?? 0))) / 100;
          baseY = (canvasHeight * (50 + (item.offsetY ?? 0))) / 100;
        } else {
          // 通常アイテム: ドール中心
          baseX = dollCenterX;
          baseY = dollCenterY;
        }
        
        // 調整オフセットを適用
        baseX += offsetX;
        baseY += offsetY;
        
        // キャンバス内座標 → window座標に変換
        const windowX = canvasLeft + baseX;
        const windowY = canvasTop + baseY;

        return (
          <div
            style={{
              position: 'absolute',
              left: `${windowX}px`,
              top: `${windowY}px`,
              transform: `translate(-50%, -50%) scale(${scale * dollTransform.scale}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            <img
              src={transparentImageUrl}
              alt="調整プレビュー"
              style={{
                height: `${canvasHeight * 0.9}px`,
                width: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
        );
      })()}

      {/* ドールモード時：ドール画像のプレビュー */}
      {isDollMode && (() => {
        const dollCenterX = availableX + (availableWidth * dollX) / 100;
        const dollCenterY = (canvasHeight * dollY) / 100;
        
        // キャンバス内座標 → window座標に変換
        const windowX = canvasLeft + dollCenterX;
        const windowY = canvasTop + dollCenterY;

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
            {dollImageUrl ? (
              <img
                src={dollImageUrl}
                alt="ドールプレビュー"
                style={{
                  height: `${canvasHeight * 0.9}px`,
                  width: 'auto',
                  objectFit: 'contain',
                }}
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

      {/* 右上ボタン（完了・リセット） */}
      <div className="item-adjust-top-buttons">
        <button className="item-adjust-done-btn-small" onClick={handleClose} title="完了">
          ✓
        </button>
        <button className="item-adjust-reset-btn-small" onClick={handleResetAll} title="リセット">
          ↺
        </button>
      </div>

      {/* レイヤー調整ボタン（アイテムモードのみ、左下） */}
      {!isDollMode && (
        <div className="item-adjust-layer-buttons">
          <button 
            className="item-adjust-layer-btn" 
            onClick={handleLayerUp} 
            title="手前へ"
          >
            <span className="layer-icon">⬆</span>
            <span className="layer-label">手前</span>
          </button>
          <button 
            className="item-adjust-layer-btn" 
            onClick={handleLayerDown} 
            title="奥へ"
          >
            <span className="layer-icon">⬇</span>
            <span className="layer-label">奥</span>
          </button>
          {layerAdjust !== 0 && (
            <span className="layer-value">{layerAdjust > 0 ? `+${layerAdjust}` : layerAdjust}</span>
          )}
        </div>
      )}
    </div>
  );
}
