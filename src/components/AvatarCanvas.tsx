/**
 * AvatarCanvas コンポーネント
 * PixiJSでドールと着せた服を表示するキャンバス
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { PixiEngine } from '../engine/PixiEngine';
import { activeHides } from '../engine/hides';
import type { DollConfig, DollData, EquippedItem, DollTransform } from '../types';

// 外部から呼び出せるメソッド
export interface AvatarCanvasHandle {
  takeScreenshot: () => Promise<string | null>;
  pauseRendering: () => void;
  resumeRendering: () => void;
}

interface AvatarCanvasProps {
  width?: number;
  height?: number;
  equippedItems: EquippedItem[];
  doll?: DollData | null; // 表示するドール
  backgroundImageUrl?: string; // 背景画像のURL
  dollTransform?: DollTransform; // ドールの位置・スケール
  menuOffset?: number; // メニュー幅オフセット（左側）
  rightOffset?: number; // 右ボタン領域オフセット（右側）
  adjustingItemId?: string | null; // 調整中のアイテムID（非表示にする）
  // キャンバスに描かないもの（調整中の服と、それより手前のもの。調整画面が代わりに重ねて描く）
  hidden?: HiddenSheets;
  onCanvasReady?: () => void;
}

function toDollConfig(doll: DollData | null | undefined, hides: DollConfig['hides'] = []): DollConfig {
  return {
    width: 200,
    height: 300,
    imageUrl: doll?.bodyImageUrl ?? '',
    canvasW: doll?.canvasW,
    canvasH: doll?.canvasH,
    box: doll?.box,
    hides,
  };
}

// キャンバスに描かないもの: 服・ドール
export interface HiddenSheets {
  items: string[];
  doll: boolean;
}

// hidden は、服の ID を改行でつないだもの
function hiddenIds(hidden: string): Set<string> {
  return new Set(hidden.split('\n').filter(Boolean));
}

export const AvatarCanvas = forwardRef<AvatarCanvasHandle, AvatarCanvasProps>(function AvatarCanvas({
  width = 400,
  height = 500,
  equippedItems,
  doll,
  backgroundImageUrl,
  dollTransform,
  menuOffset = 0,
  rightOffset = 60,
  adjustingItemId = null,
  hidden,
  onCanvasReady,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PixiEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 非同期の再描画から参照する、最新の props
  const hiddenKey = [adjustingItemId ?? '', ...(hidden?.items ?? [])].join('\n');
  const hideDoll = hidden?.doll ?? false;
  const latest = useRef({ equippedItems, doll, backgroundImageUrl, adjustingItemId, hiddenKey });
  useEffect(() => {
    latest.current = { equippedItems, doll, backgroundImageUrl, adjustingItemId, hiddenKey };
  });


  // 外部に公開するメソッド
  useImperativeHandle(ref, () => ({
    takeScreenshot: async () => {
      if (engineRef.current?.isInitialized()) {
        return engineRef.current.takeScreenshot();
      }
      return null;
    },
    pauseRendering: () => {
      if (engineRef.current?.isInitialized()) {
        engineRef.current.pauseRendering();
      }
    },
    resumeRendering: () => {
      if (engineRef.current?.isInitialized()) {
        engineRef.current.resumeRendering();
      }
    },
  }), []);

  // 背景・ドール・服をすべて描き直す
  const redrawAll = async (engine: PixiEngine) => {
    const { equippedItems: items, doll: currentDoll, backgroundImageUrl: bg, adjustingItemId: adjusting, hiddenKey: hidden } = latest.current;
    await engine.setBackground(bg ?? null);
    await engine.drawDoll(toDollConfig(currentDoll, activeHides(items, adjusting)));
    await engine.drawClothing(items, hiddenIds(hidden));
    engine.forceRedraw();
  };

  // PixiJS初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // キャンセルフラグ（StrictModeでのクリーンアップ用）
    let cancelled = false;
    const engine = new PixiEngine();

    const initEngine = async () => {
      try {
        await engine.init(canvas, width, height);
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        engine.setMenuOffset(menuOffset);
        engine.setRightOffset(rightOffset);
        if (dollTransform) {
          engine.setDollTransform(dollTransform);
        }
        await engine.drawDoll(toDollConfig(latest.current.doll, activeHides(latest.current.equippedItems, latest.current.adjustingItemId)));
        setIsReady(true);
        onCanvasReady?.();

        // WebGLコンテキスト復元時は全体を描き直す
        engine.setContextLostCallback(() => {
          if (cancelled || !engineRef.current?.isInitialized()) return;
          redrawAll(engineRef.current).catch((error) => console.error('WebGLコンテキスト復元時の再描画エラー:', error));
        });
      } catch (error) {
        console.error('PixiJS初期化エラー:', error);
        engine.destroy();
      }
    };

    initEngine();

    return () => {
      cancelled = true;
      setIsReady(false);
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回のみ初期化（リサイズや中身の変化は別の effect で反映する）
  }, []);

  // キャンバスサイズが変わったらリサイズ＆再描画
  useEffect(() => {
    const engine = engineRef.current;
    if (!isReady || !engine?.isInitialized()) return;
    let cancelled = false;
    engine.resize(width, height);
    engine.setMenuOffset(menuOffset);
    engine.setRightOffset(rightOffset);
    // 少し待ってから再描画（レンダラーの準備待ち）
    const timer = setTimeout(() => {
      if (cancelled || !engine.isInitialized()) return;
      redrawAll(engine).catch((error) => console.error('リサイズ後の再描画エラー:', error));
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [width, height, isReady, menuOffset, rightOffset]);

  // 非同期の描画が終わったら必ず1フレーム描く
  // （描画ループは操作がないと停止しているので、ここで描かないと画面に反映されない）
  const redrawWhenDone = (work: Promise<unknown>) => {
    const engine = engineRef.current;
    work
      .then(() => engine?.forceRedraw())
      .catch((error) => console.error('描画エラー:', error));
  };

  // ドールか、服が隠す所が変わったら更新（エンジン再初期化なし）
  const hidesKey = activeHides(equippedItems, adjustingItemId)
    .map((h) => h.url)
    .join('\n');
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      redrawWhenDone(engineRef.current.drawDoll(toDollConfig(doll, activeHides(latest.current.equippedItems, latest.current.adjustingItemId))));
    }
  }, [doll, hidesKey, isReady]);

  // 装備アイテムが変わったら再描画
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      // 調整中のアイテム（と、その手前の服）は描かない（調整画面が代わりに重ねて描く）
      redrawWhenDone(engineRef.current.drawClothing(equippedItems, hiddenIds(hiddenKey)));
    }
  }, [equippedItems, hiddenKey, isReady]);

  // ドールを隠す・戻す
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      engineRef.current.setDollVisible(!hideDoll);
      engineRef.current.forceRedraw();
    }
  }, [hideDoll, isReady]);

  // 背景が変わったら更新
  useEffect(() => {
    if (isReady && engineRef.current?.isInitialized()) {
      redrawWhenDone(engineRef.current.setBackground(backgroundImageUrl ?? null));
    }
  }, [backgroundImageUrl, isReady]);

  // ドールの位置・スケールが変わったら更新
  useEffect(() => {
    const engine = engineRef.current;
    if (isReady && engine?.isInitialized() && dollTransform) {
      engine.setDollTransform(dollTransform);
      redrawWhenDone(
        Promise.all([
          engine.drawDoll(toDollConfig(latest.current.doll, activeHides(latest.current.equippedItems, latest.current.adjustingItemId))),
          engine.drawClothing(latest.current.equippedItems, hiddenIds(latest.current.hiddenKey)),
        ])
      );
    }
  }, [dollTransform, isReady]);

  // iPad等でバックグラウンドから復帰した時に再描画（WebGLコンテキストロスト対策）
  useEffect(() => {
    if (!isReady) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const redraw = () => {
      if (timer) clearTimeout(timer);
      // 少し待ってから再描画（WebGL復帰待ち）
      timer = setTimeout(() => {
        const engine = engineRef.current;
        if (!engine?.isInitialized()) return;
        redrawAll(engine).catch((error) => console.error('画面復帰時の再描画エラー:', error));
      }, 150);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') redraw();
    };
    // Safari bfcache から復元された場合
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) redraw();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    // Safari は別アプリから戻った時に visibilitychange が発火しないことがある
    window.addEventListener('focus', redraw);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', redraw);
    };
  }, [isReady]);

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
