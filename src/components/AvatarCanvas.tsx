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
  menuOffset?: number; // メニュー幅オフセット（左側）
  rightOffset?: number; // 右ボタン領域オフセット（右側）
  chromaKeyEnabled?: boolean; // クロマキー有効フラグ
  adjustingItemId?: string | null; // 調整中のアイテムID（非表示にする）
  isPortrait?: boolean; // 縦画面モード
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
  rightOffset = 60,
  chromaKeyEnabled = false,
  adjustingItemId = null,
  isPortrait = false,
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

        // メニューオフセット・右オフセットを設定（背景・ドール位置調整用）
        engine.setMenuOffset(menuOffset);
        engine.setRightOffset(rightOffset);
        
        // 縦画面モードを設定
        engine.setPortraitMode(isPortrait);

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

        // コンテキストロスト時の再描画コールバックを設定
        engine.setContextLostCallback(async () => {
          // キャンセルされていたら処理を中止
          if (cancelled || !engineRef.current?.isInitialized()) return;
          
          // 全コンテンツを再描画
          console.log('WebGLコンテキスト復元：再描画開始');
          try {
            if (backgroundImageUrl) {
              await engineRef.current.setBackground(backgroundImageUrl);
            }
            await engineRef.current.drawDoll({
              width: 200,
              height: 300,
              imageUrl: dollImageUrl || '',
            });
            await engineRef.current.drawClothing(equippedItems);
            if (customFaceUrl) {
              await engineRef.current.setCustomFace(customFaceUrl);
            }
            engineRef.current.forceRedraw();
          } catch (error) {
            console.error('WebGLコンテキスト復元時の再描画エラー:', error);
          }
        });
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
  }, []); // 初回のみ初期化（リサイズは別のuseEffectで処理）

  // キャンバスサイズが変わったらリサイズ＆再描画
  useEffect(() => {
    const redrawAfterResize = async () => {
      if (!isReady || !engineRef.current?.isInitialized()) return;
      
      console.log('リサイズ検出:', width, 'x', height);
      
      // レンダラーをリサイズ
      engineRef.current.resize(width, height);
      
      // メニューオフセットを再設定
      engineRef.current.setMenuOffset(menuOffset);
      engineRef.current.setRightOffset(rightOffset);
      engineRef.current.setPortraitMode(isPortrait);
      
      // 少し待ってから再描画（レンダラーの準備待ち）
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (!engineRef.current?.isInitialized()) return;
      
      try {
        // 全コンテンツを再描画
        if (backgroundImageUrl) {
          await engineRef.current.setBackground(backgroundImageUrl);
        }
        await engineRef.current.drawDoll({
          width: 200,
          height: 300,
          imageUrl: dollImageUrl || '',
        });
        const itemsToRender = adjustingItemId
          ? equippedItems.filter(item => item.id !== adjustingItemId)
          : equippedItems;
        await engineRef.current.drawClothing(itemsToRender);
        if (customFaceUrl) {
          await engineRef.current.setCustomFace(customFaceUrl);
        }
        engineRef.current.forceRedraw();
      } catch (error) {
        console.error('リサイズ後の再描画エラー:', error);
      }
    };
    
    redrawAfterResize();
  }, [width, height, isReady, menuOffset, rightOffset, isPortrait]);

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
      // 調整中のアイテムは非表示にする
      const itemsToRender = adjustingItemId
        ? equippedItems.filter(item => item.id !== adjustingItemId)
        : equippedItems;
      engineRef.current.drawClothing(itemsToRender);
    }
  }, [equippedItems, adjustingItemId, isReady]);

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

  // 縦画面モードが変わったら更新
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.setPortraitMode(isPortrait);
    }
  }, [isPortrait, isReady]);

  // iPad等でバックグラウンドから復帰した時に再描画（WebGLコンテキストロスト対策）
  useEffect(() => {
    // 再描画処理（共通）
    const redrawAll = async () => {
      if (!isReady || !engineRef.current?.isInitialized()) return;
      
      // 少し待ってから再描画（WebGL復帰待ち）
      await new Promise(resolve => setTimeout(resolve, 150));
      
      if (!engineRef.current?.isInitialized()) return;
      
      console.log('画面復帰：再描画開始');
      try {
        if (backgroundImageUrl) {
          await engineRef.current.setBackground(backgroundImageUrl);
        }
        await engineRef.current.drawDoll({
          width: 200,
          height: 300,
          imageUrl: dollImageUrl || '',
        });
        await engineRef.current.drawClothing(equippedItems);
        if (customFaceUrl) {
          await engineRef.current.setCustomFace(customFaceUrl);
        }
        engineRef.current.forceRedraw();
      } catch (error) {
        console.error('画面復帰時の再描画エラー:', error);
      }
    };

    // visibilitychange（Chrome/Firefox用）
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        redrawAll();
      }
    };

    // pageshow（Safari bfcache対策）
    const handlePageShow = (event: PageTransitionEvent) => {
      // persisted=true はbfcacheから復元された場合
      if (event.persisted) {
        console.log('Safari bfcache復元検出');
        redrawAll();
      }
    };

    // focus（Safari追加対策：別アプリから戻った時）
    const handleFocus = () => {
      // Safariでは別アプリから戻った時にvisibilitychangeが発火しないことがある
      redrawAll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isReady, backgroundImageUrl, dollImageUrl, equippedItems, customFaceUrl]);

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
