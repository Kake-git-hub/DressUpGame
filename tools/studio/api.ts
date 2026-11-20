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
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { Manifest, ManifestDoll } from '../../src/content/manifest.ts';
import { ContentError, ContentStore } from '../content/manifestEdit.ts';
import { merge3, mergeManifest } from '../content/merge3.ts';
import type { Json } from '../content/merge3.ts';
import { parseManifest } from '../../src/content/manifest.ts';
import { AiError } from './ai.ts';
import type { AiClients } from './ai.ts';
import { BudgetError } from './budget.ts';
import type { Budget } from './budget.ts';
import { MAX_ATTEMPTS, generateBackground, generateCandidate, planBackgrounds, planItems, planSet } from './generate.ts';
import type { BackgroundCandidate, Candidate, PlannedItem, TemplateData } from './generate.ts';
import { DollAssets } from './dollAssets.ts';
import { dollTemplateFromImage, processGenerated } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';
import { alphaToPng, renderSilhouette, rgbaToPng } from './silhouette.ts';
import { findStyle } from '../../src/studio/stylePresets.ts';

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
  maxAttempts?: number; // 1 品目あたりの生成回数（作り直しを含む）。既定は MAX_ATTEMPTS
}

// 公開されている素材の取り込みの結果。
// state: updated = 取り込んだ / latest = もう最新 / blocked = 新しいものがあるが取り込めない / offline = 確かめられない / no-repo = git の作業フォルダでない
export interface SyncResult {
  state: 'updated' | 'latest' | 'blocked' | 'offline' | 'no-repo';
  updated: boolean;
  behind: number;
  message: string;
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
// 公開されている素材を確かめるときに待つ上限
const SYNC_FETCH_TIMEOUT_MS = 30_000;
// 手元と公開先の両方で変わっていたら、中身を重ねるファイル（ほかは画像で、名前が中身のハッシュ）
const SYNC_MERGED = ['manifest.json', 'studio/templates.json'];

interface Job {
  id: string;
  kind: 'items' | 'backgrounds';
  dollId: string | null;
  done: boolean;
  error: string | null;
  candidates: (Candidate | BackgroundCandidate)[];
  set?: { id: string; name: string }; // セットとして作っているとき（保存すると、候補の服にこの印が付く）
}

function parseColor(value: string | null, what: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(value ?? '');
  if (!m) throw new HttpError(400, `${what}は rrggbb の形で指定してください`);
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

// 肌の絵の上に服を重ねた絵（サムネイル用）

export class StudioApi {
  readonly store: ContentStore;
  private readonly options: StudioOptions;
  private readonly assets: DollAssets;
  private readonly jobs = new Map<string, Job>();
  private syncing: Promise<SyncResult> | null = null; // 走っている取り込み

  constructor(options: StudioOptions) {
    this.options = options;
    this.store = new ContentStore(options.contentDir);
    this.assets = new DollAssets({
      readFile: (file) => fs.readFile(path.join(this.store.dir, file)).catch(() => null),
      readTemplates: () => this.store.readStudioData<Record<string, TemplateData>>('templates', {}),
    });
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
  // 髪のカテゴリなら、前髪（ドールの上）と後ろ髪（ドールの下）に分ける。ほかはそのまま。
  // front（前髪の範囲。本物のドールに描かせた髪の候補が持つ）があれば、それで分ける。無ければ、絵の形から分ける（splitHair）。
  // 分けたら、サムネイルは「後ろ髪 → うすい体の形 → 前髪」、うしろがみのサムネイルは「後ろ髪 → うすい体の形」から作る（体の裏の塗りつぶしを見せない）
  // ドールの型と、保存用の絵づくり（素材フォルダから読む）
  private dollTemplate(doll: ManifestDoll): Promise<DollTemplate> {
    return this.assets.dollTemplate(doll);
  }
  private workTemplate(doll: ManifestDoll): Promise<DollTemplate> {
    return this.assets.workTemplate(doll);
  }
  private hiTemplate(doll: ManifestDoll): Promise<{ template: DollTemplate; scale: number }> {
    return this.assets.hiTemplate(doll);
  }
  private workData(doll: ManifestDoll): Promise<TemplateData> {
    return this.assets.workData(doll);
  }
  private templateData(doll: ManifestDoll): Promise<TemplateData> {
    return this.assets.templateData(doll);
  }

  private git(...args: string[]): Promise<string> {
    return this.gitWithin(120_000, ...args);
  }
  private async gitWithin(timeout: number, ...args: string[]): Promise<string> {
    // 認証を求められても端末で止まらないようにし、時間も区切る
    const { stdout, stderr } = await run('git', ['-C', this.store.dir, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return (stdout + stderr).trim();
  }
  // behind: 公開されている素材のほうが何件新しいか（最後に確かめた時点。公開先が無ければ 0）
  private async gitStatus(): Promise<{ isRepo: boolean; branch: string | null; changedFiles: number; behind: number }> {
    try {
      // 素材フォルダそのものが作業フォルダの最上位であること（親のリポジトリを誤って commit しない）
      const top = await this.git('rev-parse', '--show-toplevel');
      if (path.resolve(top) !== (await fs.realpath(this.store.dir))) return { isRepo: false, branch: null, changedFiles: 0, behind: 0 };
      const branch = await this.git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => null);
      const status = await this.git('status', '--porcelain');
      const behind = Number(await this.git('rev-list', '--count', 'HEAD..@{upstream}').catch(() => '0')) || 0;
      return { isRepo: true, branch, changedFiles: status ? status.split('\n').length : 0, behind };
    } catch {
      return { isRepo: false, branch: null, changedFiles: 0, behind: 0 };
    }
  }

  /**
   * 公開されている素材（ほかの PC やクラウドから公開した分）を、素材フォルダに取り込む。
   * 手元に未公開の変更があるとき・手元だけの記録があるときは、何も変えずに知らせる（手元の作業を壊さない）。
   * つながらない・公開先が無いときも、エラーにしない
   */
  sync(): Promise<SyncResult> {
    // 同時に呼ばれたら、走っている 1 回の結果を返す（2 つの取り込みが、同じフォルダを同時に書き換えないように）
    this.syncing ??= this.syncOnce().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  private async syncOnce(): Promise<SyncResult> {
    const before = await this.gitStatus();
    if (!before.isRepo) return { state: 'no-repo', updated: false, behind: 0, message: `素材フォルダ（${this.store.dir}）が git の作業フォルダではないので、公開されている素材は確かめていません` };
    try {
      // つながらない回線で、スタジオの起動を長く待たせない
      await this.gitWithin(SYNC_FETCH_TIMEOUT_MS, 'fetch', '--quiet');
    } catch {
      return { state: 'offline', updated: false, behind: before.behind, message: '公開されている素材を確かめられませんでした（インターネットにつながっていないか、公開先がありません）' };
    }
    const { behind, changedFiles } = await this.gitStatus();
    if (behind === 0) return { state: 'latest', updated: false, behind: 0, message: '素材は、公開されているものと同じ（最新）です' };
    // 手元にだけある記録（前回 push できなかった公開）があると、早送りでは取り込めない
    const ahead = Number(await this.git('rev-list', '--count', '@{upstream}..HEAD').catch(() => '0')) || 0;
    if (ahead > 0) {
      return { state: 'blocked', updated: false, behind, message: `公開されている素材のほうが ${behind} 件新しいですが、手元にだけある記録（前回 push できなかった公開）が ${ahead} 件あるので、自動では取り込めません` };
    }
    try {
      if (changedFiles > 0) await this.pullKeepingLocalChanges();
      else await this.git('merge', '--ff-only', '--quiet', '@{upstream}');
    } catch (error) {
      const reason = error instanceof ContentError ? error.message : ((error as { stderr?: string }).stderr || (error as Error).message).trim().split('\n')[0];
      return { state: 'blocked', updated: false, behind, message: `公開されている素材のほうが ${behind} 件新しいですが、取り込めませんでした（${reason}）。手元の内容は変えていません` };
    }
    // ドールの画像が変わったかもしれないので、読み込んだ型を捨てる
    this.assets.clear();
    return {
      state: 'updated',
      updated: true,
      behind: 0,
      message: `公開されている新しい素材を ${behind} 件取り込みました${changedFiles > 0 ? '。手元の未公開の変更は、そのまま残しています（「公開」を押すと公開されます）' : ''}`,
    };
  }

  /**
   * 未公開の変更を残したまま、公開されている素材を取り込む。
   * 一覧ファイルと型紙は、手元の変更を、公開されている新しい内容に重ねる（merge3）。
   * 画像は名前が中身のハッシュなので、同じ名前なら同じ中身。うまくいかなければ、手元を元に戻して Error
   */
  private async pullKeepingLocalChanges(): Promise<void> {
    const dir = this.store.dir;
    const lines = (await this.git('-c', 'core.quotepath=false', 'status', '--porcelain', '-uall')).split('\n').filter(Boolean);
    // 1 行は「状態（1〜2 文字）＋空白＋ファイル名」。出力の前後の空白は取ってあるので、先頭の行は状態の前の空白が無いことがある
    const changed = lines.flatMap((line) => {
      const m = /^\s*(\S{1,2})\s+(.+)$/.exec(line);
      return m ? [{ untracked: m[1] === '??', file: m[2].replace(/^"|"$/g, '') }] : [];
    });
    const incoming = new Set((await this.git('-c', 'core.quotepath=false', 'diff', '--name-only', 'HEAD', '@{upstream}')).split('\n').filter(Boolean));
    const show = async (rev: string, file: string): Promise<Json> => {
      try {
        return JSON.parse(await this.git('show', `${rev}:${file}`)) as Json;
      } catch {
        return undefined; // その版には無い
      }
    };

    // 重ねるファイル（手元で変えていて、公開先でも変わったもの）と、取り込みのじゃまになる手元のファイル
    const merges: { file: string; text: string; merged: Json; tracked: boolean }[] = [];
    const duplicates: { file: string; data: Buffer }[] = []; // 手元にも公開先にも同じ中身で増えた画像
    for (const { file, untracked } of changed) {
      if (!incoming.has(file)) continue; // 公開先では変わっていない。git がそのまま残す
      const full = path.join(dir, file);
      if (SYNC_MERGED.includes(file)) {
        const text = await fs.readFile(full, 'utf8');
        // 一覧ファイルは、重ねたあとにセットの印とセットの一覧を合わせる
        const merge = file === 'manifest.json' ? mergeManifest : merge3;
        const merged = merge(await show('HEAD', file), JSON.parse(text) as Json, await show('@{upstream}', file));
        if (file === 'manifest.json') parseManifest(merged); // アプリが読めない一覧にはしない
        merges.push({ file, text, merged, tracked: !untracked });
      } else if (untracked && (await this.git('hash-object', '--', file)) === (await this.git('rev-parse', `@{upstream}:${file}`))) {
        duplicates.push({ file, data: await fs.readFile(full) });
      } else {
        throw new ContentError(`「${file}」が、手元と公開先の両方で変わっています`);
      }
    }

    // 取り込む前の手元の内容は、控えとして残す（.git の中。公開されない）
    if (merges.length > 0) {
      const backup = path.join(dir, '.git', 'studio-backup', new Date().toISOString().replace(/[:.]/g, '-'));
      for (const m of merges) {
        await fs.mkdir(path.dirname(path.join(backup, m.file)), { recursive: true });
        await fs.writeFile(path.join(backup, m.file), m.text);
      }
    }
    try {
      for (const m of merges) {
        if (m.tracked) await this.git('checkout', 'HEAD', '--', m.file);
        else await fs.rm(path.join(dir, m.file));
      }
      for (const d of duplicates) await fs.rm(path.join(dir, d.file));
      await this.git('merge', '--ff-only', '--quiet', '@{upstream}');
    } catch (error) {
      // 手元を元に戻す
      for (const m of merges) await fs.writeFile(path.join(dir, m.file), m.text);
      for (const d of duplicates) await fs.writeFile(path.join(dir, d.file), d.data);
      throw error;
    }
    for (const m of merges) await fs.writeFile(path.join(dir, m.file), JSON.stringify(m.merged, null, 1) + '\n');
  }

  private async route(req: ApiRequest): Promise<ApiResponse> {
    const key = `${req.method} ${req.path}`;
    switch (key) {
      case 'GET /api/status':
        return json({
          contentDir: this.store.dir,
          ai: { text: !!this.options.ai.text, image: !!this.options.ai.image },
          budget: { usedToday: await this.options.budget.usedToday(), ...this.options.budget.limits, perDay: Number.isFinite(this.options.budget.limits.perDay) ? this.options.budget.limits.perDay : null, maxAttempts: this.maxAttempts },
          git: { ...(await this.gitStatus()), unusedFiles: await this.store.countUnusedFiles() },
        });
      case 'GET /api/content':
        return json(await this.store.read());
      case 'POST /api/sync':
        return json(await this.sync());

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
          const options = {
            nudge: { scale, dx: num('dx', 0), dy: num('dy', 0) },
            silhouetteColor: req.query.get('silhouette') ? parseColor(req.query.get('silhouette'), 'silhouette') : undefined,
          };
          // 切り抜き済みの画像（シルエットなし）は、ドールのキャンバスのまま。
          // シルエットのある画像は、余白つきの型紙から作ったものか、余白なしの古い型紙から作ったものかを、合い具合で決める
          result = await processGenerated(req.body, await this.dollTemplate(doll), { ...options, parts: Object.values((await this.templateData(doll)).parts) });
          if (result.keyColors.silhouette) {
            const padded = await processGenerated(req.body, await this.workTemplate(doll), { ...options, parts: Object.values((await this.workData(doll)).parts) });
            if (padded.alignment.score >= result.alignment.score) result = padded;
          }
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        return json({
          png: (await rgbaToPng(result.rgba, result.width, result.height)).toString('base64'),
          source: (await rgbaToPng(result.source, result.width, result.height)).toString('base64'),
          shape: result.shape ? (await alphaToPng(result.shape, result.width, result.height)).toString('base64') : null,
          keyColors: result.keyColors,
          alignment: result.alignment,
          warnings: result.warnings,
        });
      }

      case 'POST /api/items': {
        const b = this.body<{ dollId: string; category: string; name: string; png: string; replaceId?: string; hide?: string; shape?: string; front?: string; under?: string; set?: { id: string; name: string } }>(req);
        if (typeof b.png !== 'string') throw new HttpError(400, 'png を指定してください');
        const set = b.set === undefined ? undefined : this.setInput(b.set);
        const { doll } = await this.doll(b.dollId);
        const layer = (value: unknown) => (typeof value === 'string' && value ? Buffer.from(value, 'base64') : null);
        const input = await this.assets.itemInput(doll, { category: b.category, name: b.name, png: Buffer.from(b.png, 'base64'), hide: layer(b.hide), shape: layer(b.shape), front: layer(b.front), under: layer(b.under), replaceId: b.replaceId, set });
        return json(await this.store.addItem(b.dollId, input));
      }
      case 'POST /api/items/split-hair': {
        // 保存済みの髪（1 枚）を、前髪と後ろ髪に分け直す
        const b = this.body<{ id: string }>(req);
        const manifest = await this.store.read();
        const doll = manifest.dolls.find((d) => d.items.some((i) => i.id === b.id));
        const item = doll?.items.find((i) => i.id === b.id);
        if (!doll || !item) throw new HttpError(404, `アイテム「${b.id}」がありません`);
        if (item.back) throw new HttpError(400, 'この髪は、もう前髪と後ろ髪に分かれています');
        const placed = await dollTemplateFromImage(await fs.readFile(path.join(this.store.dir, item.image.file)), item.image);
        const layers = await this.assets.hairLayers(doll, item.category, { rgba: placed.rgba, width: placed.canvasW, height: placed.canvasH }, true);
        if (!layers.back) throw new HttpError(422, '体の前にかかる髪が見つからないので、分けませんでした');
        return json(await this.store.addItem(doll.id, { category: item.category, name: item.name, ...layers, replaceId: item.id }));
      }
      case 'PATCH /api/items': {
        const b = this.body<{ id: string; name?: string; category?: string; layer?: number | null; overlap?: boolean | null; set?: null | string | { name: string }; leaveSet?: string }>(req);
        if (b.leaveSet !== undefined && typeof b.leaveSet !== 'string') throw new HttpError(400, 'leaveSet はセットの ID です');
        if (b.layer !== undefined && b.layer !== null && (typeof b.layer !== 'number' || !Number.isFinite(b.layer))) throw new HttpError(400, 'layer は数値です');
        const set = b.set === null || typeof b.set === 'string' ? b.set : b.set !== undefined && typeof b.set === 'object' && typeof b.set.name === 'string' ? { name: b.set.name } : undefined;
        if (b.set !== undefined && set === undefined) throw new HttpError(400, 'set の形が正しくありません');
        return json(await this.store.updateItem(b.id, { name: b.name, category: b.category, layer: b.layer, overlap: b.overlap, ...(set !== undefined ? { set } : {}), ...(b.leaveSet !== undefined ? { leaveSet: b.leaveSet } : {}) }));
      }
      case 'POST /api/items/order': {
        // カテゴリの中の服の並び（メニューでの順番）
        const b = this.body<{ dollId: string; category: string; ids: string[] }>(req);
        if (!Array.isArray(b.ids) || !b.ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids を指定してください');
        await this.store.reorderItems(b.dollId, b.category, b.ids);
        return json({ ok: true });
      }
      case 'POST /api/items/transform': {
        // 服の位置と大きさ（ゲームで最初に着せたときの位置）
        const b = this.body<{ id: string; scale: number; dx: number; dy: number }>(req);
        return json(await this.store.transformItem(b.id, { scale: b.scale, dx: b.dx, dy: b.dy }));
      }
      case 'PATCH /api/dolls': {
        // ドールの改名と、ゲームに出すかどうか
        const b = this.body<{ id: string; name?: string; hidden?: boolean }>(req);
        if (b.hidden !== undefined && typeof b.hidden !== 'boolean') throw new HttpError(400, 'hidden は true か false です');
        return json(await this.store.updateDoll(b.id, { name: b.name, hidden: b.hidden }));
      }
      case 'PATCH /api/sets': {
        // セットの名前を変える
        const b = this.body<{ dollId: string; id: string; name: string }>(req);
        return json(await this.store.renameSet(b.dollId, b.id, b.name));
      }
      case 'POST /api/sets/order': {
        // セットの並び（ゲームのメニューでの順番）
        const b = this.body<{ dollId: string; ids: string[] }>(req);
        if (!Array.isArray(b.ids) || !b.ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids を指定してください');
        await this.store.reorderSets(b.dollId, b.ids);
        return json({ ok: true });
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
      case 'POST /api/backgrounds/copy': {
        // 背景を、ほかのドールにも置く（doll が null なら、全部のドールで使う背景）
        const b = this.body<{ id: string; doll: string | null }>(req);
        if (b.doll !== null && typeof b.doll !== 'string') throw new HttpError(400, 'doll を指定してください');
        return json(await this.store.copyBackground(b.id, b.doll));
      }
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
        if (!t || typeof t.parts !== 'object' || t.parts === null || typeof t.regions !== 'object' || t.regions === null) {
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
        const saved: TemplateData = { parts, regions };
        await this.store.updateStudioData<Record<string, TemplateData>>('templates', {}, (all) => ({ ...all, [doll.id]: saved }));
        return json(saved);
      }
      case 'GET /api/silhouette': {
        const { doll } = await this.doll(this.param(req, 'doll'));
        return png(await renderSilhouette(await this.workTemplate(doll), parseColor(req.query.get('color') ?? '00ff00', 'color'), parseColor(req.query.get('bg') ?? 'ffffff', 'bg')));
      }

      case 'POST /api/plan': {
        const b = this.body<{ dollId: string; theme: string; count: number; categories?: string[]; styleId?: string; set?: boolean }>(req);
        const { text } = this.requireAi();
        const { doll } = await this.doll(b.dollId);
        const theme = typeof b.theme === 'string' ? b.theme.trim().slice(0, 400) : '';
        if (!theme) throw new HttpError(400, 'テーマを入力してください');
        // 1 回の実行の上限に収まる数まで（案を作ったのに、生成で断られることが無いように）
        const most = Math.max(1, Math.min(MAX_ITEMS_PER_PLAN, Math.floor(this.options.budget.limits.perRun / this.maxAttempts)));
        if (b.set === true) {
          // セット: 選んだカテゴリごとに 1 点
          const categories = [...new Set(Array.isArray(b.categories) ? b.categories.filter((c) => doll.categories.some((d) => d.id === c)) : [])];
          if (categories.length < 2) throw new HttpError(400, 'セットに入れるカテゴリを 2 つ以上選んでください');
          if (categories.length > most) throw new HttpError(400, `セットに入れるカテゴリは ${most} 個までにしてください（1 回に作れる画像の上限のため）`);
          const planned = await planSet(text, doll, { theme, categories, style: findStyle(b.styleId).prompt });
          return json({
            items: planned.items,
            set: { id: this.store.newSetId(doll, planned.name), name: planned.name },
            missing: planned.missing,
            maxImages: planned.items.length * this.maxAttempts,
          });
        }
        const count = Math.floor(Number(b.count));
        if (!(count >= 1 && count <= most)) throw new HttpError(400, `品目数は 1〜${most} で指定してください`);
        const items = await planItems(text, doll, { theme, count, categories: b.categories, style: findStyle(b.styleId).prompt });
        return json({ items, maxImages: items.length * this.maxAttempts });
      }
      case 'POST /api/jobs': {
        const b = this.body<{ dollId: string; items: PlannedItem[]; styleId?: string; set?: { id: string; name: string } }>(req);
        const { text, image } = this.requireAi();
        const { doll } = await this.doll(b.dollId);
        const set = b.set === undefined ? undefined : this.setInput(b.set);
        if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS_PER_PLAN) throw new HttpError(400, `品目は 1〜${MAX_ITEMS_PER_PLAN} 点で指定してください`);
        const items = b.items.map((i): PlannedItem => {
          if (!doll.categories.some((c) => c.id === i.category)) throw new HttpError(400, `カテゴリ「${i.category}」がありません`);
          if (typeof i.name !== 'string' || !i.name.trim() || typeof i.description !== 'string' || !i.description.trim()) throw new HttpError(400, '品目の名前と説明を入力してください');
          return { category: i.category, name: i.name.trim(), description: i.description.slice(0, 1000), colors: Array.isArray(i.colors) ? i.colors.filter((c) => typeof c === 'string').slice(0, 6) : [] };
        });
        await this.options.budget.check(items.length * this.maxAttempts);
        // 生成と切り抜きは、余白を足した作業用のキャンバスの上で行う
        const template = await this.workTemplate(doll);
        const data = await this.workData(doll);
        const style = findStyle(b.styleId).prompt;
        const hi = await this.hiTemplate(doll);
        const job = this.startJob('items', doll.id, items.map((item): Candidate => ({ item, status: 'waiting', attempts: 0, warnings: [], notes: [] })), (c) =>
          generateCandidate({ text, image, budget: this.options.budget, doll, template, data, style, hi, maxAttempts: this.maxAttempts }, c as Candidate),
        );
        if (set) job.set = set;
        return json({ id: job.id });
      }
      case 'POST /api/background-jobs': {
        const b = this.body<{ dollId?: string | null; theme: string; count: number; styleId?: string }>(req);
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
        const style = findStyle(b.styleId).prompt;
        const job = this.startJob('backgrounds', doll?.id ?? null, planned.map((item): BackgroundCandidate => ({ item, status: 'waiting', attempts: 0, notes: [] })), (c) =>
          generateBackground({ text, image, budget: this.options.budget, style }, c as BackgroundCandidate),
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
          ...(job.set ? { set: job.set } : {}),
          candidates: job.candidates.map((c) => ({
            item: c.item,
            status: c.status,
            attempts: c.attempts,
            notes: c.notes,
            warnings: 'warnings' in c ? c.warnings : [],
            hasImage: !!c.png,
            hasShape: 'shape' in c && !!c.shape,
            hasHide: 'hide' in c && !!c.hide,
            hasFront: 'front' in c && !!c.front,
            hasUnder: 'under' in c && !!c.under,
          })),
        });
      }
      case 'GET /api/jobs/image': {
        const job = this.job(this.param(req, 'id'));
        const candidate = job.candidates[Number(this.param(req, 'index'))];
        const kind = req.query.get('kind');
        const layers: Record<string, Buffer | undefined> =
          candidate && 'warnings' in candidate ? { source: candidate.source, shape: candidate.shape, hide: candidate.hide, front: candidate.front, under: candidate.under } : {};
        const data = kind && kind !== 'png' ? layers[kind] : candidate?.png;
        if (!data) throw new HttpError(404, '画像がありません');
        return png(data);
      }

      case 'POST /api/publish': {
        const b = this.body<{ message?: string }>(req);
        const status = await this.gitStatus();
        if (!status.isRepo) throw new HttpError(409, `素材フォルダ（${this.store.dir}）が git の作業フォルダではないので、公開できません。保存した内容は残っています`);
        // 公開先のほうが新しければ、先に取り込む（手元の変更は残る）。取り込めないときは、公開しない
        const synced = await this.sync();
        if (synced.state === 'blocked') throw new HttpError(409, `公開できませんでした。${synced.message}`);
        const removed = await this.store.removeUnusedFiles();
        const log: string[] = [];
        if (synced.state === 'updated') log.push(synced.message);
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

  private get maxAttempts(): number {
    return Math.max(1, Math.min(3, Math.floor(this.options.maxAttempts ?? MAX_ATTEMPTS)));
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
  // セットの指定（ID と名前）を確かめる。名前や ID の決まりは、保存のとき（ContentStore）にも確かめる
  private setInput(value: unknown): { id: string; name: string } {
    const v = value as { id?: unknown; name?: unknown } | null;
    if (typeof v !== 'object' || v === null || typeof v.id !== 'string' || !v.id || v.id.length > 200 || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) {
      throw new HttpError(400, 'セットの指定が正しくありません');
    }
    return { id: v.id, name: v.name.trim() };
  }

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
