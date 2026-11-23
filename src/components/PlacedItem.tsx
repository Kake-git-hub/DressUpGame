/**
 * 服を、Pixi のキャンバスに描かれるのと同じ位置・大きさで、画面（CSS）に重ねて表示する。
 * 調整中のプレビュー、調整中の服より手前の服、着せたときの光る演出で使う。
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { HueCanvas } from './HueCanvas';
import type { Box, DollData, DollTransform, EquippedItem } from '../types';
import { eraseHides } from '../engine/hides';
import type { Hide } from '../engine/hides';
import { itemOrigin, itemPivotOnCanvas } from './placement';
import type { CanvasGeometry, ItemLook } from './placement';

// 切り抜き画像を、元キャンバスの中での位置に置いて表示する。
// 外枠が元キャンバス全体の大きさなので、外枠の中心＝元キャンバスの中心（PixiEngine の原点と同じ）。
export function PlacedImage({ src, alt, canvasW, canvasH, box, unit, hue, dark, onDark, onPixels, clip, testId }: {
  src: string;
  alt: string;
  canvasW: number;
  canvasH: number;
  box: Box;
  unit: number;
  hue?: number; // 指定すると、色相を変えた状態で表示する
  dark?: boolean; // 黒っぽい絵として色を付けるか（HueCanvas と同じ）
  onDark?: (dark: boolean) => void;
  onPixels?: (pixels: Uint8ClampedArray | null) => void; // 元の絵の画素（HueCanvas と同じ）
  clip?: Hide[]; // ほかの服が隠す所（この絵のキャンバス上の位置）。色相を変えていないときだけ効く
  testId?: string;
}) {
  const placed: CSSProperties = {
    position: 'absolute',
    display: 'block',
    left: `${box.x * unit}px`,
    top: `${box.y * unit}px`,
    width: `${box.w * unit}px`,
    height: `${box.h * unit}px`,
  };
  return (
    <div style={{ position: 'relative', width: `${canvasW * unit}px`, height: `${canvasH * unit}px` }}>
      {hue === undefined && clip?.length ? (
        <ErasedImage src={src} box={box} hides={clip} style={placed} />
      ) : hue === undefined ? (
        <img src={src} alt={alt} draggable={false} style={placed} />
      ) : (
        <HueCanvas src={src} hue={hue} dark={dark} onDark={onDark} onPixels={onPixels} style={placed} testId={testId} />
      )}
    </div>
  );
}

// 服と同じ位置・大きさ・傾きの箱（服の絵・枠が、この中に入る）
function PlacedBox({ item, look, geometry, dollTransform, zIndex, className, children }: {
  item: EquippedItem;
  look: ItemLook;
  geometry: CanvasGeometry;
  dollTransform: DollTransform;
  zIndex: number;
  className?: string;
  children?: ReactNode;
}) {
  const origin = itemOrigin(item, look, geometry, dollTransform);
  const pivot = itemPivotOnCanvas(item);
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        left: `${origin.x}px`,
        top: `${origin.y}px`,
        transform: `translate(-50%, -50%) scale(${dollTransform.scale})`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <div
        style={{
          position: 'relative',
          transform: `rotate(${look.rotation}deg) scale(${look.scale})`,
          transformOrigin: `${pivot.x * geometry.unit}px ${pivot.y * geometry.unit}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// 服 1 点を、キャンバス上と同じ所に重ねる。children は服と同じ向き・大きさで重なる。
// showUnder: 服の「ドールのすぐ上の分」（くつの中の肌）を、服のすぐ下に一緒に描く（調整中の服だけ。ほかの服の分はキャンバスが描く）
export function PlacedItem({ item, look, geometry, dollTransform, zIndex, className, alwaysHue, dark, onDark, onPixels, showUnder, clip, testId, children }: {
  item: EquippedItem;
  look: ItemLook;
  geometry: CanvasGeometry;
  dollTransform: DollTransform;
  zIndex: number;
  className?: string;
  alwaysHue?: boolean; // 色相 0 でも HueCanvas で描く（スライダーの動きに追従させるため）
  dark?: boolean;
  onDark?: (dark: boolean) => void;
  onPixels?: (pixels: Uint8ClampedArray | null) => void;
  showUnder?: boolean;
  clip?: Hide[];
  testId?: string;
  children?: ReactNode;
}) {
  const { box, canvasW, canvasH } = item;
  const unit = geometry.unit;
  return (
    <PlacedBox item={item} look={look} geometry={geometry} dollTransform={dollTransform} zIndex={zIndex} className={className}>
      {showUnder && item.under && (
        <img
          src={item.under.url}
          alt=""
          draggable={false}
          data-testid="adjust-under"
          style={{
            position: 'absolute',
            display: 'block',
            // 肌の絵のキャンバスが服のキャンバスと違う大きさでも、中心をそろえる
            left: `${(item.under.box.x + (canvasW - item.under.canvasW) / 2) * unit}px`,
            top: `${(item.under.box.y + (canvasH - item.under.canvasH) / 2) * unit}px`,
            width: `${item.under.box.w * unit}px`,
            height: `${item.under.box.h * unit}px`,
          }}
        />
      )}
      <PlacedImage
        src={item.imageUrl}
        alt={item.name}
        hue={alwaysHue || look.hue !== 0 ? look.hue : undefined}
        dark={dark}
        onDark={onDark}
        onPixels={onPixels}
        clip={clip}
        canvasW={canvasW}
        canvasH={canvasH}
        box={box}
        unit={unit}
        testId={testId}
      />
      {children}
    </PlacedBox>
  );
}

// 服と同じ位置・大きさ・傾きの、絵の無い層。調整中の服の枠（点線の四角と、角のつまみ）を、
// 服の重なりの順に関係なく、どの服よりも手前に出すのに使う。children は、服のキャンバスの座標で置く
export function PlacedFrame({ item, look, geometry, dollTransform, zIndex, children }: {
  item: EquippedItem;
  look: ItemLook;
  geometry: CanvasGeometry;
  dollTransform: DollTransform;
  zIndex: number;
  children: ReactNode;
}) {
  return (
    <PlacedBox item={item} look={look} geometry={geometry} dollTransform={dollTransform} zIndex={zIndex} className="adjust-frame-layer">
      {/* 服の絵と同じ大きさの、空の箱（位置合わせのため） */}
      <div style={{ position: 'relative', width: `${item.canvasW * geometry.unit}px`, height: `${item.canvasH * geometry.unit}px` }} />
      {children}
    </PlacedBox>
  );
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

