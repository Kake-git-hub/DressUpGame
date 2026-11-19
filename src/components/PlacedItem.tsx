/**
 * 服を、Pixi のキャンバスに描かれるのと同じ位置・大きさで、画面（CSS）に重ねて表示する。
 * 調整中のプレビュー、調整中の服より手前の服、着せたときの光る演出で使う。
 */
import type { CSSProperties, ReactNode } from 'react';
import { HueCanvas } from './HueCanvas';
import type { Box, DollTransform, EquippedItem } from '../types';
import { itemOrigin } from './placement';
import type { CanvasGeometry, ItemLook } from './placement';

// 切り抜き画像を、元キャンバスの中での位置に置いて表示する。
// 外枠が元キャンバス全体の大きさなので、外枠の中心＝元キャンバスの中心（PixiEngine の原点と同じ）。
export function PlacedImage({ src, alt, canvasW, canvasH, box, unit, hue, testId }: {
  src: string;
  alt: string;
  canvasW: number;
  canvasH: number;
  box: Box;
  unit: number;
  hue?: number; // 指定すると、色相を変えた状態で表示する
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
      {hue === undefined ? (
        <img src={src} alt={alt} draggable={false} style={placed} />
      ) : (
        <HueCanvas src={src} hue={hue} style={placed} testId={testId} />
      )}
    </div>
  );
}

// 服 1 点を、キャンバス上と同じ所に重ねる。children は服と同じ向き・大きさで重なる（枠など）
export function PlacedItem({ item, look, geometry, dollTransform, zIndex, className, alwaysHue, testId, children }: {
  item: EquippedItem;
  look: ItemLook;
  geometry: CanvasGeometry;
  dollTransform: DollTransform;
  zIndex: number;
  className?: string;
  alwaysHue?: boolean; // 色相 0 でも HueCanvas で描く（スライダーの動きに追従させるため）
  testId?: string;
  children?: ReactNode;
}) {
  const origin = itemOrigin(item, look, geometry, dollTransform);
  const { box, canvasW, canvasH } = item;
  const unit = geometry.unit;
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
          transformOrigin: `${(box.x + box.w / 2) * unit}px ${(box.y + box.h / 2) * unit}px`,
        }}
      >
        <PlacedImage
          src={item.imageUrl}
          alt={item.name}
          hue={alwaysHue || look.hue !== 0 ? look.hue : undefined}
          canvasW={canvasW}
          canvasH={canvasH}
          box={box}
          unit={unit}
          testId={testId}
        />
        {children}
      </div>
    </div>
  );
}
