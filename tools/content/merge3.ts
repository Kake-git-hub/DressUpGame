/**
 * 一覧ファイル（JSON）の 3 方向の重ね合わせ
 *
 * 素材は、PC のスタジオからも、クラウドからも公開する。PC に公開していない変更が残っているあいだに、
 * 公開されている一覧が新しくなったとき、手元の変更（服を消した・足した・名前を変えた）を保ったまま、
 * 公開されている新しい内容（新しいドールや服）を取り込むために使う。
 *
 *  base: 手元の変更を始める前の一覧（前に取り込んだ・公開したときのもの）
 *  local: 手元のいまの一覧。remote: 公開されているいまの一覧
 *
 * 決まり:
 *  - 片方だけが変えた所は、変えたほう
 *  - id を持つものの並び（ドール・カテゴリ・服・背景）は、id ごとに重ねる。並びは公開されている順で、手元で足したものは後ろ
 *  - 手元で消したものは、消えたまま。公開で消えたものは消すが、手元で変えていたものは残す
 *  - 同じ所を両方が変えたときは、手元を優先する
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json } | undefined;

const same = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v: Json): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
type Keyed = { [key: string]: Json; id: string };
const isKeyedList = (v: Json): v is Keyed[] => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.id === 'string');

export function merge3(base: Json, local: Json, remote: Json): Json {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (isKeyedList(local) && isKeyedList(remote) && (base === undefined || isKeyedList(base))) return mergeKeyed(base ?? [], local, remote);
  if (isObject(local) && isObject(remote)) {
    const from = isObject(base) ? base : {};
    const merged: { [key: string]: Json } = {};
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      const value = mergeMember(from[key], local[key], remote[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  return local;
}

// 一覧やオブジェクトの中の 1 つ。無いことは undefined で表す。消えたままにするなら undefined を返す
function mergeMember(base: Json, local: Json, remote: Json): Json {
  if (local === undefined) return base !== undefined ? undefined : remote; // 手元で消した / 公開で増えた
  if (remote === undefined) return base !== undefined && same(local, base) ? undefined : local; // 公開で消えた（手元で変えていれば残す） / 手元で足した
  return merge3(base, local, remote);
}

function mergeKeyed(base: Keyed[], local: Keyed[], remote: Keyed[]): Json[] {
  const find = (list: Keyed[], id: string) => list.find((x) => x.id === id);
  const merged: Json[] = [];
  for (const r of remote) {
    const value = mergeMember(find(base, r.id), find(local, r.id), r);
    if (value !== undefined) merged.push(value);
  }
  for (const l of local) {
    if (find(remote, l.id)) continue;
    const value = mergeMember(find(base, l.id), l, undefined);
    if (value !== undefined) merged.push(value);
  }
  return merged;
}
