/**
 * 自分の服の「はじめの位置」を決める画面（クローゼットの「いちを きめる」から開く）。
 * ドールがその服だけを着た画面で、着せ替えと同じ調整画面（スマホ縦は虫めがねつき）を開く。✓ で決める、「やめる」で何もしない。
 * 色の帯・重なりの一覧・× は出さない（覚えるのは、位置・大きさ・向きだけ）。
 */
import { useMemo, useRef, useState } from 'react';
import { AvatarCanvas } from './AvatarCanvas';
import { ItemAdjustPanel } from './ItemAdjustPanel';
import type { Layout } from './layout';
import type { ItemAdjustment } from '../hooks/useDressUp';
import type { ClothingItemData, DollData, EquippedItem } from '../types';
import { DEFAULT_DOLL_TRANSFORM } from '../types';
import { fitAdjustment, normalizeFit } from '../engine/fit';
import type { ItemFit } from '../engine/fit';
import { stageUnit, toCanvasItem, toDollOffsets } from '../engine/units';
import { adjustBaseId } from '../engine/pairs';
import { sheetsAbove } from '../engine/layers';

export interface FitEditorProps {
  doll: DollData;
  parts: ClothingItemData[]; // その服（髪は、前髪とうしろがみ）
  fit: ItemFit | undefined; // いまの、はじめの位置
  layout: Layout;
  onSave: (fit: ItemFit) => Promise<void>; // 失敗したら投げる（画面は閉じない）
  onCancel: () => void;
}

export function FitEditor({ doll, parts, fit, layout, onSave, onCancel }: FitEditorProps) {
  const portrait = layout.orientation === 'portrait';
  const canvas = layout.canvas;
  const unit = stageUnit(canvas.height);
  // 横では、左のメニューの分をあけない（ドールを、まんなかに）
  const menuOffset = 0;
  const rightOffset = layout.rightOffset;
  // 決めているあいだの値（ドールの絵の px）。調整画面が ✓ のときに知らせる
  const [current, setCurrent] = useState<ItemFit>(() => fit ?? { x: 0, y: 0, scale: 1, rotation: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0); // 失敗したあと、調整画面を開き直す
  const latest = useRef<ItemAdjustment>({});

  const equipped: EquippedItem[] = useMemo(
    () => parts.map((p, i) => ({ ...p, defaultFit: undefined, equipOrder: i, ...fitAdjustment(current) })),
    [parts, current],
  );
  const canvasItems = useMemo(() => equipped.map((item) => toCanvasItem(item, unit)), [equipped, unit]);
  const front = canvasItems.find((i) => !i.frontItemId) ?? canvasItems[0];
  const hidden = useMemo(() => {
    if (!front) return undefined;
    const baseId = adjustBaseId(equipped, front.id);
    const above = sheetsAbove(equipped, baseId);
    return { items: [baseId, ...above.flatMap((s) => (s.kind === 'item' ? [s.item.id] : []))], doll: above.some((s) => s.kind === 'doll') };
  }, [equipped, front]);

  const save = async () => {
    const a = toDollOffsets(latest.current, unit);
    const next = normalizeFit({ x: a.adjustOffsetX ?? current.x, y: a.adjustOffsetY ?? current.y, scale: a.adjustScale ?? current.scale, rotation: a.adjustRotation ?? current.rotation });
    if (!next) return;
    setCurrent(next);
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRound((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  if (!front) return null;
  return (
    <div className="app fit-editor" data-orientation={layout.orientation} data-phone={layout.phone} data-testid="fit-editor">
      <section className="avatar-section" style={portrait ? { top: canvas.top, height: canvas.height } : undefined}>
        <AvatarCanvas
          width={canvas.width}
          height={canvas.height}
          equippedItems={canvasItems}
          doll={doll}
          dollTransform={DEFAULT_DOLL_TRANSFORM}
          menuOffset={menuOffset}
          rightOffset={rightOffset}
          adjustingItemId={front.id}
          hidden={hidden}
        />
      </section>
      {!busy && (
        <ItemAdjustPanel
          key={`${round}@${unit}`}
          item={front}
          equippedItems={canvasItems}
          onAdjust={(a) => {
            latest.current = { ...latest.current, ...a };
          }}
          onClose={() => void save()}
          canvasWidth={canvas.width}
          canvasHeight={canvas.height}
          dollTransform={DEFAULT_DOLL_TRANSFORM}
          onDollTransformChange={() => undefined}
          menuOffset={menuOffset}
          rightOffset={rightOffset}
          doll={doll}
          orientation={layout.orientation}
          loupe={portrait && layout.phone}
          fitMode
        />
      )}
      <div className="fit-editor-head">
        <span className="fit-editor-title">はじめの いち</span>
        <button type="button" className="fit-editor-cancel" onClick={onCancel} disabled={busy} data-testid="fit-cancel">
          やめる
        </button>
      </div>
      {busy && <div className="fit-editor-note">きおくしています…</div>}
      {error && (
        <div className="fit-editor-note fit-editor-error" data-testid="fit-error">
          {error}
        </div>
      )}
    </div>
  );
}
