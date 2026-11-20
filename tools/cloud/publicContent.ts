/**
 * 公開されている素材（素材リポジトリの GitHub Pages）を読む。サーバーの関数が、ドールの絵と型紙を使うため。
 * 一覧は少しの間だけ覚え、絵は読んだものを覚えておく（同じ関数の中で使い回す）。
 */
import { parseManifest } from '../../src/content/manifest.ts';
import type { Manifest } from '../../src/content/manifest.ts';
import { DollAssets } from '../studio/dollAssets.ts';
import type { TemplateData } from '../studio/generate.ts';
import type { PublicContent } from './studioCore.ts';

const MANIFEST_TTL_MS = 60_000;
const MAX_CACHED_FILES = 40;

export function createPublicContent(baseUrl: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): PublicContent {
  const url = (file: string) => new URL(file, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
  const files = new Map<string, Buffer | null>();
  // 無ければ null。届かない・エラーのときは Error（「無い」と取り違えない）
  const read = async (file: string): Promise<Buffer | null> => {
    if (files.has(file)) return files.get(file)!;
    const response = await fetchImpl(url(file), { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) {
      files.set(file, null);
      return null;
    }
    if (!response.ok) throw new Error(`公開されている素材（${file}）を読めませんでした（HTTP ${response.status}）`);
    const data = Buffer.from(await response.arrayBuffer());
    if (files.size >= MAX_CACHED_FILES) files.delete(files.keys().next().value as string);
    files.set(file, data);
    return data;
  };
  let cached: { at: number; manifest: Manifest } | null = null;
  const assets = new DollAssets({
    readFile: read,
    readTemplates: async () => {
      const data = await read('studio/templates.json');
      if (!data) return {};
      try {
        return JSON.parse(data.toString('utf8')) as Record<string, TemplateData>;
      } catch {
        return {};
      }
    },
  });
  return {
    assets,
    async manifest() {
      if (cached && now() - cached.at < MANIFEST_TTL_MS) return cached.manifest;
      const response = await fetchImpl(url('manifest.json'), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`公開されている素材の一覧を読めませんでした（HTTP ${response.status}）`);
      const manifest = parseManifest(await response.json());
      // ドールの絵が変わったかもしれないので、一覧を読み直したら、覚えていた絵と型を捨てる
      if (cached && JSON.stringify(cached.manifest.dolls.map((d) => d.image.file)) !== JSON.stringify(manifest.dolls.map((d) => d.image.file))) {
        files.clear();
        assets.clear();
      }
      cached = { at: now(), manifest };
      return manifest;
    },
  };
}
