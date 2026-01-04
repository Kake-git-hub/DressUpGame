/**
 * AvatarCanvas コンポーネント
 * PixiJSでドールと着せた服を表示するキャンバス
 */
import { useEffect, useRef, useState } from 'react';
import { PixiEngine } from '../engine/PixiEngine';
import type { DollConfig, EquippedItem } from '../types';

interface AvatarCanvasProps {
  width?: number;
  height?: number;
  dollConfig?: DollConfig;
  equippedItems: EquippedItem[];
  customFaceUrl?: string;
  dollImageUrl?: string; // ドールベース画像のURL
  backgroundImageUrl?: string; // 背景画像のURL
  onCanvasReady?: () => void;
}

export function AvatarCanvas({
  width = 400,
  height = 500,
  dollConfig,
  equippedItems,
  customFaceUrl,
  dollImageUrl,
  backgroundImageUrl,
  onCanvasReady,
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

  return (
    <canvas
      ref={canvasRef}
      id="avatar-canvas"
      data-testid="avatar-canvas"
      style={{
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      }}
    />
  );
}
