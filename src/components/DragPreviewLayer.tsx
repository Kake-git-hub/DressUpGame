/**
 * DragPreviewLayer
 * ドラッグ中に指へ付いてくるサムネイル。
 * 指が動くたびに React を再レンダリングしないよう、DOM を直接書き換える。
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';

export interface DragPreviewHandle {
  // 表示して位置を更新（座標はビューポート基準）
  move(imageUrl: string, clientX: number, clientY: number): void;
  hide(): void;
}

const style: CSSProperties = {
  display: 'none',
  position: 'fixed',
  left: 0,
  top: 0,
  maxWidth: '120px',
  maxHeight: '120px',
  opacity: 0.8,
  pointerEvents: 'none',
  filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
  // キャンバス(.avatar-section: 1)より上、メニュー(.palette-section: 10)やボタンより下
  zIndex: 5,
};

export const DragPreviewLayer = forwardRef<DragPreviewHandle>(function DragPreviewLayer(_props, ref) {
  const imgRef = useRef<HTMLImageElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      move(imageUrl, clientX, clientY) {
        const img = imgRef.current;
        if (!img) return;
        if (img.getAttribute('src') !== imageUrl) img.setAttribute('src', imageUrl);
        // 画像の中心を指の位置に合わせる
        img.style.transform = `translate(${clientX}px, ${clientY}px) translate(-50%, -50%)`;
        img.style.display = 'block';
      },
      hide() {
        if (imgRef.current) imgRef.current.style.display = 'none';
      },
    }),
    []
  );

  return <img ref={imgRef} data-testid="drag-preview" alt="" draggable={false} style={style} />;
});
