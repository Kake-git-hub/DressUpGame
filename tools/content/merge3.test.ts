// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { merge3, mergeManifest } from './merge3.ts';
import type { Json } from './merge3.ts';

type Obj = { [key: string]: Json };
const item = (id: string, extra: Obj = {}): Obj => ({ id, name: id, ...extra });
const doll = (id: string, items: Json[], extra: Obj = {}): Obj => ({ id, name: id, items, categories: [], backgrounds: [], ...extra });
const manifest = (...dolls: Json[]) => ({ version: 1, dolls, backgrounds: [] as Json[] });

describe('merge3（手元の変更を、公開されている新しい一覧に重ねる）', () => {
  const base = manifest(doll('アニメ', [item('a'), item('b'), item('c')]), doll('リアル', [item('r1'), item('r2')]));

  it('手元が変えていなければ、公開されているもの。公開が変えていなければ、手元のもの', () => {
    const remote = manifest(...base.dolls, doll('あたらしい', [item('n')]));
    expect(merge3(base, base, remote)).toEqual(remote);
    const local = manifest(doll('アニメ', [item('a')]), base.dolls[1]);
    expect(merge3(base, local, base)).toEqual(local);
  });

  it('手元で消した服は消えたまま、公開で増えたドールと服は入る（作者の PC で起きたこと）', () => {
    // 手元: アニメから b を、リアルから r2 を消した
    const local = manifest(doll('アニメ', [item('a'), item('c')]), doll('リアル', [item('r1')]));
    // 公開: 新しいドール 2 体と、アニメに服 1 点
    const remote = manifest(doll('アニメ', [item('a'), item('b'), item('c'), item('d')]), base.dolls[1], doll('アニメ　その２', [item('x')]), doll('おとこのこ', [item('y')]));
    const merged = merge3(base, local, remote) as ReturnType<typeof manifest>;
    expect(merged.dolls.map((d) => (d as { id: string }).id)).toEqual(['アニメ', 'リアル', 'アニメ　その２', 'おとこのこ']);
    expect((merged.dolls[0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['a', 'c', 'd']);
    expect((merged.dolls[1] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['r1']);
  });

  it('手元で足した服・名前を変えた服は残り、公開で変わった別の項目も入る', () => {
    const local = manifest(doll('アニメ', [item('a', { name: 'あたらしい名前' }), item('b'), item('c'), item('mine', { image: 'files/m.webp' })]), base.dolls[1]);
    const remote = manifest(doll('アニメ', [item('a', { image: 'files/a2.webp' }), item('b'), item('c')], { image: 'files/doll2.webp' }), base.dolls[1]);
    const merged = merge3(base, local, remote) as ReturnType<typeof manifest>;
    const anime = merged.dolls[0] as { image: string; items: Record<string, unknown>[] };
    expect(anime.image).toBe('files/doll2.webp');
    expect(anime.items).toEqual([item('a', { name: 'あたらしい名前', image: 'files/a2.webp' }), item('b'), item('c'), item('mine', { image: 'files/m.webp' })]);
  });

  it('同じ所を両方が変えたときは、手元を優先する', () => {
    const local = manifest(doll('アニメ', [item('a', { name: '手元' }), item('b'), item('c')]), base.dolls[1]);
    const remote = manifest(doll('アニメ', [item('a', { name: '公開' }), item('b'), item('c')]), base.dolls[1]);
    const merged = merge3(base, local, remote) as ReturnType<typeof manifest>;
    expect((merged.dolls[0] as { items: { name: string }[] }).items[0].name).toBe('手元');
  });

  it('公開で消えた服は消える。ただし、手元で変えていた服は残す', () => {
    const local = manifest(doll('アニメ', [item('a'), item('b', { name: '直した' }), item('c')]), base.dolls[1]);
    const remote = manifest(doll('アニメ', [item('c')]), base.dolls[1]);
    const merged = merge3(base, local, remote) as ReturnType<typeof manifest>;
    expect((merged.dolls[0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('id で並ぶ一覧でないもの（型紙のような、名前 → 値）も、項目ごとに重ねる', () => {
    const b = { アニメ: { parts: { head: { x: 1 } } } };
    const l = { アニメ: { parts: { head: { x: 5 } } } };
    const r = { アニメ: { parts: { head: { x: 1 } } }, おとこのこ: { parts: { head: { x: 9 } } } };
    expect(merge3(b, l, r)).toEqual({ アニメ: { parts: { head: { x: 5 } } }, おとこのこ: { parts: { head: { x: 9 } } } });
    // もとが無い（どちらにも新しくできたファイル）
    expect(merge3(undefined, { a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
});

describe('mergeManifest（一覧ファイルを重ねたあと、セットの印とセットの一覧を合わせる）', () => {
  type M = { dolls: { id: string; sets?: { id: string; name: string }[]; items: { id: string; set?: string }[] }[] };
  const S1 = { id: 'S1', name: 'うみ' };
  const S2 = { id: 'S2', name: 'やま' };
  const dollOf = (m: Json) => (m as unknown as M).dolls[0];

  it('手元で最後のセットを消していても、公開で増えたセットと、その印の付いた服は残る', () => {
    const base = manifest(doll('アニメ', [item('a', { set: 'S1' })], { sets: [S1] }));
    const local = manifest(doll('アニメ', [])); // a を消した → セットも消えた（sets の項目ごと無い）
    const remote = manifest(doll('アニメ', [item('a', { set: 'S1' }), item('b', { set: 'S2' })], { sets: [S1, S2] }));
    const merged = dollOf(mergeManifest(base, local, remote));
    expect(merged.items).toEqual([item('b', { set: 'S2' })]);
    expect(merged.sets).toEqual([S2]);
  });
  it('公開でセットが消えていても、手元でそのセットに足した服があれば、セットは残る', () => {
    const base = manifest(doll('アニメ', [item('a', { set: 'S1' })], { sets: [S1] }));
    const local = manifest(doll('アニメ', [item('a', { set: 'S1' }), item('n', { set: 'S1' })], { sets: [S1] }));
    const remote = manifest(doll('アニメ', [])); // a を消して公開した → セットも消えた
    const merged = dollOf(mergeManifest(base, local, remote));
    expect(merged.items.map((i) => i.id)).toContain('n');
    expect(merged.items.find((i) => i.id === 'n')!.set).toBe('S1');
    expect(merged.sets).toEqual([S1]);
  });
  it('2 点のセットを、手元と公開で 1 点ずつ消したら、空のセットは残さない', () => {
    const base = manifest(doll('アニメ', [item('a', { set: 'S1' }), item('b', { set: 'S1' }), item('c')], { sets: [S1] }));
    const local = manifest(doll('アニメ', [item('b', { set: 'S1' }), item('c')], { sets: [S1] }));
    const remote = manifest(doll('アニメ', [item('a', { set: 'S1' }), item('c')], { sets: [S1] }));
    const merged = dollOf(mergeManifest(base, local, remote));
    expect(merged.items).toEqual([item('c')]);
    expect(merged).not.toHaveProperty('sets');
  });
  it('セットの無い一覧・ドールは、merge3 と同じ結果', () => {
    const base = manifest(doll('アニメ', [item('a'), item('b')]), doll('リアル', [item('r')]));
    const local = manifest(doll('アニメ', [item('a')]), doll('リアル', [item('r')]));
    const remote = manifest(doll('アニメ', [item('a'), item('b'), item('c')]), doll('リアル', [item('r'), item('r2')]));
    expect(mergeManifest(base, local, remote)).toEqual(merge3(base, local, remote));
  });
  it('名前は、手元で変えていれば手元、そうでなければ公開のもの', () => {
    const base = manifest(doll('アニメ', [item('a', { set: 'S1' })], { sets: [S1] }));
    const local = manifest(doll('アニメ', [item('a', { set: 'S1' })], { sets: [{ id: 'S1', name: 'なつのうみ' }] }));
    const remote = manifest(doll('アニメ', [item('a', { set: 'S1' }), item('b', { set: 'S1' })], { sets: [S1] }));
    expect(dollOf(mergeManifest(base, local, remote)).sets).toEqual([{ id: 'S1', name: 'なつのうみ' }]);
  });
});
