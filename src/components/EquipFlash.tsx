/**
 * 服を着せたときに、その服を一瞬光らせ、まわりにきらきらを出す演出
 */
import { PlacedItem } from './PlacedItem';
import { canvasGeometry, lookOf } from './placement';
import type { DollTransform, EquippedItem } from '../types';

interface EquipFlashProps {
  item: EquippedItem;
  dollTransform: DollTransform;
  canvasWidth: number;
  canvasHeight: number;
  menuOffset: number;
  rightOffset: number;
}

// きらきらの位置（服の枠に対する割合）と、出る時間のずれ（秒）
const SPARKLES: [number, number, number][] = [
  [0.1, 0.15, 0],
  [0.85, 0.1, 0.08],
  [0.5, 0.0, 0.16],
  [0.95, 0.6, 0.04],
  [0.05, 0.7, 0.12],
  [0.6, 0.95, 0.2],
  [0.3, 0.5, 0.24],
];

export function EquipFlash({ item, dollTransform, canvasWidth, canvasHeight, menuOffset, rightOffset }: EquipFlashProps) {
  const canvas = document.querySelector('#avatar-canvas');
  if (!canvas) return null;
  const geometry = canvasGeometry(canvas.getBoundingClientRect(), canvasWidth, canvasHeight, menuOffset, rightOffset);
  const { box } = item;
  const unit = geometry.unit;
  return (
    <div className="equip-flash" data-testid="equip-flash">
      <PlacedItem item={item} look={lookOf(item)} geometry={geometry} dollTransform={dollTransform} zIndex={60} className="equip-flash-glow">
        {SPARKLES.map(([fx, fy, delay], i) => (
          <span
            key={i}
            className="equip-sparkle"
            style={{
              left: `${(box.x + box.w * fx) * unit}px`,
              top: `${(box.y + box.h * fy) * unit}px`,
              animationDelay: `${delay}s`,
            }}
          >
            ✦
          </span>
        ))}
      </PlacedItem>
    </div>
  );
}
