/**
 * ドールに、服を着せた絵（つくる・クローゼット・届いた演出で使う小さな見本）
 *
 * ゲームの描画（PixiJS）は使わず、絵を CSS で重ねるだけ。色（既定の色）は、ゲームと同じ色変え（HueCanvas）で付ける。
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { HueCanvas } from '../components/HueCanvas';
import type { Box } from '../content/manifest';
import type { DollData } from '../types';
import type { ItemFit } from '../engine/fit';
import { isPlainFit } from '../engine/fit';
import './stage.css';

// 重ねる絵 1 枚。位置は、その絵のキャンバス（ドールのキャンバスと中心が同じ）の上
export interface StageLayer {
  key: string;
  url: string;
  canvasW: number;
  canvasH: number;
  box: Box;
  behind?: boolean; // ドールの後ろに描く（うしろがみ）
  hue?: number; // 色（色スライダーの角度）。0・無ければ、もとの色
}

// Blob の絵（端末の控え）を表示する
export function BlobImage({ blob, alt, hue = 0 }: { blob: Blob | undefined; alt: string; hue?: number }) {
  const url = useBlobUrl(blob);
  if (!url) return null;
  return hue !== 0 ? <HueCanvas src={url} hue={hue} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <img src={url} alt={alt} draggable={false} />;
}

// Blob を、表示できる URL（data:）にする
function useBlobUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    let alive = true;
    const reader = new FileReader();
    reader.onload = () => alive && setUrl(String(reader.result));
    reader.readAsDataURL(blob);
    return () => {
      alive = false;
    };
  }, [blob]);
  return blob ? url : null;
}

interface StageProps {
  doll: DollData | null; // null = ドールが、いまは使えない（服の絵だけを出す）
  layers?: StageLayer[];
  size: number; // 枠の幅（px）
  testId?: string;
  fit?: ItemFit; // 服（layers 全部）の、はじめの位置。軸は、手前の絵（無ければ最初の絵）のまんなか
}

export function Stage({ doll, layers = [], size, testId, fit }: StageProps) {
  // ドールが無いときは、服のキャンバスを枠にする
  const canvasW = doll?.canvasW ?? layers[0]?.canvasW ?? 1;
  const canvasH = doll?.canvasH ?? layers[0]?.canvasH ?? 1;
  const k = size / canvasW;
  const place = (layer: StageLayer): CSSProperties => {
    // 服のキャンバスは、ドールのキャンバスのまわりに余白を足した大きさのことがある（中心は同じ）
    const padX = (layer.canvasW - canvasW) / 2;
    const padY = (layer.canvasH - canvasH) / 2;
    return { position: 'absolute', left: (layer.box.x - padX) * k, top: (layer.box.y - padY) * k, width: layer.box.w * k, height: layer.box.h * k };
  };
  const draw = (layer: StageLayer) =>
    layer.hue ? <HueCanvas key={layer.key} src={layer.url} hue={layer.hue} style={place(layer)} /> : <img key={layer.key} src={layer.url} alt="" draggable={false} data-preview="" style={place(layer)} />;
  // はじめの位置: 服の絵を、まとめて動かす・大きくする・回す（ドールは動かさない）
  const pivotLayer = layers.find((layer) => !layer.behind) ?? layers[0];
  const moved = (children: React.ReactNode[]) => {
    if (!fit || isPlainFit(fit) || !pivotLayer || children.length === 0) return children;
    const p = place(pivotLayer);
    const ox = Number(p.left) + Number(p.width) / 2;
    const oy = Number(p.top) + Number(p.height) / 2;
    return (
      <div data-fit="" style={{ position: 'absolute', inset: 0, transformOrigin: `${ox}px ${oy}px`, transform: `translate(${fit.x * k}px, ${fit.y * k}px) rotate(${fit.rotation}deg) scale(${fit.scale})` }}>
        {children}
      </div>
    );
  };
  return (
    <div className="studio-stage" data-testid={testId} style={{ width: size, height: (canvasH / canvasW) * size }}>
      {moved(layers.filter((layer) => layer.behind).map(draw))}
      {doll && <img src={doll.bodyImageUrl} alt="" draggable={false} style={{ position: 'absolute', left: doll.box.x * k, top: doll.box.y * k, width: doll.box.w * k, height: doll.box.h * k }} />}
      {moved(layers.filter((layer) => !layer.behind).map(draw))}
    </div>
  );
}
