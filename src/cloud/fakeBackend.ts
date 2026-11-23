/**
 * 偽物の裏側（開発とテスト用）
 *
 * 端末の中だけで動く。絵は、色の付いた四角。チケット・進み具合・自分の服の一覧は localStorage に置く。
 * 本物と同じく、できた品目は、その場で自分の服になる。品目ごとに「できあがる時刻」を持つので、
 * 読み込み直したとき、時刻を過ぎていた分は、できあがっている（「閉じていても、サーバーが進める」を確かめられる）。
 * `?studio=fake` で開いたときと、E2E で使う。本物（Firebase）と同じ形（StudioBackend）。
 */
import { browserAccountEnv, createAccount } from './account';
import { BackendError, HUE_MAX, HUE_MIN, NAME_MAX, OLD_SERVER_MESSAGE, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from './backend';
import { createFakeAuthPort, fakeGoTo } from './fakeAuth';
import type { FakeWorld } from './fakeAuth';
import type { MyItem, MyItemInfo, SetRef, StudioBackend, StudioCandidate, StudioJob, StudioUser } from './backend';

export interface FakeOptions {
  tickets?: number; // 最初のチケット（保存されている利用者がいれば、そちらが優先）
  delayMs?: number; // 1 点ができるまでの時間
  planMs?: number; // 「作る」の返事が返るまでの時間（企画を作る時間のまね。注文の演出を確かめるため）
  failCategories?: string[]; // このカテゴリの品目は「できなかった」にする
  admin?: boolean;
  offline?: boolean; // つながっていないときの動き
  oldServer?: boolean; // サーバーが古い版のときの動き
  loginFail?: string; // ログインを、この auth/… の語で失敗させる（方法 2 では、access_denied が Google の「キャンセル」のまね）
  googleTaken?: boolean; // 「結び付ける」を、いつも「もう使われている」にする
  // 絵を作る（既定は、ブラウザのキャンバスで色の付いた四角）。テストでは差し替える
  image?: (color: string) => Promise<Blob>;
}

const KEY = 'dressup_fake_backend';
const ACCOUNT_KEY = 'dressup_fake_account'; // { google: boolean } いまの利用者が、Google に結び付いているか
const GOOGLE_KEY = 'dressup_fake_google'; // ログアウトして置いてある、Google のアカウントの世界（State）
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
  hue: number;
  order: number;
  updatedAt: number;
}
// dueAt: 作成中の品目が、できあがる時刻
type FakeJob = StudioJob & { dueAt: number };
interface State {
  user: StudioUser;
  jobs: FakeJob[];
  items: SavedItem[];
  seen: string[]; // 結果を見た仕事
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

// 進み具合は、ただのデータ（古い端末には structuredClone が無い）
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const colorOf = (index: number) => COLORS[index % COLORS.length];
// 品目ごとに、ドールのキャンバスの上の位置を少しずつ変える（重なって見えなくならないように）
const boxOf = (index: number) => ({ x: (CANVAS - SIZE.w) / 2, y: 300 + ((index * 150) % 450), w: SIZE.w, h: SIZE.h });
const newCode = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const publicJob = (job: FakeJob): StudioJob => {
  const { dueAt: _dueAt, ...rest } = clone(job);
  void _dueAt;
  return rest;
};

export function createFakeBackend(options: FakeOptions = {}): StudioBackend {
  const delay = options.delayMs ?? 1500;
  const planMs = options.planMs ?? 800;
  const makeImage = options.image ?? defaultImage;
  const fail = new Set(options.failCategories ?? []);
  const userListeners = new Set<(user: StudioUser) => void>();
  const jobListeners = new Map<string, Set<(job: StudioJob) => void>>();

  const parseState = (raw: string | null): State | null => {
    try {
      const saved = JSON.parse(raw ?? 'null') as State | null;
      if (saved && saved.user && Array.isArray(saved.jobs) && Array.isArray(saved.items)) return { ...saved, seen: Array.isArray(saved.seen) ? saved.seen : [] };
    } catch {
      // 読めなければ、最初から
    }
    return null;
  };
  const load = (): State =>
    parseState(localStorage.getItem(KEY)) ?? { user: { userCode: newCode(), tickets: options.tickets ?? 5, admin: options.admin ?? false }, jobs: [], items: [], seen: [], counter: 0 };
  let state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 保存できなくても動く
    }
  };

  const online = () => {
    if (options.offline) throw new BackendError('offline', 'インターネットにつながっていません');
  };
  const notifyUser = () => userListeners.forEach((l) => l({ ...state.user }));
  const jobOf = (id: string) => state.jobs.find((j) => j.id === id);
  const notifyJob = (id: string) => {
    const job = jobOf(id);
    if (job) jobListeners.get(id)?.forEach((l) => l(publicJob(job)));
  };
  const setTickets = (tickets: number) => {
    state = { ...state, user: { ...state.user, tickets } };
    notifyUser();
  };

  // 時刻を過ぎた品目を仕上げて、次の品目に進む（過ぎた分が続いていれば、まとめて進む）。変わったら true
  const advance = (job: FakeJob, now: number): boolean => {
    let changed = false;
    while (!job.done) {
      const current = job.candidates.find((c) => c.status === 'working');
      if (!current || now < job.dueAt) break;
      changed = true;
      if (fail.has(current.categoryId)) {
        current.status = 'failed';
        current.notes = ['絵を作れませんでした。チケットは戻しました'];
        job.tickets -= 1;
        if (!state.user.admin) setTickets(state.user.tickets + 1);
      } else {
        const id = `my:${job.id}-${current.index}-1`;
        current.status = 'kept';
        current.itemId = id;
        state.items = [
          ...state.items,
          { id, dollId: job.dollId, name: current.name, categoryId: current.categoryId, index: current.index, ...(job.set ? { set: job.set } : {}), createdAt: job.dueAt, hue: 0, order: job.dueAt, updatedAt: job.dueAt },
        ];
      }
      const next = job.candidates.find((c) => c.status === 'waiting');
      if (next) {
        next.status = 'working';
        job.dueAt += delay;
      } else {
        job.done = true;
      }
    }
    return changed;
  };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (jobId: string) => {
    const job = jobOf(jobId);
    if (!job || job.done || timers.has(jobId)) return;
    timers.set(
      jobId,
      setTimeout(
        () => {
          timers.delete(jobId);
          const current = jobOf(jobId);
          if (!current) return;
          if (advance(current, Date.now())) {
            save();
            notifyJob(jobId);
          }
          schedule(jobId);
        },
        Math.max(0, job.dueAt - Date.now()),
      ),
    );
  };
  // 閉じていた間に過ぎた分を仕上げ、まだ途中の分は、続きから進める
  for (const job of state.jobs) advance(job, Date.now());
  save();
  for (const job of state.jobs) schedule(job.id);

  // ---- 利用者の入れ替え（ログイン）。いまの保存 = いまの利用者の世界 ----
  let google = ((): boolean => {
    try {
      return (JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as { google?: unknown } | null)?.google === true;
    } catch {
      return false;
    }
  })();
  const setGoogle = (value: boolean) => {
    google = value;
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ google }));
    } catch {
      // 保存できなくても動く
    }
  };
  // 世界を入れ替える。メモリの state も、すぐ読み直す（ページの読み込み直しは、呼ぶ側がする）
  const adopt = (next: State) => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    state = next;
    for (const job of state.jobs) advance(job, Date.now());
    save();
    for (const job of state.jobs) schedule(job.id);
    notifyUser();
  };
  const world: FakeWorld = {
    link() {
      // 置いてある Google の世界がある = その Google は、もう使われている
      if (localStorage.getItem(GOOGLE_KEY) !== null) throw { code: 'auth/credential-already-in-use' };
      setGoogle(true);
    },
    signin() {
      const parked = parseState(localStorage.getItem(GOOGLE_KEY));
      if (parked) {
        try {
          localStorage.removeItem(GOOGLE_KEY);
        } catch {
          // 消せなくても進む
        }
        adopt(parked);
      }
      setGoogle(true);
    },
    signOut() {
      try {
        localStorage.setItem(GOOGLE_KEY, JSON.stringify(state));
      } catch {
        // 置けなければ、ここで失敗にする（置かずに入れ替えると、世界が無くなる）
        throw { code: 'auth/network-request-failed' };
      }
      adopt({ user: { userCode: newCode(), tickets: 0, admin: false }, jobs: [], items: [], seen: [], counter: 0 });
      setGoogle(false);
    },
    isGoogle: () => google,
  };
  const account = createAccount(
    async () => createFakeAuthPort(world, { loginFail: options.loginFail, googleTaken: options.googleTaken }),
    browserAccountEnv((url) => fakeGoTo(url, window, { loginFail: options.loginFail })),
  );

  const toInfo = (saved: SavedItem): MyItemInfo => ({
    id: saved.id,
    dollId: saved.dollId,
    item: { id: saved.id, name: saved.name, category: saved.categoryId, image: { file: 'image', canvasW: CANVAS, canvasH: CANVAS, box: boxOf(saved.index) }, thumb: 'thumb' },
    ...(saved.set ? { set: saved.set } : {}),
    createdAt: saved.createdAt,
    hue: saved.hue,
    order: saved.order,
    updatedAt: saved.updatedAt,
    notes: [],
  });
  const toMyItem = async (saved: SavedItem): Promise<MyItem> => {
    const blob = await makeImage(colorOf(saved.index));
    return { ...toInfo(saved), files: { image: blob, thumb: blob }, owner: state.user.userCode };
  };
  const itemOf = (id: string): SavedItem => {
    const saved = state.items.find((i) => i.id === id);
    if (!saved) throw new BackendError('refused', 'この服は見つかりません');
    return saved;
  };

  return {
    account,
    async signIn() {
      online();
      if (options.oldServer) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
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
      if (!state.user.admin && state.user.tickets < cost) throw new BackendError('no-tickets', `チケットが足りません（のこり ${state.user.tickets} 枚、必要 ${cost} 枚）`);
      // 企画を作る時間のまね（この間は、まだ引いていない）
      if (planMs > 0) await new Promise((resolve) => setTimeout(resolve, planMs));
      if (!state.user.admin && state.user.tickets < cost) throw new BackendError('no-tickets', `チケットが足りません（のこり ${state.user.tickets} 枚、必要 ${cost} 枚）`);
      const id = `fake-${++state.counter}`;
      const categories = target.kind === 'set' ? target.categoryIds : [target.categoryId];
      const candidates = categories.map((categoryId, index): StudioCandidate => ({ index, name: `${text}の${categoryId}`.slice(0, NAME_MAX), categoryId, status: index === 0 ? 'working' : 'waiting', notes: [] }));
      const now = Date.now();
      const job: FakeJob = {
        id,
        dollId,
        ...(target.kind === 'set' ? { set: { id: `my:set-${id}`, name: `${text}のセット`.slice(0, NAME_MAX) } } : {}),
        done: false,
        candidates,
        tickets: cost,
        createdAt: now,
        dueAt: now + delay,
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
      if (job) listener(publicJob(job));
      return () => set.delete(listener);
    },
    async openJobs() {
      online();
      return state.jobs.filter((job) => !state.seen.includes(job.id)).map(publicJob);
    },
    async ackJob(jobId) {
      online();
      const job = jobOf(jobId);
      if (!job || !job.done || state.seen.includes(jobId)) return;
      state.seen = [...state.seen, jobId];
      save();
    },
    async listMyItems() {
      online();
      return state.items.map(toInfo);
    },
    async fetchMyItem(id) {
      online();
      return toMyItem(itemOf(id));
    },
    async updateMyItem(id, change) {
      online();
      const saved = itemOf(id);
      const name = typeof change.name === 'string' ? change.name.trim().slice(0, NAME_MAX).trim() || saved.name : saved.name;
      const hue = typeof change.hue === 'number' && Number.isFinite(change.hue) ? Math.max(HUE_MIN, Math.min(HUE_MAX, Math.round(change.hue))) : saved.hue;
      if (name !== saved.name || hue !== saved.hue) {
        Object.assign(saved, { name, hue, updatedAt: Date.now() });
        save();
      }
      return toInfo(saved);
    },
    async orderMyItems(ids) {
      online();
      if (ids.length === 0 || new Set(ids).size !== ids.length) throw new BackendError('refused', '並び順を読み取れませんでした');
      const targets = ids.map(itemOf);
      const now = Date.now();
      targets.forEach((saved, i) => Object.assign(saved, { order: now - i, updatedAt: now }));
      save();
      return targets.map(toInfo);
    },
    async deleteMyItem(id) {
      online();
      state.items = state.items.filter((i) => i.id !== id);
      save();
    },
  };
}
