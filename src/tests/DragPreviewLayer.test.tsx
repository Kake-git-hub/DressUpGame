/**
 * DragPreviewLayer のユニットテスト
 * ドラッグ中に指へ付いてくるサムネイル。再レンダリングなしで動く
 */
import { describe, it, expect } from 'vitest';
import { createRef, Profiler } from 'react';
import { render, screen } from '@testing-library/react';
import { DragPreviewLayer } from '../components/DragPreviewLayer';
import type { DragPreviewHandle } from '../components/DragPreviewLayer';

describe('DragPreviewLayer', () => {
  it('最初は表示されない', () => {
    render(<DragPreviewLayer />);
    expect(screen.getByTestId('drag-preview').style.display).toBe('none');
  });

  it('move で表示され、指の位置に置かれる', () => {
    const ref = createRef<DragPreviewHandle>();
    render(<DragPreviewLayer ref={ref} />);
    const img = screen.getByTestId('drag-preview');
    ref.current!.move('thumb.png', 300, 200);
    expect(img.style.display).not.toBe('none');
    expect(img.getAttribute('src')).toBe('thumb.png');
    expect(img.style.transform).toContain('300px');
    expect(img.style.transform).toContain('200px');
  });

  it('hide で消える', () => {
    const ref = createRef<DragPreviewHandle>();
    render(<DragPreviewLayer ref={ref} />);
    ref.current!.move('thumb.png', 300, 200);
    ref.current!.hide();
    expect(screen.getByTestId('drag-preview').style.display).toBe('none');
  });

  it('move を繰り返しても再レンダリングされない', () => {
    const ref = createRef<DragPreviewHandle>();
    let renders = 0;
    render(
      <Profiler id="preview" onRender={() => renders++}>
        <DragPreviewLayer ref={ref} />
      </Profiler>
    );
    for (let i = 0; i < 20; i++) ref.current!.move('thumb.png', i * 10, i * 5);
    expect(renders).toBe(1);
  });

  it('クリックやタッチを妨げない', () => {
    render(<DragPreviewLayer />);
    expect(screen.getByTestId('drag-preview').style.pointerEvents).toBe('none');
  });
});
