/**
 * 届いた演出に、何を出すか（純粋関数）のテスト
 */
import { describe, expect, it } from 'vitest';
import type { MyItem, StudioCandidate, StudioJob } from '../cloud/backend';
import type { ManifestCategory } from '../content/manifest';
import { revealView } from '../reveal/revealView';
import type { DollData } from '../types';

const doll = (id: string): DollData => ({ id, name: id, bodyImageUrl: `${id}.webp`, canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } }) as DollData;
const category = (id: string, label: string, layer: number): ManifestCategory => ({ id, label, layer, menuOrder: layer, overlap: false, movable: false });
const item = (id: string, categoryId: string, name = id): MyItem => ({
  id,
  dollId: 'girl',
  item: { id, name, category: categoryId, image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'thumb' },
  files: {},
  createdAt: 1,
  hue: 0,
  order: 1,
  updatedAt: 1,
  notes: [],
});
const candidate = (index: number, categoryId: string, status: StudioCandidate['status'], itemId?: string, notes: string[] = []): StudioCandidate => ({ index, name: `きかく${index}`, categoryId, status, notes, ...(itemId ? { itemId } : {}) });
const job = (candidates: StudioCandidate[], extra: Partial<StudioJob> = {}): StudioJob => ({ id: 'j1', dollId: 'girl', done: true, tickets: candidates.length, createdAt: 1, candidates, ...extra });
const dolls = [doll('girl')];
const categories = { girl: [category('shoes', 'くつ', 9), category('top', 'トップス', 4), category('hat', 'ぼうし', 12)] };

describe('revealView', () => {
  it('1 点: 届いた服と、その名前（クローゼットで変えた名前があれば、それ）', () => {
    const view = revealView(job([candidate(0, 'top', 'kept', 'my:a')]), [item('my:a', 'top', 'なみのふく'), item('my:other', 'top')], dolls, categories);
    expect(view.kind).toBe('arrived');
    expect(view.items.map((i) => i.id)).toEqual(['my:a']);
    expect(view.title).toBe('なみのふく');
    expect(view.failed).toEqual([]);
    expect(view.doll?.id).toBe('girl');
  });
  it('セット: 届いた服の全部（重なりの小さい順 = 着せる順）。名前は、セットの名前', () => {
    const view = revealView(
      job([candidate(0, 'hat', 'kept', 'my:hat'), candidate(1, 'top', 'kept', 'my:top'), candidate(2, 'shoes', 'kept', 'my:shoes')], { set: { id: 'my:set-j1', name: 'うみのセット' } }),
      [item('my:top', 'top'), item('my:shoes', 'shoes'), item('my:hat', 'hat')],
      dolls,
      categories,
    );
    expect(view.items.map((i) => i.id)).toEqual(['my:top', 'my:shoes', 'my:hat']);
    expect(view.title).toBe('うみのセット');
  });
  it('一部できなかった: できなかった品目の、カテゴリの名前を出す（服は、できた分だけ）', () => {
    const view = revealView(job([candidate(0, 'top', 'kept', 'my:top'), candidate(1, 'hat', 'failed'), candidate(2, 'gone', 'failed')], { set: { id: 's', name: 'セット' } }), [item('my:top', 'top')], dolls, categories);
    expect(view.kind).toBe('arrived');
    expect(view.items.map((i) => i.id)).toEqual(['my:top']);
    expect(view.failed.map((f) => f.label)).toEqual(['ぼうし', 'gone']); // 素材に無いカテゴリは、ID のまま
  });
  it('全部できなかった: failed-only（とびらは出さない）', () => {
    const view = revealView(job([candidate(0, 'top', 'failed'), candidate(1, 'hat', 'failed')]), [], dolls, categories);
    expect(view.kind).toBe('failed-only');
    expect(view.items).toEqual([]);
    expect(view.failed.map((f) => f.label)).toEqual(['トップス', 'ぼうし']);
  });
  it('ドールが、いまの素材に無い: doll は null（服の絵だけを出す）', () => {
    const view = revealView(job([candidate(0, 'top', 'kept', 'my:a')], { dollId: 'gone' }), [{ ...item('my:a', 'top'), dollId: 'gone' }], dolls, categories);
    expect(view.doll).toBeNull();
    expect(view.items.map((i) => i.id)).toEqual(['my:a']);
  });
  it('服が端末の控えに無い（保存できなかった）: 服は空でも、届いた扱い。名前は、企画の名前', () => {
    const view = revealView(job([candidate(0, 'top', 'kept', 'my:a')]), [], dolls, categories);
    expect(view.kind).toBe('arrived');
    expect(view.items).toEqual([]);
    expect(view.missing).toBe(1);
    expect(view.title).toBe('きかく0');
  });
  it('できなかった理由（サーバーの知らせ）と、できた服の検品の注意を持つ。端末に全部あれば missing は 0', () => {
    const view = revealView(
      job([candidate(0, 'top', 'kept', 'my:top', ['そでが みじかいかもしれません']), candidate(1, 'hat', 'failed', undefined, ['作れませんでした（今日は、作れる枚数の上限に達しました。あした、もう一度ためしてください）。チケットは戻しました'])], { set: { id: 's', name: 'セット' } }),
      [item('my:top', 'top')],
      dolls,
      categories,
    );
    expect(view.failed).toEqual([{ label: 'ぼうし', note: '作れませんでした（今日は、作れる枚数の上限に達しました。あした、もう一度ためしてください）。チケットは戻しました' }]);
    expect(view.warnings).toEqual(['そでが みじかいかもしれません']);
    expect(view.missing).toBe(0);
  });
});
