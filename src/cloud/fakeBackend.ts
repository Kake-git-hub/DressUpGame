/**
 * 偽物の裏側（開発とテスト用）
 *
 * 端末の中だけで動く。絵は、色の付いた四角。チケット・進み具合・自分の服の一覧は localStorage に置くので、
 * 読み込み直しても続きから動く（「作っている間に閉じて、開き直す」を確かめられる）。
 * `?studio=fake` で開いたときと、E2E で使う。本物（Firebase）と同じ形（StudioBackend）。
 */
import { BackendError, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from './backend';
import type { MyItem, SetRef, StudioBackend, StudioCandidate, StudioJob, StudioPreview, StudioUser } from './backend';

export interface FakeOptions {
  tickets?: number; // 最初のチケット（保存されている利用者がいれば、そちらが優先）
  delayMs?: number; // 1 点ができるまでの時間
  failCategories?: string[]; // このカテゴリの品目は「できなかった」にする
  admin?: boolean;
  offline?: boolean; // つながっていないときの動き
  // 絵を作る（既定は、ブラウザのキャンバスで色の付いた四角）。テストでは差し替える
  image?: (color: string) => Promise<Blob>;
}

const KEY = 'dressup_fake_backend';
const CANVAS = 1024;
const SIZE = { w: 240, h: 200 };
const COLORS = ['#e040a0', '#40a0e0', '#40c080', '#e0a040', '#8060e0', '#e06040'];

interface SavedItem {
  id: string;
  dollId: string;
  name: string;
  categoryId: string;
  index: number;
  set?: SetRef;
  createdAt: number;
}
interface State {
  user: StudioUser;
  jobs: StudioJob[];
  items: SavedItem[];
  counter: number;
}

async function defaultImage(color: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE.w;
  canvas.height = SIZE.h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, SIZE.w, SIZE.h);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('絵を作れませんでした'))), 'image/png'));
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('絵を読めませんでした'));
    reader.readAsDataURL(blob);
  });
}

// 進み具合は、ただのデータ（古い端末には structuredClone が無い）
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const colorOf = (index: number) => COLORS[index % COLORS.length];
// 品目ごとに、ドールのキャンバスの上の位置を少しずつ変える（重なって見えなくならないように）
const boxOf = (index: number) => ({ x: (CANVAS - SIZE.w) / 2, y: 300 + ((index * 150) % 450), w: SIZE.w, h: SIZE.h });
const newCode = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

