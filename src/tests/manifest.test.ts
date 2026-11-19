/**
 * 配信する一覧ファイル（manifest.json）の検証テスト
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../content/manifest';
import type { Manifest } from '../content/manifest';

const valid = (): Manifest => ({
  version: 1,
  dolls: [
    {
      id: 'アニメ',
      name: 'アニメ',
      image: { file: 'files/d.webp', canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } },
      categories: [{ id: 'トップス', label: 'トップス', layer: 4, menuOrder: 1, overlap: false, movable: false }],
      items: [
        {
          id: 'アニメ/トップス/セーター',
          name: 'セーター',
          category: 'トップス',
          image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 292, y: 240, w: 440, h: 280 } },
          thumb: 'files/t.webp',
        },
      ],
      backgrounds: [{ id: 'アニメ/bg/1', name: '1', file: 'files/b.jpg', thumb: 'files/bt.jpg' }],
    },
  ],
  backgrounds: [],
});

// 深いところの値を書き換えた複製を作る
function mutate(change: (m: Record<string, any>) => void): unknown { // eslint-disable-line @typescript-eslint/no-explicit-any
  const copy = JSON.parse(JSON.stringify(valid()));
  change(copy);
  return copy;
}

describe('parseManifest', () => {
  it('正しい一覧は同じ内容で返る', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(valid())))).toEqual(valid());
  });
  it('アイテムごとの layer / overlap の上書きを保つ', () => {
    const m = mutate((c) => {
      c.dolls[0].items[0].layer = 5;
      c.dolls[0].items[0].overlap = true;
    });
    const item = parseManifest(m).dolls[0].items[0];
    expect(item.layer).toBe(5);
    expect(item.overlap).toBe(true);
  });
  it('服が隠すドールの部分（hide）を保ち、形が違えば Error', () => {
    const hide = { file: 'files/h.webp', canvasW: 1024, canvasH: 1024, box: { x: 300, y: 800, w: 100, h: 60 } };
    expect(parseManifest(mutate((c) => (c.dolls[0].items[0].hide = hide))).dolls[0].items[0].hide).toEqual(hide);
    expect(() => parseManifest(mutate((c) => (c.dolls[0].items[0].hide = { file: 'x' })))).toThrow();
  });
  it('ドールの下に描く分（back）を保ち、形が違えば Error', () => {
    const back = { file: 'files/b.webp', canvasW: 1024, canvasH: 1024, box: { x: 200, y: 20, w: 600, h: 900 } };
    expect(parseManifest(mutate((c) => (c.dolls[0].items[0].back = back))).dolls[0].items[0].back).toEqual(back);
    expect(() => parseManifest(mutate((c) => (c.dolls[0].items[0].back = { file: 'x' })))).toThrow();
  });
  it('layer の上書きが数値でなければ Error', () => {
    expect(() => parseManifest(mutate((c) => (c.dolls[0].items[0].layer = '5')))).toThrow();
  });
  it('余分なキーは無視する', () => {
    const m = mutate((c) => {
      c.extra = 1;
      c.dolls[0].items[0].note = 'x';
    });
    expect(parseManifest(m)).toEqual(valid());
  });
  it.each([
    ['オブジェクトでない', () => 'text'],
    ['null', () => null],
    ['version が 1 でない', () => mutate((c) => (c.version = 2))],
    ['dolls が配列でない', () => mutate((c) => (c.dolls = {}))],
    ['アイテムの id が無い', () => mutate((c) => delete c.dolls[0].items[0].id)],
    ['box の数値が負', () => mutate((c) => (c.dolls[0].items[0].image.box.x = -1))],
    ['box の数値が数値でない', () => mutate((c) => (c.dolls[0].items[0].image.box.w = 'wide'))],
    ['box の幅が 0', () => mutate((c) => (c.dolls[0].items[0].image.box.w = 0))],
    ['box がキャンバスからはみ出す', () => mutate((c) => (c.dolls[0].items[0].image.box.x = 900))],
    ['アイテムのカテゴリが定義されていない', () => mutate((c) => (c.dolls[0].items[0].category = 'くつ'))],
    ['同じドール内でアイテムの id が重複', () => mutate((c) => c.dolls[0].items.push(c.dolls[0].items[0]))],
    ['ドールの id が重複', () => mutate((c) => c.dolls.push(c.dolls[0]))],
    ['file が空文字', () => mutate((c) => (c.dolls[0].image.file = ''))],
    ['共通背景が配列でない', () => mutate((c) => (c.backgrounds = null))],
  ])('%s なら Error', (_name, make) => {
    expect(() => parseManifest(make())).toThrow();
  });
});
