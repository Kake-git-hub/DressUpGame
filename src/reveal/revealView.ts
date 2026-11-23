/**
 * 届いた演出に、何を出すか（純粋関数）
 */
import type { MyItem, StudioJob } from '../cloud/backend';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';

export interface RevealView {
  kind: 'arrived' | 'failed-only'; // failed-only = 1 点もできなかった（とびらは出さず、知らせだけ出す）
  items: MyItem[]; // 届いた服（セットは全部）。重なりの小さい順（着せる順）
  failed: string[]; // できなかった品目の、カテゴリの名前
  doll: DollData | null; // 着せて見せるドール。いまの素材に無ければ null（服の絵だけを出す）
  title: string; // 1 点なら服の名前、セットならセットの名前
}

const NO_CATEGORIES: ManifestCategory[] = [];

export function revealView(job: StudioJob, library: MyItem[], dolls: DollData[], categoriesByDoll: Record<string, ManifestCategory[]>): RevealView {
  const categories = categoriesByDoll[job.dollId] ?? NO_CATEGORIES;
  const categoryOf = (id: string) => categories.find((c) => c.id === id);
  const byId = new Map(library.map((item) => [item.id, item]));
  const kept = job.candidates.filter((c) => c.status === 'kept');
  const items = kept
    .flatMap((c) => (c.itemId && byId.has(c.itemId) ? [byId.get(c.itemId)!] : []))
    .sort((a, b) => (categoryOf(a.item.category)?.layer ?? 0) - (categoryOf(b.item.category)?.layer ?? 0));
  const failed = job.candidates.filter((c) => c.status === 'failed').map((c) => categoryOf(c.categoryId)?.label ?? c.categoryId);
  return {
    kind: kept.length > 0 ? 'arrived' : 'failed-only',
    items,
    failed,
    doll: dolls.find((doll) => doll.id === job.dollId) ?? null,
    title: job.set?.name ?? items[0]?.item.name ?? kept[0]?.name ?? '',
  };
}
