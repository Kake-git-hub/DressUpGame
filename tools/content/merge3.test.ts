// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { merge3 } from './merge3.ts';
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
