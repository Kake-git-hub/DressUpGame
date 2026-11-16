/**
 * スタジオの API
 *
 * HTTP サーバーに依存しない形（リクエスト → レスポンスの関数）にしてある。
 * いまは PC 上の Vite 開発サーバーに載せる（vitePlugin.ts）。あとで同じ関数をサーバーに載せられる。
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Box } from '../../src/pipeline/alpha.ts';
import { defaultRegion, estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { Manifest, ManifestDoll } from '../../src/content/manifest.ts';
import { ContentError, ContentStore } from '../content/manifestEdit.ts';
import { AiError } from './ai.ts';
import type { AiClients } from './ai.ts';
import { BudgetError } from './budget.ts';
import type { Budget } from './budget.ts';
import { MAX_ATTEMPTS, generateBackground, generateCandidate, planBackgrounds, planItems } from './generate.ts';
import type { BackgroundCandidate, Candidate, PlannedItem, TemplateData } from './generate.ts';
import { loadDollTemplate, processGenerated } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';
import { pngToRgba, renderSilhouette, rgbaToPng } from './silhouette.ts';

const run = promisify(execFile);

export interface ApiRequest {
  method: string;
  path: string; // 例: /api/items
  query: URLSearchParams;
  host: string; // Host ヘッダー
  origin?: string; // Origin ヘッダー（ブラウザが付ける。別のサイトからの呼び出しを見分ける）
  body: Buffer;
}
export interface ApiResponse {
  status: number;
  type: string;
  body: Buffer | string;
}

export interface StudioOptions {
  contentDir: string;
  ai: AiClients;
  budget: Budget;
  allowedHosts?: string[]; // 既定は localhost と 127.0.0.1
  concurrency?: number;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (value: unknown, status = 200): ApiResponse => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(value) });
const png = (data: Buffer): ApiResponse => ({ status: 200, type: 'image/png', body: data });

const MIME: Record<string, string> = { '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const MAX_ITEMS_PER_PLAN = 30;
const MAX_JOBS_KEPT = 20;

interface Job {
  id: string;
  kind: 'items' | 'backgrounds';
  dollId: string | null;
  done: boolean;
  error: string | null;
  candidates: (Candidate | BackgroundCandidate)[];
}

function parseColor(value: string | null, what: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(value ?? '');
  if (!m) throw new HttpError(400, `${what}は rrggbb の形で指定してください`);
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

export class StudioApi {
  readonly store: ContentStore;
  private readonly options: StudioOptions;
  private readonly templates = new Map<string, DollTemplate>();
  private readonly jobs = new Map<string, Job>();

  constructor(options: StudioOptions) {
    this.options = options;
    this.store = new ContentStore(options.contentDir);
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      const allowed = this.options.allowedHosts ?? ['localhost', '127.0.0.1', '::1'];
      const hostName = (value: string) => value.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      if (!allowed.includes(hostName(req.host))) throw new HttpError(403, 'この PC からの接続だけ受け付けます');
      // ほかのサイトを開いているブラウザから、この PC の API を勝手に呼ばれないようにする
      if (req.origin) {
        let originHost: string | null = null;
        try {
          originHost = hostName(new URL(req.origin).host);
        } catch {
          // 読めない Origin は別のサイト扱い
        }
        if (!originHost || !allowed.includes(originHost)) throw new HttpError(403, 'ほかのサイトからの呼び出しは受け付けません');
      }
      if (req.path.startsWith('/content/')) return await this.serveContent(req.path.slice('/content/'.length));
      return await this.route(req);
    } catch (error) {
      if (error instanceof HttpError || error instanceof ContentError || error instanceof AiError || error instanceof BudgetError) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof Error && /^manifest: /.test(error.message)) return json({ error: `入力が正しくありません（${error.message}）` }, 400);
      console.error(error);
      return json({ error: `内部エラー: ${(error as Error).message}` }, 500);
    }
  }

  private async serveContent(rel: string): Promise<ApiResponse> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      throw new HttpError(400, 'パスが正しくありません');
    }
    if (decoded.split(/[\\/]/).includes('..') || path.isAbsolute(decoded)) throw new HttpError(400, 'パスが正しくありません');
    // 配るのは、一覧と画像と型紙だけ（.git などは出さない）
    if (!/^(manifest\.json$|files\/|studio\/)/.test(decoded)) throw new HttpError(404, 'ファイルがありません');
    const file = path.join(this.store.dir, decoded);
    try {
      return { status: 200, type: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', body: await fs.readFile(file) };
    } catch {
      throw new HttpError(404, 'ファイルがありません');
    }
  }

  private body<T>(req: ApiRequest): T {
    try {
      const value = JSON.parse(req.body.toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null) throw new Error('not an object');
      return value as T;
    } catch {
      throw new HttpError(400, '本文が JSON ではありません');
    }
  }
  private param(req: ApiRequest, name: string): string {
    const value = req.query.get(name);
    if (!value) throw new HttpError(400, `${name} を指定してください`);
    return value;
  }
  private async doll(dollId: string): Promise<{ manifest: Manifest; doll: ManifestDoll }> {
    const manifest = await this.store.read();
    const doll = manifest.dolls.find((d) => d.id === dollId);
    if (!doll) throw new HttpError(404, `ドール「${dollId}」がありません`);
    return { manifest, doll };
  }
  private async dollTemplate(doll: ManifestDoll): Promise<DollTemplate> {
    const key = `${doll.id}\n${doll.image.file}`;
    let template = this.templates.get(key);
    if (!template) {
      template = await loadDollTemplate(this.store.dir, doll.image);
      this.templates.set(key, template);
    }
    return template;
  }

  // 型紙: 保存されたものがあればそれ、無ければ輪郭から推定する。あとから増えたカテゴリの範囲は補う
  private async templateData(doll: ManifestDoll): Promise<TemplateData> {
    const all = await this.store.readStudioData<Record<string, TemplateData>>('templates', {});
    const template = await this.dollTemplate(doll);
    let data: TemplateData | undefined = all[doll.id];
    if (!data || !data.parts || !data.regions) {
      const parts = estimateBodyParts(template.mask, template.canvasW, template.canvasH);
      if (!parts) throw new HttpError(500, 'ドールの画像が全部透明です');
      data = { parts, regions: {}, style: '', styleRefs: [] };
    }
    for (const c of doll.categories) {
      if (!(c.id in data.regions)) data.regions[c.id] = defaultRegion(c.label, data.parts, template.canvasW, template.canvasH);
    }
    return data;
  }

  private async git(...args: string[]): Promise<string> {
    // 認証を求められても端末で止まらないようにし、時間も区切る
    const { stdout, stderr } = await run('git', ['-C', this.store.dir, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return (stdout + stderr).trim();
  }
  private async gitStatus(): Promise<{ isRepo: boolean; branch: string | null; changedFiles: number }> {
    try {
      // 素材フォルダそのものが作業フォルダの最上位であること（親のリポジトリを誤って commit しない）
      const top = await this.git('rev-parse', '--show-toplevel');
      if (path.resolve(top) !== (await fs.realpath(this.store.dir))) return { isRepo: false, branch: null, changedFiles: 0 };
      const branch = await this.git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => null);
      const status = await this.git('status', '--porcelain');
      return { isRepo: true, branch, changedFiles: status ? status.split('\n').length : 0 };
    } catch {
      return { isRepo: false, branch: null, changedFiles: 0 };
    }
  }

  private async route(req: ApiRequest): Promise<ApiResponse> {
    const key = `${req.method} ${req.path}`;
    switch (key) {
      case 'GET /api/status':
        return json({
          contentDir: this.store.dir,
          ai: { text: !!this.options.ai.text, image: !!this.options.ai.image },
          budget: { usedToday: await this.options.budget.usedToday(), ...this.options.budget.limits, maxAttempts: MAX_ATTEMPTS },
          git: { ...(await this.gitStatus()), unusedFiles: await this.store.countUnusedFiles() },
        });
      case 'GET /api/content':
        return json(await this.store.read());

      case 'POST /api/process': {
        const { doll } = await this.doll(this.param(req, 'doll'));
        const num = (name: string, fallback: number) => {
          const raw = req.query.get(name);
          if (raw === null) return fallback;
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new HttpError(400, `${name} は数値で指定してください`);
          return value;
        };
        const scale = num('scale', 1);
        if (scale < 0.5 || scale > 2) throw new HttpError(400, 'scale は 0.5〜2 で指定してください');
        let result;
        try {
          result = await processGenerated(req.body, await this.dollTemplate(doll), {
            nudge: { scale, dx: num('dx', 0), dy: num('dy', 0) },
            silhouetteColor: req.query.get('silhouette') ? parseColor(req.query.get('silhouette'), 'silhouette') : undefined,
          });
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        return json({
          png: (await rgbaToPng(result.rgba, result.width, result.height)).toString('base64'),
          source: (await rgbaToPng(result.source, result.width, result.height)).toString('base64'),
          keyColors: result.keyColors,
          alignment: result.alignment,
          warnings: result.warnings,
        });
      }

      case 'POST /api/items': {
        const b = this.body<{ dollId: string; category: string; name: string; png: string; replaceId?: string }>(req);
        if (typeof b.png !== 'string') throw new HttpError(400, 'png を指定してください');
        let image;
        try {
          image = await pngToRgba(Buffer.from(b.png, 'base64'));
        } catch {
          throw new HttpError(400, '画像を読めませんでした');
        }
        return json(await this.store.addItem(b.dollId, { category: b.category, name: b.name, ...image, replaceId: b.replaceId }));
      }
      case 'PATCH /api/items': {
        const b = this.body<{ id: string; name?: string; category?: string; layer?: number | null; overlap?: boolean | null }>(req);
        return json(await this.store.updateItem(b.id, { name: b.name, category: b.category, layer: b.layer, overlap: b.overlap }));
      }
      case 'DELETE /api/items':
        await this.store.deleteItem(this.param(req, 'id'));
        return json({ ok: true });

      case 'PUT /api/categories': {
        const b = this.body<{ dollId: string; category: { id?: string; label: string; layer: number; menuOrder: number; overlap: boolean; movable: boolean } }>(req);
        if (!b.category || typeof b.category.label !== 'string') throw new HttpError(400, 'category を指定してください');
        if (b.category.id !== undefined) return json(await this.store.upsertCategory(b.dollId, { ...b.category, id: b.category.id }));
        // 新しいカテゴリの id は、名前を小文字にしたもの。同じものがあれば上書きせずに断る
        return json(await this.store.createCategory(b.dollId, { ...b.category, id: b.category.label.toLowerCase() }));
      }
      case 'PATCH /api/categories': {
        const b = this.body<{ dollId: string; id: string; change: { label?: string; layer?: number; menuOrder?: number; overlap?: boolean; movable?: boolean } }>(req);
        if (typeof b.change !== 'object' || b.change === null) throw new HttpError(400, 'change を指定してください');
        return json(await this.store.updateCategory(b.dollId, b.id, b.change));
      }
      case 'POST /api/categories/order': {
        const b = this.body<{ dollId: string; order: { id: string; layer: number; menuOrder: number }[] }>(req);
        if (!Array.isArray(b.order)) throw new HttpError(400, 'order を指定してください');
        await this.store.reorderCategories(b.dollId, b.order);
        return json({ ok: true });
      }
      case 'DELETE /api/categories':
        await this.store.deleteCategory(this.param(req, 'doll'), this.param(req, 'id'));
        return json({ ok: true });

      case 'POST /api/backgrounds':
        return json(await this.store.addBackground(req.query.get('doll') || null, { name: this.param(req, 'name'), data: req.body }));
      case 'DELETE /api/backgrounds':
        await this.store.deleteBackground(this.param(req, 'id'));
        return json({ ok: true });

      case 'POST /api/dolls': {
        const doll = await this.store.addDoll({ name: this.param(req, 'name'), data: req.body });
        return json({ doll, template: await this.templateData(doll) });
      }
      case 'GET /api/template': {
        const { doll } = await this.doll(this.param(req, 'doll'));
        return json(await this.templateData(doll));
      }
      case 'PUT /api/template': {
        const b = this.body<{ dollId: string; template: TemplateData }>(req);
        const { doll } = await this.doll(b.dollId);
        const t = b.template;
        const current = await this.templateData(doll);
        const isBox = (v: unknown): v is Box =>
          typeof v === 'object' && v !== null && (['x', 'y', 'w', 'h'] as const).every((k) => Number.isFinite((v as Box)[k])) && (v as Box).w > 0 && (v as Box).h > 0;
        const pick = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
        if (!t || typeof t.parts !== 'object' || t.parts === null || typeof t.regions !== 'object' || t.regions === null || typeof t.style !== 'string' || !Array.isArray(t.styleRefs)) {
          throw new HttpError(400, '型紙の形が正しくありません');
        }
        const parts = { ...current.parts };
        for (const key of Object.keys(parts) as (keyof typeof parts)[]) {
          if (!isBox(t.parts[key])) throw new HttpError(400, `部位「${key}」の位置と大きさを、数値で入力してください（幅と高さは 1 以上）`);
          parts[key] = pick(t.parts[key]);
        }
        const regions: Record<string, Box | null> = {};
        for (const c of doll.categories) {
          const r = t.regions[c.id];
          if (r !== null && r !== undefined && !isBox(r)) throw new HttpError(400, `カテゴリ「${c.label}」の範囲を、数値で入力してください（幅と高さは 1 以上）`);
          regions[c.id] = r ? pick(r) : null;
        }
        const saved: TemplateData = { parts, regions, style: t.style.slice(0, 2000), styleRefs: t.styleRefs.filter((id) => doll.items.some((i) => i.id === id)).slice(0, 3) };
        await this.store.updateStudioData<Record<string, TemplateData>>('templates', {}, (all) => ({ ...all, [doll.id]: saved }));
        return json(saved);
      }
      case 'GET /api/silhouette': {
        const { doll } = await this.doll(this.param(req, 'doll'));
        return png(await renderSilhouette(await this.dollTemplate(doll), parseColor(req.query.get('color') ?? '00ff00', 'color'), parseColor(req.query.get('bg') ?? 'ffffff', 'bg')));
      }

      case 'POST /api/plan': {
        const b = this.body<{ dollId: string; theme: string; count: number; categories?: string[] }>(req);
        const { text } = this.requireAi();
        const { doll } = await this.doll(b.dollId);
        const theme = typeof b.theme === 'string' ? b.theme.trim().slice(0, 400) : '';
        if (!theme) throw new HttpError(400, 'テーマを入力してください');
        const count = Math.floor(Number(b.count));
        // 1 回の実行の上限に収まる数まで（案を作ったのに、生成で断られることが無いように）
        const most = Math.max(1, Math.min(MAX_ITEMS_PER_PLAN, Math.floor(this.options.budget.limits.perRun / MAX_ATTEMPTS)));
        if (!(count >= 1 && count <= most)) throw new HttpError(400, `品目数は 1〜${most} で指定してください`);
        const data = await this.templateData(doll);
        const items = await planItems(text, doll, { theme, count, categories: b.categories, style: data.style });
        return json({ items, maxImages: items.length * MAX_ATTEMPTS });
      }
      case 'POST /api/jobs': {
        const b = this.body<{ dollId: string; items: PlannedItem[] }>(req);
        const { text, image } = this.requireAi();
        const { doll } = await this.doll(b.dollId);
        if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS_PER_PLAN) throw new HttpError(400, `品目は 1〜${MAX_ITEMS_PER_PLAN} 点で指定してください`);
        const items = b.items.map((i): PlannedItem => {
          if (!doll.categories.some((c) => c.id === i.category)) throw new HttpError(400, `カテゴリ「${i.category}」がありません`);
          if (typeof i.name !== 'string' || !i.name.trim() || typeof i.description !== 'string' || !i.description.trim()) throw new HttpError(400, '品目の名前と説明を入力してください');
          return { category: i.category, name: i.name.trim(), description: i.description.slice(0, 1000), colors: Array.isArray(i.colors) ? i.colors.filter((c) => typeof c === 'string').slice(0, 6) : [] };
        });
        await this.options.budget.check(items.length * MAX_ATTEMPTS);
        const template = await this.dollTemplate(doll);
        const data = await this.templateData(doll);
        const styleRefs: Buffer[] = [];
        for (const id of data.styleRefs) {
          const item = doll.items.find((i) => i.id === id);
          if (!item) continue;
          const layer = await loadDollTemplate(this.store.dir, item.image);
          styleRefs.push(await rgbaToPng(layer.rgba, layer.canvasW, layer.canvasH));
        }
        const job = this.startJob('items', doll.id, items.map((item): Candidate => ({ item, status: 'waiting', attempts: 0, warnings: [], notes: [] })), (c) =>
          generateCandidate({ text, image, budget: this.options.budget, doll, template, data, styleRefs }, c as Candidate),
        );
        return json({ id: job.id });
      }
      case 'POST /api/background-jobs': {
        const b = this.body<{ dollId?: string | null; theme: string; count: number }>(req);
        const { text, image } = this.requireAi();
        const manifest = await this.store.read();
        const doll = b.dollId ? manifest.dolls.find((d) => d.id === b.dollId) : undefined;
        if (b.dollId && !doll) throw new HttpError(404, `ドール「${b.dollId}」がありません`);
        const theme = typeof b.theme === 'string' ? b.theme.trim().slice(0, 400) : '';
        if (!theme) throw new HttpError(400, 'テーマを入力してください');
        const count = Math.floor(Number(b.count));
        if (!(count >= 1 && count <= 10)) throw new HttpError(400, '枚数は 1〜10 で指定してください');
        await this.options.budget.check(count);
        const existing = [...manifest.backgrounds, ...manifest.dolls.flatMap((d) => d.backgrounds)].map((x) => x.name);
        const planned = await planBackgrounds(text, { theme, count, existing });
        const style = doll ? (await this.templateData(doll)).style : '';
        const job = this.startJob('backgrounds', doll?.id ?? null, planned.map((item): BackgroundCandidate => ({ item, status: 'waiting', attempts: 0, notes: [] })), (c) =>
          generateBackground({ image, budget: this.options.budget, style }, c as BackgroundCandidate),
        );
        return json({ id: job.id });
      }
      case 'GET /api/jobs': {
        const job = this.job(this.param(req, 'id'));
        return json({
          id: job.id,
          kind: job.kind,
          dollId: job.dollId,
          done: job.done,
          error: job.error,
          candidates: job.candidates.map((c) => ({
            item: c.item,
            status: c.status,
            attempts: c.attempts,
            notes: c.notes,
            warnings: 'warnings' in c ? c.warnings : [],
            hasImage: !!c.png,
          })),
        });
      }
      case 'GET /api/jobs/image': {
        const job = this.job(this.param(req, 'id'));
        const candidate = job.candidates[Number(this.param(req, 'index'))];
        const data = req.query.get('kind') === 'source' && candidate && 'source' in candidate ? candidate.source : candidate?.png;
        if (!data) throw new HttpError(404, '画像がありません');
        return png(data);
      }

      case 'POST /api/publish': {
        const b = this.body<{ message?: string }>(req);
        const status = await this.gitStatus();
        if (!status.isRepo) throw new HttpError(409, `素材フォルダ（${this.store.dir}）が git の作業フォルダではないので、公開できません。保存した内容は残っています`);
        const removed = await this.store.removeUnusedFiles();
        const log: string[] = [];
        if (removed.length > 0) log.push(`使われていない画像を ${removed.length} 個消しました`);
        try {
          // 素材として書いたものだけを対象にする
          const targets = ['manifest.json', 'files', 'studio'].filter((name) => existsSync(path.join(this.store.dir, name)));
          await this.git('add', '-A', '--', ...targets);
          if (await this.git('status', '--porcelain')) {
            const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim().slice(0, 200) : 'スタジオから素材を更新';
            log.push(await this.git('commit', '-m', message));
          } else {
            log.push('新しい変更はありません（前回 push できなかった分があれば、いま push します）');
          }
          log.push(await this.git('push'));
        } catch (error) {
          const detail = (error as { stderr?: string; message: string }).stderr || (error as Error).message;
          throw new HttpError(502, `公開できませんでした。保存した内容は残っています。もう一度「公開」を押せます。\n${log.join('\n')}\n${detail}`.trim());
        }
        return json({ ok: true, log: log.join('\n') });
      }
      default:
        throw new HttpError(404, `${key} はありません`);
    }
  }

  private requireAi(): { text: NonNullable<AiClients['text']>; image: NonNullable<AiClients['image']> } {
    const { text, image } = this.options.ai;
    if (!text) throw new HttpError(503, 'Claude API のキーが設定されていません（サーバーの環境変数 ANTHROPIC_API_KEY）');
    if (!image) throw new HttpError(503, 'Gemini API のキーが設定されていません（サーバーの環境変数 GEMINI_API_KEY）');
    return { text, image };
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, 'この生成は見つかりません（サーバーを再起動すると消えます）');
    return job;
  }

  // 候補を順に作る（同時に concurrency 件まで）。API はすぐ返し、進み具合は GET /api/jobs で見る
  private startJob<T extends Candidate | BackgroundCandidate>(kind: Job['kind'], dollId: string | null, candidates: T[], work: (c: T) => Promise<void>): Job {
    const job: Job = { id: randomUUID(), kind, dollId, done: false, error: null, candidates };
    this.jobs.set(job.id, job);
    while (this.jobs.size > MAX_JOBS_KEPT) this.jobs.delete(this.jobs.keys().next().value as string);
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const candidate = candidates[next++];
        try {
          await work(candidate);
        } catch (error) {
          candidate.status = 'failed';
          candidate.notes = [(error as Error).message];
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 2, candidates.length) }, worker))
      .catch((error: Error) => {
        job.error = error.message;
      })
      .finally(() => {
        job.done = true;
      });
    return job;
  }

  // テスト用: 生成が終わるまで待つ
  async waitForJob(id: string): Promise<void> {
    while (!this.job(id).done) await new Promise((r) => setTimeout(r, 10));
  }
}
