/**
 * AvatarCanvas コンポーネント
 * PixiJSでドールと着せた服を表示するキャンバス
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { PixiEngine } from '../engine/PixiEngine';
import type { DollConfig, EquippedItem, DollTransform, ClothingItemData, Position } from '../types';

interface AvatarCanvasProps {
  width?: number;
  height?: number;
  dollConfig?: DollConfig;
  equippedItems: EquippedItem[];
  customFaceUrl?: string;
  dollImageUrl?: string; // ドールベース画像のURL
  backgroundImageUrl?: string; // 背景画像のURL
  dollTransform?: DollTransform; // ドールの位置・スケール
  onCanvasReady?: () => void;
  // movableアイテムドラッグ中プレビュー
  draggingPreview?: {
    item: ClothingItemData;
    position: Position;
  } | null;
  avatarSectionRef?: RefObject<HTMLElement | null>;
}

export function AvatarCanvas({
  width = 400,
  height = 500,
  dollConfig,
  equippedItems,
  customFaceUrl,
  dollImageUrl,
  backgroundImageUrl,
  dollTransform,
  onCanvasReady,
  draggingPreview,
  avatarSectionRef,
}: AvatarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PixiEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  // PixiJS初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // キャンセルフラグ（StrictModeでのクリーンアップ用）
    let cancelled = false;

    // 新しいエンジンインスタンスを作成
    const engine = new PixiEngine();

    const initEngine = async () => {
      try {
        await engine.init(canvas, width, height);

        // キャンセルされていたら処理を中止
        if (cancelled) {
          engine.destroy();
          return;
        }

        // 成功した場合のみrefに保存
        engineRef.current = engine;

        // ドールの初期位置・スケールを設定
        if (dollTransform) {
          engine.setDollTransform(dollTransform);
        }

        // ドールを描画（画像URLまたはプレースホルダー）
        await engine.drawDoll(
          dollConfig ?? {
            width: 200,
            height: 300,
            imageUrl: dollImageUrl || '',
          }
        );

        setIsReady(true);

        // コールバック呼び出し
        onCanvasReady?.();
      } catch (error) {
        console.error('PixiJS初期化エラー:', error);
        engine.destroy();
      }
    };

    initEngine();

    // クリーンアップ
    return () => {
      cancelled = true;
      setIsReady(false);
      // engineRefに保存されているエンジンを破棄
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
      // まだ初期化中のエンジンも破棄
      engine.destroy();
    };
  }, [width, height]); // dollImageUrlを依存配列から除外（別のuseEffectで処理）

  // ドール画像が変わったら更新（エンジン再初期化なし）
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.drawDoll({
        width: 200,
        height: 300,
        imageUrl: dollImageUrl || '',
      });
    }
  }, [dollImageUrl, isReady]);

  // 装備アイテムが変わったら再描画
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.drawClothing(equippedItems);
    }
  }, [equippedItems, isReady]);

  // カスタム顔が変わったら更新
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.setCustomFace(customFaceUrl ?? null);
    }
  }, [customFaceUrl, isReady]);

  // 背景が変わったら更新
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.setBackground(backgroundImageUrl ?? null);
    }
  }, [backgroundImageUrl, isReady]);

  // ドールの位置・スケールが変わったら更新
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized() && dollTransform) {
      engineRef.current.setDollTransform(dollTransform);
      // ドールと服を再描画
      engineRef.current.drawDoll({
        width: 200,
        height: 300,
        imageUrl: dollImageUrl || '',
      });
      engineRef.current.drawClothing(equippedItems);
    }
  }, [dollTransform, isReady]);

  // ドラッグプレビューの位置計算
  const previewStyle = (() => {
    if (!draggingPreview || !avatarSectionRef?.current) return null;
    const rect = avatarSectionRef.current.getBoundingClientRect();
    return {
      left: draggingPreview.position.x - rect.left,
      top: draggingPreview.position.y - rect.top,
    };
  })();

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        id="avatar-canvas"
        data-testid="avatar-canvas"
        style={{
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        }}
      />
      {/* movableアイテムドラッグ中のプレビュー */}
      {draggingPreview && previewStyle && (
        <img
          src={draggingPreview.item.imageUrl}
          alt={draggingPreview.item.name}
          style={{
            position: 'absolute',
            left: previewStyle.left,
            top: previewStyle.top,
            transform: 'translate(-50%, -50%)',
            maxWidth: '80px',
            maxHeight: '80px',
            opacity: 0.7,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
          }}
        />
      )}
    </div>
  );
}
