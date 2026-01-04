/**
 * ClothingItem コンポーネントのユニットテスト
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClothingItem } from '../components/ClothingItem';
import type { ClothingItemData } from '../types';

const mockItem: ClothingItemData = {
  id: 'top-1',
  name: '青いTシャツ',
  type: 'top',
  imageUrl: '/images/top-1.png',
  position: { x: 0, y: 0 },
  baseZIndex: 20,
};

describe('ClothingItem', () => {
  it('服アイテムがレンダリングされる', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} />);

    const item = screen.getByTestId('clothing-item-top-1');
    expect(item).toBeInTheDocument();
  });

  it('適切なラベルが表示される', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} />);

    expect(screen.getByText('トップス')).toBeInTheDocument();
  });

  it('クリック時にonDropが呼ばれる', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} />);

    const item = screen.getByTestId('clothing-item-top-1');

    // マウスダウン→マウスアップでドロップをシミュレート
    fireEvent.mouseDown(item);
    fireEvent.mouseUp(item);

    expect(onDrop).toHaveBeenCalledWith(mockItem);
  });

  it('disabled時はonDropが呼ばれない', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} disabled={true} />);

    const item = screen.getByTestId('clothing-item-top-1');

    fireEvent.mouseDown(item);
    fireEvent.mouseUp(item);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('アクセシビリティ属性が設定されている', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} />);

    const item = screen.getByTestId('clothing-item-top-1');
    expect(item).toHaveAttribute('role', 'button');
    expect(item).toHaveAttribute('aria-label');
    expect(item).toHaveAttribute('tabIndex', '0');
  });

  it('disabled時はtabIndexが-1になる', () => {
    const onDrop = vi.fn();

    render(<ClothingItem item={mockItem} onDrop={onDrop} disabled={true} />);

    const item = screen.getByTestId('clothing-item-top-1');
    expect(item).toHaveAttribute('tabIndex', '-1');
  });
});
