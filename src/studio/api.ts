/**
 * スタジオの画面から API を呼ぶ部分
 * 開発中は PC 上の API（同じ開発サーバー）、公開後は VITE_STUDIO_API で指定したサーバーにつなぐ
 */
import type { Box, Manifest, ManifestBackground, ManifestCategory, ManifestDoll, ManifestItem } from '../content/manifest';

const API_BASE: string = (import.meta.env.VITE_STUDIO_API as string | undefined) ?? '/api';
// 素材フォルダの中身（画像）の置き場所
export const CONTENT_BASE: string = (import.meta.env.VITE_STUDIO_CONTENT as string | undefined) ?? `${import.meta.env.BASE_URL}local-content/`;

export interface Status {
  contentDir: string;
  ai: { text: boolean; image: boolean };
  budget: { usedToday: number; perDay: number | null; perRun: number; maxAttempts: number }; // perDay: null で上限なし
  // behind: 公開されている素材のほうが何件新しいか（ほかの PC やクラウドから公開された分）
  git: { isRepo: boolean; branch: string | null; changedFiles: number; unusedFiles: number; behind: number };
}
// state: updated = 取り込んだ / latest = もう最新 / blocked = 新しいものがあるが取り込めない / offline = 確かめられない / no-repo = git の作業フォルダでない
export interface SyncResult {
  state: 'updated' | 'latest' | 'blocked' | 'offline' | 'no-repo';
  updated: boolean;
  behind: number;
  message: string;
}
export interface Warning {
  code: string;
  message: string;
}
export interface ProcessResult {
  png: string; // base64
  source: string;
  shape: string | null; // AI が描いた体と服の形（base64 PNG）。切り抜き済みの画像では null
  warnings: Warning[];
  alignment: { scale: number; dx: number; dy: number; score: number };
}
export interface TemplateData {
  parts: Record<string, Box>;
  regions: Record<string, Box | null>;
}
export interface PlannedItem {
  category: string;
  name: string;
  description: string;
  colors: string[];
}
export interface JobCandidate {
  item: { name: string; description: string; category?: string; colors?: string[] };
  status: 'waiting' | 'working' | 'passed' | 'flagged' | 'failed';
  attempts: number;
  notes: string[];
  warnings: Warning[];
  hasImage: boolean;
  hasShape?: boolean;
  hasHide?: boolean; // 差し替え式の品目（くつ・てぶくろ）: 着ているあいだドールを隠す所がある
  hasFront?: boolean; // 髪: 前髪の範囲がある（本物のドールに描かせた髪）
  hasUnder?: boolean; // くつ: 靴の中に見える肌の絵がある
}
// セット（同じテーマで一度に作った服の集まり）
export interface SetRef {
  id: string;
  name: string;
}
export interface Job {
  id: string;
  kind: 'items' | 'backgrounds';
  done: boolean;
  error: string | null;
  candidates: JobCandidate[];
  set?: SetRef; // セットとして作っているとき
}

export class ApiError extends Error {}

