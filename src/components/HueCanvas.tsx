/**
 * HueCanvas
 * 画像を、色スライダーの色変えをした状態で表示する（調整中のプレビュー用）。
 * ブラウザのフィルター機能に頼らず画素を直接変換するので、どのブラウザでも
 * 確定後の描画と同じ色になり、スライダーの動きにその場で追従する。
 * 黒っぽい絵（黒髪など）は、色相を回す代わりに、黒い所に色を付ける（pipeline/recolor.ts）。
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { isDarkImage, recolor } from '../pipeline/recolor';

interface HueCanvasProps {
  src: string;
  hue: number; // 度（-180〜180）。0 は元の色
  // 黒っぽい絵として色を付けるか。省くと、この絵だけを見て決める。
  // 髪は、前髪とうしろがみで同じ色変えにするために、親が決めて渡す（onDark で、この絵の判定を親に知らせる）
  dark?: boolean;
  onDark?: (dark: boolean) => void;
  // 元の絵の画素（色を付ける前）を読めたとき・読めなかったとき（null）に呼ぶ。色のスライダーの帯の色を出すのに使う
  onPixels?: (pixels: Uint8ClampedArray | null) => void;
  style?: CSSProperties;
  testId?: string;
}

interface Loaded {
  src: string;
  image: HTMLImageElement;
  original: ImageData | null; // 画素を読めなかった場合は null（色を変えずに表示する）
  output: ImageData | null;
  dark: boolean; // この絵が黒っぽいか
}

export function HueCanvas({ src, hue, dark, onDark, onPixels, style, testId }: HueCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const hueRef = useRef(hue);
  const darkRef = useRef(dark);
  const onDarkRef = useRef(onDark);
  const onPixelsRef = useRef(onPixels);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    onDarkRef.current = onDark;
    onPixelsRef.current = onPixels;
  });

  // 最新の色相で描く
  const paint = () => {
    const canvas = canvasRef.current;
    const loaded = loadedRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !loaded || !ctx) return;
    if (loaded.original && loaded.output) {
      recolor(loaded.original.data, loaded.output.data, hueRef.current, darkRef.current ?? loaded.dark);
      ctx.putImageData(loaded.output, 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loaded.image, 0, 0);
    }
    canvas.dataset.hue = String(hueRef.current);
    canvas.dataset.dark = String(darkRef.current ?? loaded.dark);
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
        dark: original ? isDarkImage(original.data) : false,
      };
      onDarkRef.current?.(loadedRef.current.dark);
      onPixelsRef.current?.(original ? original.data : null);
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
    darkRef.current = dark;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [hue, dark]);

  useEffect(() => {
    return () => {
      // 取り消したら、「予約あり」の印も消す。残すと、開発モード（後始末と準備を 2 回呼ぶ）で、二度と描き直さなくなる
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} data-testid={testId} style={style} />;
}
