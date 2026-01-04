/**
 * AvatarCanvas コンポーネントのユニットテスト
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvatarCanvas } from '../components/AvatarCanvas';
import type { ClothingItemData } from '../types';

describe('AvatarCanvas', () => {
  it('キャンバス要素がレンダリングされる', () => {
    render(<AvatarCanvas equippedItems={[]} />);

    const canvas = screen.getByTestId('avatar-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName).toBe('CANVAS');
  });

  it('指定したサイズでキャンバスが作成される', () => {
    render(<AvatarCanvas width={600} height={800} equippedItems={[]} />);

    const canvas = screen.getByTestId('avatar-canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('onCanvasReadyコールバックが呼ばれる', async () => {
    const onReady = vi.fn();

    render(<AvatarCanvas equippedItems={[]} onCanvasReady={onReady} />);

    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
    });
  });

  it('装備アイテムを受け取れる', () => {
    const items: ClothingItemData[] = [
      {
        id: 'top-1',
        name: '青いTシャツ',
        type: 'top',
        imageUrl: '/images/top-1.png',
        position: { x: 0, y: 0 },
        zIndex: 1,
      },
    ];

    render(<AvatarCanvas equippedItems={items} />);

    const canvas = screen.getByTestId('avatar-canvas');
    expect(canvas).toBeInTheDocument();
  });
});