async function request(method: string, path: string, body?: BodyInit, json = false): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, body, headers: json ? { 'content-type': 'application/json' } : undefined });
  } catch {
    throw new ApiError('スタジオのサーバーに接続できません。PC で「npm run studio」を実行してから、このページを開いてください');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(detail?.error ?? `サーバーのエラー（${response.status}）`);
  }
  return response;
}
const get = async <T>(path: string) => (await (await request('GET', path)).json()) as T;
const send = async <T>(method: string, path: string, value: unknown) => (await (await request(method, path, JSON.stringify(value), true)).json()) as T;
const q = (params: Record<string, string | number | null | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export const api = {
  status: () => get<Status>('/status'),
  content: () => get<Manifest>('/content'),
  process: async (dollId: string, file: Blob) => (await (await request('POST', `/process?${q({ doll: dollId })}`, file)).json()) as ProcessResult,
  addItem: (input: { dollId: string; category: string; name: string; png: string; replaceId?: string; hide?: string; shape?: string; front?: string; under?: string; set?: SetRef }) => send<ManifestItem>('POST', '/items', input),
  // set: null で全部のセットから外す。セットの ID でそのセットにも入れる（ほかのセットはそのまま）。{ name } で新しいセットを作って入れる。
  // leaveSet: そのセットだけから外す。layer: null でカテゴリの重ね順に戻す
  updateItem: (change: { id: string; name?: string; category?: string; layer?: number | null; set?: null | string | { name: string }; leaveSet?: string }) => send<ManifestItem>('PATCH', '/items', change),
  // カテゴリの中の服の並び（ids はそのカテゴリの服の全部を、新しい順に）
  reorderItems: (dollId: string, category: string, ids: string[]) => send<{ ok: true }>('POST', '/items/order', { dollId, category, ids }),
  // 服の位置と大きさ: 服の中心を軸に scale 倍してから (dx, dy) 動かす（キャンバスの px）
  transformItem: (id: string, t: { scale: number; dx: number; dy: number }) => send<ManifestItem>('POST', '/items/transform', { id, ...t }),
  updateDoll: (id: string, change: { name?: string; hidden?: boolean }) => send<ManifestDoll>('PATCH', '/dolls', { id, ...change }),
  splitHair: (id: string) => send<ManifestItem>('POST', '/items/split-hair', { id }),
  deleteItem: (id: string) => request('DELETE', `/items?${q({ id })}`),
  saveCategory: (dollId: string, category: Omit<ManifestCategory, 'id'> & { id?: string }) => send<ManifestCategory>('PUT', '/categories', { dollId, category }),
  updateCategory: (dollId: string, id: string, change: Partial<Omit<ManifestCategory, 'id'>>) => send<ManifestCategory>('PATCH', '/categories', { dollId, id, change }),
  deleteCategory: (dollId: string, id: string) => request('DELETE', `/categories?${q({ doll: dollId, id })}`),
  addBackground: async (dollId: string | null, name: string, file: Blob) =>
    (await (await request('POST', `/backgrounds?${q({ doll: dollId, name })}`, file)).json()) as ManifestBackground,
  // 背景を、ほかのドールにも置く（doll が null なら、全部のドールで使う背景）
  copyBackground: (id: string, doll: string | null) => send<ManifestBackground>('POST', '/backgrounds/copy', { id, doll }),
  deleteBackground: (id: string) => request('DELETE', `/backgrounds?${q({ id })}`),
  addDoll: async (name: string, file: Blob) => (await (await request('POST', `/dolls?${q({ name })}`, file)).json()) as { doll: ManifestDoll; template: TemplateData },
  template: (dollId: string) => get<TemplateData>(`/template?${q({ doll: dollId })}`),
  saveTemplate: (dollId: string, template: TemplateData) => send<TemplateData>('PUT', '/template', { dollId, template }),
  silhouetteUrl: (dollId: string, color: string, bg: string) => `${API_BASE}/silhouette?${q({ doll: dollId, color: color.replace('#', ''), bg: bg.replace('#', '') })}`,
  plan: (input: { dollId: string; theme: string; count: number; categories: string[]; styleId: string }) => send<{ items: PlannedItem[]; maxImages: number }>('POST', '/plan', input),
  // セットの企画: 選んだカテゴリごとに 1 点。missing は、企画が返さなかったカテゴリの名前
  planSet: (input: { dollId: string; theme: string; categories: string[]; styleId: string }) =>
    send<{ items: PlannedItem[]; set: SetRef; missing: string[]; maxImages: number }>('POST', '/plan', { ...input, set: true }),
  startJob: (dollId: string, items: PlannedItem[], styleId: string, set?: SetRef) => send<{ id: string }>('POST', '/jobs', { dollId, items, styleId, ...(set ? { set } : {}) }),
  renameSet: (dollId: string, id: string, name: string) => send<SetRef>('PATCH', '/sets', { dollId, id, name }),
  // セットの並び（ids はそのドールのセットの全部を、新しい順に）
  reorderSets: (dollId: string, ids: string[]) => send<{ ok: true }>('POST', '/sets/order', { dollId, ids }),
  startBackgroundJob: (input: { dollId: string | null; theme: string; count: number; styleId: string }) => send<{ id: string }>('POST', '/background-jobs', input),
  job: (id: string) => get<Job>(`/jobs?${q({ id })}`),
  // v = 何回目の生成か（作り直すと画像が変わるので、古い画像を使い回さない）
  jobImageUrl: (id: string, index: number, kind: 'png' | 'source' | 'shape' | 'hide' | 'front' | 'under' = 'png', v = 0) => `${API_BASE}/jobs/image?${q({ id, index, kind, v })}`,
  publish: (message: string) => send<{ log: string }>('POST', '/publish', { message }),
  // 公開されている素材（ほかの PC やクラウドから公開された分）を取り込む
  sync: () => send<SyncResult>('POST', '/sync', {}),
};

export const contentUrl = (file: string) => `${CONTENT_BASE}${file}`;

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