// 隠す所を消した絵（読めるまで・読めなければ、そのままの絵）
function ErasedImage({ src, box, hides, style }: { src: string; box: Box; hides: Hide[]; style: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hidesKey = hides.map((h) => `${h.url} ${h.box.x} ${h.box.y}`).join('\n');
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadImage(src), ...hides.map((h) => loadImage(h.url))])
      .then(([image, ...masks]) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const erased = eraseHides(image, box, masks.map((m, i) => ({ image: m, box: hides[i].box })));
        canvas.width = erased.width;
        canvas.height = erased.height;
        canvas.getContext('2d')?.drawImage(erased, 0, 0);
      })
      .catch(() => {
        // 読めなければ、何も描かない（ちらつくより、少しのあいだ見えないほうがよい）
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hides は hidesKey で見る
  }, [src, hidesKey, box.x, box.y, box.w, box.h]);
  return <canvas ref={canvasRef} style={style} />;
}

// ドールを、キャンバス上と同じ所に重ねる（ドールの後ろの服を調整している間、キャンバスのドールの代わりに描く）。
// hides: 着ている服が隠す所（手袋の下の指先など）。キャンバスと同じように消して描く
export function PlacedDoll({ doll, hides, geometry, dollTransform, zIndex }: {
  doll: DollData;
  hides: Hide[];
  geometry: CanvasGeometry;
  dollTransform: DollTransform;
  zIndex: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { bodyImageUrl, box } = doll;
  const hidesKey = hides.map((h) => h.url).join('\n');
  useEffect(() => {
    if (!hidesKey) return;
    let cancelled = false;
    Promise.all([loadImage(bodyImageUrl), ...hides.map((h) => loadImage(h.url))])
      .then(([image, ...masks]) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const erased = eraseHides(image, box, masks.map((m, i) => ({ image: m, box: hides[i].box })));
        canvas.width = erased.width;
        canvas.height = erased.height;
        canvas.getContext('2d')?.drawImage(erased, 0, 0);
      })
      .catch(() => {
        // 読めなければ、下の <img>（隠す所なし）のまま
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hides は hidesKey で見る
  }, [bodyImageUrl, hidesKey, box.x, box.y, box.w, box.h]);

  const unit = geometry.unit;
  const x = geometry.left + (geometry.bgCenterX + ((dollTransform.x - 50) / 100) * geometry.bgSize) * geometry.scaleX;
  const y = geometry.top + (geometry.bgCenterY + ((dollTransform.y - 50) / 100) * geometry.bgSize) * geometry.scaleY;
  const placed: CSSProperties = { position: 'absolute', left: `${box.x * unit}px`, top: `${box.y * unit}px`, width: `${box.w * unit}px`, height: `${box.h * unit}px` };
  return (
    <div
      data-testid="adjust-doll"
      style={{ position: 'absolute', left: `${x}px`, top: `${y}px`, transform: `translate(-50%, -50%) scale(${dollTransform.scale})`, pointerEvents: 'none', zIndex }}
    >
      <div style={{ position: 'relative', width: `${doll.canvasW * unit}px`, height: `${doll.canvasH * unit}px` }}>
        {hidesKey ? <canvas ref={canvasRef} style={placed} /> : <img src={bodyImageUrl} alt="" draggable={false} style={placed} />}
      </div>
    </div>
  );
}
