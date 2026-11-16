/**
 * HueCanvas
 * 画像を、色相を変えた状態で表示する（調整中のプレビュー用）。
 * ブラウザのフィルター機能に頼らず画素を直接変換するので、どのブラウザでも
 * 確定後の描画と同じ色になり、スライダーの動きにその場で追従する。
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { applyHue } from '../pipeline/hue';

interface HueCanvasProps {
  src: string;
  hue: number; // 度（-180〜180）。0 は元の色
  style?: CSSProperties;
  testId?: string;
}

interface Loaded {
  src: string;
  image: HTMLImageElement;
  original: ImageData | null; // 画素を読めなかった場合は null（色を変えずに表示する）
  output: ImageData | null;
}

export function HueCanvas({ src, hue, style, testId }: HueCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const hueRef = useRef(hue);
  const frameRef = useRef<number | null>(null);

  // 最新の色相で描く
  const paint = () => {
    const canvas = canvasRef.current;
    const loaded = loadedRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !loaded || !ctx) return;
    if (loaded.original && loaded.output) {
      applyHue(loaded.original.data, loaded.output.data, hueRef.current);
      ctx.putImageData(loaded.output, 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loaded.image, 0, 0);
    }
    canvas.dataset.hue = String(hueRef.current);
  };

  // 画像を読み込み、元の画素を取っておく
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous'; // 別オリジンの画像でも画素を読めるようにする
    image.onload = () => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      let original: ImageData | null = null;
      try {
        original = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        // 画素を読めない画像は、色を変えずに表示する
      }
      loadedRef.current = {
        src,
        image,
        original,
        output: original ? new ImageData(canvas.width, canvas.height) : null,
      };
      paint();
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [src]);

  // 色相が変わったら描き直す（1 フレームに 1 回にまとめる）
  useEffect(() => {
    hueRef.current = hue;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [hue]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} data-testid={testId} style={style} />;
}
