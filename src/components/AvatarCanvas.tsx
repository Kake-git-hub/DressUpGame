/**
 * AvatarCanvas コンポーネント
 * PixiJSでドールと着せた服を表示するキャンバス
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { PixiEngine } from '../engine/PixiEngine';
import type { DollConfig, EquippedItem, DollTransform } from '../types';

// 外部から呼び出せるメソッド
export interface AvatarCanvasHandle {
  takeScreenshot: () => Promise<string | null>;
  setChromaKeyEnabled: (enabled: boolean) => void;
  isChromaKeyEnabled: () => boolean;
}

interface AvatarCanvasProps {
  width?: number;
  height?: number;
  dollConfig?: DollConfig;
  equippedItems: EquippedItem[];
  customFaceUrl?: string;
  dollImageUrl?: string; // ドールベース画像のURL
  backgroundImageUrl?: string; // 背景画像のURL
  dollTransform?: DollTransform; // ドールの位置・スケール
  menuOffset?: number; // メニュー幅オフセット（背景位置調整用）
  chromaKeyEnabled?: boolean; // クロマキー有効フラグ
  onCanvasReady?: () => void;
}

export const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(function AvatarCanvas({
  width = 400,
  height = 500,
  dollConfig,
  equippedItems,
  customFaceUrl,
  dollImageUrl,
  backgroundImageUrl,
  dollTransform,
  menuOffset = 0,
  chromaKeyEnabled = false,
  onCanvasReady,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PixiEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 外部に公開するメソッド
  useImperativeHandle(ref, () => ({
    takeScreenshot: async () => {
      if (engineRef.current?.isInitialized()) {
        return engineRef.current.takeScreenshot();
      }
      return null;
    },
    setChromaKeyEnabled: (enabled: boolean) => {
      if (engineRef.current?.isInitialized()) {
        engineRef.current.setChromaKeyEnabled(enabled);
      }
    },
    isChromaKeyEnabled: () => {
      return engineRef.current?.isChromaKeyEnabled() ?? false;
    },
  }), []);

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

        // メニューオフセットを設定（背景位置調整用）
        engine.setMenuOffset(menuOffset);

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

  // クロマキー有効フラグが変わったら服を再描画
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.setChromaKeyEnabled(chromaKeyEnabled);
      // 服を再描画してフィルタを適用
      engineRef.current.drawClothing(equippedItems);
    }
  }, [chromaKeyEnabled, isReady]);

  return (
    <canvas
      ref={canvasRef}
      id="avatar-canvas"
      data-testid="avatar-canvas"
      style={{
        borderRadius: '0',
      }}
    />
  );
});