export function createFakeBackend(options: FakeOptions = {}): StudioBackend {
  const delay = options.delayMs ?? 1500;
  const makeImage = options.image ?? defaultImage;
  const fail = new Set(options.failCategories ?? []);
  const userListeners = new Set<(user: StudioUser) => void>();
  const jobListeners = new Map<string, Set<(job: StudioJob) => void>>();

  const load = (): State => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
      if (saved && saved.user && Array.isArray(saved.jobs) && Array.isArray(saved.items)) return saved;
    } catch {
      // 読めなければ、最初から
    }
    return { user: { userCode: newCode(), tickets: options.tickets ?? 5, admin: options.admin ?? false }, jobs: [], items: [], counter: 0 };
  };
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても動く
    }
  };
  save();

  const online = () => {
    if (options.offline) throw new BackendError('offline', 'インターネットにつながっていません');
  };
  const notifyUser = () => userListeners.forEach((l) => l({ ...state.user }));
  const jobOf = (id: string) => state.jobs.find((j) => j.id === id);
  const notifyJob = (id: string) => {
    const job = jobOf(id);
    if (job) jobListeners.get(id)?.forEach((l) => l(clone(job)));
  };
  const setTickets = (tickets: number) => {
    state = { ...state, user: { ...state.user, tickets } };
    save();
    notifyUser();
  };

  // 作成中の 1 点を仕上げて、次の 1 点に進む
  const step = async (jobId: string) => {
    const job = jobOf(jobId);
    const current = job?.candidates.find((c) => c.status === 'working');
    if (!job || !current) return;
    if (fail.has(current.categoryId)) {
      current.status = 'failed';
      current.notes = ['絵を作れませんでした。チケットは戻しました'];
      job.tickets -= 1;
      if (!state.user.admin) setTickets(state.user.tickets + 1);
    } else {
      const preview: StudioPreview = { url: await toDataUrl(await makeImage(colorOf(current.index))), canvasW: CANVAS, canvasH: CANVAS, box: boxOf(current.index) };
      current.status = 'done';
      current.preview = preview;
    }
    const next = job.candidates.find((c) => c.status === 'waiting');
    if (next) next.status = 'working';
    else job.done = true;
    save();
    notifyJob(jobId);
    if (next) schedule(jobId);
  };
  const schedule = (jobId: string) => {
    setTimeout(() => void step(jobId), delay);
  };
  // 閉じる前に作りかけだった分を、続きから進める
  for (const job of state.jobs) if (!job.done) schedule(job.id);

  const undecided = (job: StudioJob) => job.candidates.some((c) => c.status === 'waiting' || c.status === 'working' || c.status === 'done');

  const toMyItem = async (saved: SavedItem): Promise<MyItem> => {
    const blob = await makeImage(colorOf(saved.index));
    return {
      id: saved.id,
      dollId: saved.dollId,
      item: { id: saved.id, name: saved.name, category: saved.categoryId, image: { file: 'image', canvasW: CANVAS, canvasH: CANVAS, box: boxOf(saved.index) }, thumb: 'thumb' },
      files: { image: blob, thumb: blob },
      ...(saved.set ? { set: saved.set } : {}),
      createdAt: saved.createdAt,
      owner: state.user.userCode,
    };
  };

  return {
    async signIn() {
      online();
      return { ...state.user };
    },
    onUser(listener) {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    async startJob({ dollId, theme, target }) {
      online();
      const text = theme.trim();
      if (!text || text.length > THEME_MAX) throw new BackendError('refused', `テーマは 1〜${THEME_MAX} 文字で入力してください`);
      if (target.kind === 'set' && (target.categoryIds.length < SET_MIN || target.categoryIds.length > SET_MAX)) {
        throw new BackendError('refused', `セットに入れるものは ${SET_MIN}〜${SET_MAX} 個にしてください`);
      }
      const cost = ticketCost(target);
      if (!state.user.admin && state.user.tickets < cost) throw new BackendError('no-tickets', 'チケットが足りません');
      const id = `fake-${++state.counter}`;
      const categories = target.kind === 'set' ? target.categoryIds : [target.categoryId];
      const candidates = categories.map((categoryId, index): StudioCandidate => ({ index, name: `${text}の${categoryId}`.slice(0, 20), categoryId, status: index === 0 ? 'working' : 'waiting', notes: [] }));
      const job: StudioJob = {
        id,
        dollId,
        ...(target.kind === 'set' ? { set: { id: `my:set-${id}`, name: `${text}のセット`.slice(0, 20) } } : {}),
        done: false,
        candidates,
        tickets: cost,
        createdAt: Date.now(),
      };
      state.jobs = [job, ...state.jobs];
      if (!state.user.admin) setTickets(state.user.tickets - cost);
      save();
      schedule(id);
      return { jobId: id, cost };
    },
    watchJob(jobId, listener) {
      const set = jobListeners.get(jobId) ?? new Set();
      set.add(listener);
      jobListeners.set(jobId, set);
      const job = jobOf(jobId);
      if (job) listener(clone(job));
      return () => set.delete(listener);
    },
    async pendingJobs() {
      online();
      return clone(state.jobs.filter(undecided));
    },
    async keep(jobId, index, name) {
      online();
      const job = jobOf(jobId);
      const candidate = job?.candidates[index];
      if (!job || !candidate || candidate.status !== 'done') throw new BackendError('refused', 'この候補は、もう使えません');
      const saved: SavedItem = {
        id: `my:${jobId}-${index}`,
        dollId: job.dollId,
        name: name.trim() || candidate.name,
        categoryId: candidate.categoryId,
        index,
        ...(job.set ? { set: job.set } : {}),
        createdAt: Date.now(),
      };
      candidate.status = 'kept';
      state.items = [...state.items, saved];
      save();
      notifyJob(jobId);
      return toMyItem(saved);
    },
    async discard(jobId, index) {
      online();
      const candidate = jobOf(jobId)?.candidates[index];
      if (!candidate || candidate.status !== 'done') throw new BackendError('refused', 'この候補は、もう捨てられません');
      candidate.status = 'discarded';
      save();
      notifyJob(jobId);
    },
    async listMyItems() {
      online();
      return (await Promise.all(state.items.map(toMyItem))).map(({ id, dollId, item, set, createdAt }) => ({ id, dollId, item, ...(set ? { set } : {}), createdAt }));
    },
    async fetchMyItem(id) {
      online();
      const saved = state.items.find((i) => i.id === id);
      if (!saved) throw new BackendError('refused', 'この服は見つかりません');
      return toMyItem(saved);
    },
    async deleteMyItem(id) {
      online();
      state.items = state.items.filter((i) => i.id !== id);
      save();
    },
  };
}
