/**
 * アプリの中のスタジオ: 顔写真から「かお」を作る（画面の動き）
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppStudio } from '../appStudio/AppStudio';
import type { StudioBackend } from '../cloud/backend';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';

const cat = (id: string, menuOrder: number): ManifestCategory => ({ id, label: id, layer: menuOrder, menuOrder, overlap: false, movable: false });
const doll = { id: 'doll', name: 'テスト', bodyImageUrl: '', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } } as unknown as DollData;
const library = { all: async () => [], put: async () => undefined, remove: async () => undefined };

function backend() {
  const startJob = vi.fn(async () => ({ jobId: 'j1', cost: 1 }));
  const fake = {
    signIn: async () => ({ userCode: 'ABCD2345', tickets: 3, admin: false }),
    onUser: () => () => undefined,
    startJob,
    watchJob: () => () => undefined,
    pendingJobs: async () => [],
    keep: vi.fn(),
    discard: vi.fn(),
    listMyItems: async () => [],
    fetchMyItem: vi.fn(),
    deleteMyItem: vi.fn(),
  } as unknown as StudioBackend;
  return { fake, startJob };
}
const show = (b: StudioBackend, categories: ManifestCategory[]) =>
  render(<AppStudio backend={b} doll={doll} categories={categories} library={library} onClose={() => undefined} onLibraryChanged={() => undefined} />);

describe('顔写真から顔を作る', () => {
  it('写真をとると「かお」に切り替わり（選び直せない）、テーマが空でも作れて、写真を送る。✕ ではずすと元にもどる', async () => {
    const { fake, startJob } = backend();
    show(fake, [cat('トップス', 2), cat('かお', 1)]);
    const select = screen.getByTestId('studio-target') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'トップス' } });
    await waitFor(() => expect(screen.getByTestId('studio-hint').textContent).toContain('テーマ'));

    const photo = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('studio-photo-input'), { target: { files: [photo] } });
    await waitFor(() => expect(screen.getByTestId('studio-photo')).toBeTruthy());
    expect(select.value).toBe('かお');
    expect(select.disabled).toBe(true);
    expect(screen.getByTestId('studio-photo-note').textContent).toContain('作り終わったらサーバーから消します');

    const make = screen.getByTestId('studio-make') as HTMLButtonElement;
    expect(make.disabled).toBe(false);
    fireEvent.click(make);
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    expect(startJob.mock.calls[0]).toEqual([expect.objectContaining({ theme: '', target: { kind: 'category', categoryId: 'かお' }, photo: expect.any(Blob) })]);

    fireEvent.click(screen.getByTestId('studio-photo-remove'));
    expect(screen.queryByTestId('studio-photo')).toBeNull();
    expect(select.disabled).toBe(false);
  });
  it('顔のカテゴリが無いドールでは、写真は使えない', async () => {
    const { fake } = backend();
    show(fake, [cat('トップス', 1)]);
    expect((screen.getByTestId('studio-photo-input') as HTMLInputElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId('studio-hint')).toBeTruthy());
  });
});
