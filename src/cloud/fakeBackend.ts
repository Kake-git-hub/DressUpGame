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
import type { AdoptAnswer, MyItem, MyItemInfo, SetRef, StudioBackend, StudioCandidate, StudioJob, StudioUser, TradeItem, TradeState } from './backend';
import { addMonthsJst } from './expiry';
import type { TradeRefusal, WirePurchase, WireShop } from './wire';

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
  noAdopt?: boolean; // 合わせる（offerHandoff）が、サーバーが古い版のときの動き（old-server）
  adoptFail?: number; // adopt を、この回数だけ、つながらない（offline）で失敗させる（残りの数は、端末に覚える）
  stashed?: boolean; // false なら、「もう使われている」と断られたときの証明が、返らなかったことにする
  silentFail?: boolean; // 画面なしの行き来（prompt=none）を、Google が interaction_required で断ったことにする
  noTrade?: boolean; // 交換が、サーバーが古い版のときの動き（old-server）
  // 交換の「にせの あいて」
  partner?: {
    claimAfterMs?: number; // こちらが始めてから、あいてが読んで服を出すまで（既定 1500）
    chooseMs?: number; // あいてが読んでから、服を出すまで（この間、始めた側は「あいてが えらんでいるよ」。既定 0）
    acceptAfterMs?: number; // あいてが服を出してから、「はい」を押すまで（既定 1000）
    refuse?: TradeRefusal; // こちらが FAKE を読んだとき、この語で断る
    cancelAfterMs?: number; // 交換が始まってから、あいてが「やめる」を押すまで
  };
  // 支払い（チケットを買う）
  shop?: { open?: boolean; packs?: string }; // お店の設定（既定は open: true、packs: '10:300,30:800'。packs は「枚数:値段」をコンマでつなぐ）
  payResult?: 'paid' | 'cancel' | 'slow'; // にせの支払いページの、標準の結果（既定 paid）。slow = 払ったあと、チケットが足されるのが 40 秒あと。cancel = ページの標準のボタンが「やめる」
  welcome?: number; // 最初のログインで、ようこその枚数を知らせる（1 回だけ。この端末の利用者ごと）
  anonymous?: boolean; // ログインしていない扱い（買うのは pay:login で断る）
  fakeLots?: { count: number; daysLeft: number }[]; // 最初から持っている、買った分（あと何日で切れるか）。保存されている利用者がいれば、そちらが優先
  // 絵を作る（既定は、ブラウザのキャンバスで色の付いた四角）。テストでは差し替える
  image?: (color: string) => Promise<Blob>;
}

const KEY = 'dressup_fake_backend';
const ACCOUNT_KEY = 'dressup_fake_account'; // { google: boolean } いまの利用者が、Google に結び付いているか
const GOOGLE_KEY = 'dressup_fake_google'; // ログアウトして置いてある、Google のアカウントの世界（State）
const HANDOFF_KEY = 'dressup_fake_handoff'; // { word, world } 引き継ぎの合い言葉と、そのときの匿名の世界の写し（State）
const ADOPT_FAIL_KEY = 'dressup_fake_adopt_fail'; // adopt を、あと何回、失敗させるか
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
// 交換 1 件。にせの あいては、時刻で動く（呼ばれたときに、過ぎた分を進める）
interface FakeTrade {
  id: string;
  code: string;
  me: 'a' | 'b';
  status: 'open' | 'claimed' | 'joined' | 'done' | 'cancelled';
  mine?: SavedItem; // 出した服の控え（入れ替わったあと、自分の服から消えても見せられるように）
  theirs: SavedItem; // にせの服
  startedAt: number;
  joinedAt: number; // 両方が服を出した時刻（まだなら Infinity）
  myAccepted: boolean;
  theirAccepted: boolean;
  reason?: 'cancel' | 'expired' | 'gone' | 'conflict' | 'replaced';
  receivedId?: string;
}
const FAKE_CODE = 'FAKE';
const FAKE_INDEX = 3;

// にせの支払い 1 件。status は、にせの支払いページが決める（open → paid / cancel）
interface FakePurchase {
  id: string;
  tickets: number;
  expiresAt: number; // 買ったチケットの期限（始めた時刻の 6 か月あと）
  status: 'open' | 'paid' | 'cancel';
  paidAt?: number;
  credited?: boolean; // チケットを足した
  announced?: boolean; // アプリに伝えた（shopAck）
}
const SLOW_MS = 40_000;
const DAY_MS = 24 * 3600 * 1000;
const PAY_PARAM = 'fake';

// にせの裏側。StudioBackend のほかに、にせの支払いページが使う口を持つ
export interface FakeBackend extends StudioBackend {
  readonly payResult: 'paid' | 'cancel' | 'slow';
  // にせの支払いページが、支払いの結果を決める（paid = 払った、cancel = やめた）。すでに決まっていれば、何もしない
  fakePay(session: string, result: 'paid' | 'cancel'): void;
}

// dueAt: 作成中の品目が、できあがる時刻
type FakeJob = StudioJob & { dueAt: number };
interface State {
  user: StudioUser;
  jobs: FakeJob[];
  items: SavedItem[];
  seen: string[]; // 結果を見た仕事
  counter: number;
  purchases?: FakePurchase[];
  welcomed?: boolean; // ようこその枚数を、もう知らせた
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
const newWord = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const newCode = () => Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const publicJob = (job: FakeJob): StudioJob => {
  const { dueAt: _dueAt, ...rest } = clone(job);
  void _dueAt;
  return rest;
};

export function createFakeBackend(options: FakeOptions = {}): FakeBackend {
  const delay = options.delayMs ?? 1500;
  const planMs = options.planMs ?? 800;
  const makeImage = options.image ?? defaultImage;
  const fail = new Set(options.failCategories ?? []);
  const userListeners = new Set<(user: StudioUser) => void>();
  const welcomeListeners = new Set<(tickets: number) => void>();
  const jobListeners = new Map<string, Set<(job: StudioJob) => void>>();

  const parseState = (raw: string | null): State | null => {
    try {
      const saved = JSON.parse(raw ?? 'null') as State | null;
      if (saved && saved.user && Array.isArray(saved.jobs) && Array.isArray(saved.items)) return { ...saved, user: { ...saved.user, free: saved.user.free ?? saved.user.tickets, lots: saved.user.lots ?? [] }, seen: Array.isArray(saved.seen) ? saved.seen : [] };
    } catch {
      // 読めなければ、最初から
    }
    return null;
  };
  const load = (): State => {
    const saved = parseState(localStorage.getItem(KEY));
    if (saved) return saved;
    const free = options.tickets ?? 5;
    const now = Date.now();
    const lots = (options.fakeLots ?? []).map((l) => ({ count: l.count, left: l.count, expiresAt: now + l.daysLeft * DAY_MS }));
    return { user: { userCode: newCode(), tickets: free + lots.reduce((n, l) => n + l.left, 0), free, lots, admin: options.admin ?? false }, jobs: [], items: [], seen: [], counter: 0 };
  };
  const claimMs = options.partner?.claimAfterMs ?? 1500;
  const acceptMs = options.partner?.acceptAfterMs ?? 1000;
  const chooseMs = options.partner?.chooseMs ?? 0;
  const trades = new Map<string, FakeTrade>();
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
  // 財布: 期限が切れた・使い切った買った分を落とし、使える枚数を数え直す（サーバーの wallet.ts と同じ決まり）
  const refresh = () => {
    const lots = state.user.lots.filter((l) => l.left > 0 && l.expiresAt > Date.now()).sort((a, b) => a.expiresAt - b.expiresAt);
    const tickets = state.user.free + lots.reduce((n, l) => n + l.left, 0);
    if (tickets !== state.user.tickets || lots.length !== state.user.lots.length) state = { ...state, user: { ...state.user, lots, tickets } };
  };
  const wallet = (free: number, lots: StudioUser['lots']) => {
    state = { ...state, user: { ...state.user, free, lots } };
    refresh();
    notifyUser();
  };
  // 使う: 期限の早い買った分から、足りなければ配った分から
  const spend = (cost: number) => {
    refresh();
    let need = cost;
    const lots = state.user.lots.map((l) => {
      const n = Math.min(l.left, need);
      need -= n;
      return { ...l, left: l.left - n };
    });
    wallet(state.user.free - need, lots);
  };
  // 配った分を足す（できなかった品目の分の戻しは、配った分に戻す。本物は、引いた買った分に戻す）
  const addFree = (n: number) => wallet(state.user.free + n, state.user.lots);

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
        if (!state.user.admin) addFree(1);
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
  const readHandoff = (): { word: string; world: State } | null => {
    try {
      const saved = JSON.parse(localStorage.getItem(HANDOFF_KEY) ?? 'null') as { word?: unknown; world?: unknown } | null;
      const copy = parseState(JSON.stringify(saved?.world ?? null));
      if (saved && typeof saved.word === 'string' && copy) return { word: saved.word, world: copy };
    } catch {
      // 読めなければ、無いものとして扱う
    }
    return null;
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
      } else if (readHandoff()) {
        // 合い言葉の写しがあるのに、置いてある世界が無い = 空のアカウント。写しの世界は、adopt が持ってくる
        adopt({ user: { userCode: newCode(), tickets: 0, free: 0, lots: [], admin: false }, jobs: [], items: [], seen: [], counter: 0 });
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
      adopt({ user: { userCode: newCode(), tickets: 0, free: 0, lots: [], admin: false }, jobs: [], items: [], seen: [], counter: 0 });
      setGoogle(false);
    },
    isGoogle: () => google,
  };
  const account = createAccount(
    async () => createFakeAuthPort(world, { loginFail: options.loginFail, googleTaken: options.googleTaken, stashed: options.stashed }),
    browserAccountEnv((url) => fakeGoTo(url, window, { loginFail: options.loginFail, silentFail: options.silentFail })),
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

  // ---- 交換 ----
  const tradeOld = () => {
    if (options.noTrade || options.oldServer) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
  };
  const tradeRefuse = (tradeRefusal: TradeRefusal, message: string) => new BackendError('refused', message, { tradeRefusal });
  const tradeOf = (id: string): FakeTrade => {
    const trade = trades.get(id);
    if (!trade) throw tradeRefuse('unknown', 'この交換は見つかりません');
    return trade;
  };
  const partnerItem = (dollId: string, categoryId: string): SavedItem => {
    const id = `my:fake-trade-${++state.counter}`;
    return {
      id,
      dollId,
      name: 'にせの ふく',
      categoryId,
      index: FAKE_INDEX,
      createdAt: Date.now(),
      hue: 0,
      order: Date.now(),
      updatedAt: Date.now(),
    };
  };
  // あいての動き（読む・はい・やめる）と、2 人とも「はい」のときの入れ替えを、時刻まで進める
  const advanceTrade = (trade: FakeTrade) => {
    if (trade.status === 'done' || trade.status === 'cancelled') return;
    const now = Date.now();
    const cancelAfter = options.partner?.cancelAfterMs;
    if (cancelAfter !== undefined && now - trade.startedAt >= cancelAfter) {
      Object.assign(trade, { status: 'cancelled', reason: 'cancel' });
      return;
    }
    if (trade.status === 'open' && chooseMs > 0 && now >= trade.joinedAt - chooseMs && now < trade.joinedAt) trade.status = 'claimed';
    if ((trade.status === 'open' || (trade.status === 'claimed' && trade.me === 'a')) && now >= trade.joinedAt) trade.status = 'joined';
    if (trade.status === 'joined' && now >= trade.joinedAt + acceptMs) trade.theirAccepted = true;
    if (trade.status === 'joined' && trade.myAccepted && trade.theirAccepted && trade.mine) {
      // 入れ替え: こちらの服を外し、にせの服を、自分の服として足す
      state.items = [...state.items.filter((i) => i.id !== trade.mine!.id), { ...trade.theirs, createdAt: now, order: now, updatedAt: now }];
      trade.status = 'done';
      trade.receivedId = trade.theirs.id;
      save();
    }
  };
  const tradeItem = async (saved: SavedItem): Promise<TradeItem> => ({
    id: saved.id,
    dollId: saved.dollId,
    name: saved.name,
    categoryId: saved.categoryId,
    hue: saved.hue,
    thumb: await makeImage(colorOf(saved.index)),
  });
  const tradeView = async (trade: FakeTrade): Promise<TradeState> => {
    advanceTrade(trade);
    const showTheirs = trade.me === 'b' || (trade.status !== 'open' && trade.status !== 'claimed'); // 始めた側は、あいてが読むまで、あいての服が見えない
    return {
      id: trade.id,
      status: trade.status,
      me: trade.me,
      ...(trade.mine ? { mine: await tradeItem(trade.mine) } : {}),
      ...(showTheirs ? { theirs: await tradeItem(trade.theirs) } : {}),
      myAccepted: trade.myAccepted,
      theirAccepted: trade.theirAccepted,
      ...(trade.reason ? { reason: trade.reason } : {}),
      ...(trade.receivedId ? { receivedId: trade.receivedId } : {}),
    };
  };

  // ---- 支払い ----
  const packs = (options.shop?.packs ?? '10:300,30:800')
    .split(',')
    .map((part) => /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(part))
    .flatMap((m) => (m ? [{ id: `${m[1]}-${m[2]}`, tickets: Number(m[1]), price: Number(m[2]) }] : []));
  const payOld = () => {
    if (options.oldServer) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
  };
  const payRefuse = (payRefusal: 'login' | 'closed' | 'pack' | 'other', message: string) => new BackendError('refused', message, { payRefusal });
  const purchaseOf = (id: string): FakePurchase => {
    const found = (state.purchases ?? []).find((p) => p.id === id);
    if (!found) throw payRefuse('other', 'この支払いは、あなたのものではありません');
    return found;
  };
  // 払い終わった支払いのチケットを、足す（slow は、払って 40 秒あと）。足した枚数を返す
  const credit = (purchase: FakePurchase): number => {
    if (purchase.status !== 'paid' || purchase.credited || Date.now() < (purchase.paidAt ?? 0) + (options.payResult === 'slow' ? SLOW_MS : 0)) return 0;
    purchase.credited = true;
    wallet(state.user.free, [...state.user.lots, { count: purchase.tickets, left: purchase.tickets, expiresAt: purchase.expiresAt }]);
    save();
    return purchase.tickets;
  };

  const backend: FakeBackend = {
    account,
    payResult: options.payResult ?? 'paid',
    async signIn() {
      online();
      if (options.oldServer) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
      refresh();
      // ようこその枚数（ログインしている利用者に、1 回だけ）
      if (options.welcome && options.welcome > 0 && options.anonymous !== true && !state.welcomed) {
        state = { ...state, welcomed: true };
        addFree(options.welcome);
        save();
        welcomeListeners.forEach((l) => l(options.welcome!));
      }
      return { ...state.user };
    },
    onUser(listener) {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    async startJob({ dollId, theme, target }) {
      online();
      refresh();
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
      if (!state.user.admin) spend(cost);
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
    async offerHandoff() {
      online();
      if (options.noAdopt) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
      // 使っていない合い言葉があれば、同じものを返す（写しは、いまの世界に取り替える）
      const word = readHandoff()?.word ?? newWord();
      try {
        localStorage.setItem(HANDOFF_KEY, JSON.stringify({ word, world: state }));
      } catch {
        throw new BackendError('unknown', '合い言葉を置けませんでした');
      }
      return word;
    },
    async adopt(word): Promise<AdoptAnswer> {
      online();
      if (!google) return { status: 'wait', tickets: 0, items: 0 };
      const handoff = readHandoff();
      if (!handoff || handoff.word !== word) return { status: 'unknown', tickets: 0, items: 0 };
      // つながらない失敗のまね（残りの数は、読み込み直しても続く）
      const left = Number(localStorage.getItem(ADOPT_FAIL_KEY) ?? options.adoptFail ?? 0);
      if (left > 0) {
        try {
          localStorage.setItem(ADOPT_FAIL_KEY, String(left - 1));
        } catch {
          // 数が置けなくても、この 1 回は失敗にする
        }
        throw new BackendError('offline', 'インターネットにつながっていません');
      }
      const have = new Set(state.items.map((i) => i.id));
      const added = handoff.world.items.filter((i) => !have.has(i.id));
      const tickets = handoff.world.user.tickets;
      state = { ...state, items: [...state.items, ...added] };
      try {
        localStorage.removeItem(HANDOFF_KEY);
      } catch {
        // 消せなくても進む
      }
      addFree(tickets);
      save();
      return { status: 'done', tickets, items: added.length };
    },
    async canTrade() {
      online();
      return !(options.noTrade || options.oldServer);
    },
    async tradeOpen(itemId) {
      online();
      tradeOld();
      const mine = { ...itemOf(itemId) };
      const now = Date.now();
      const id = `fake-trade-${++state.counter}`;
      const code = newCode();
      trades.set(id, {
        id,
        code,
        me: 'a',
        status: 'open',
        mine,
        theirs: partnerItem(mine.dollId, mine.categoryId),
        startedAt: now,
        joinedAt: now + claimMs + chooseMs,
        myAccepted: false,
        theirAccepted: false,
      });
      return { tradeId: id, code };
    },
    async tradeCode(tradeId) {
      online();
      tradeOld();
      return tradeOf(tradeId).code;
    },
    async tradeClaim(code) {
      online();
      tradeOld();
      if (code.trim().toUpperCase() !== FAKE_CODE) throw tradeRefuse('unknown', 'この合い言葉の交換は見つかりません');
      if (options.partner?.refuse) throw tradeRefuse(options.partner.refuse, 'この交換には入れません');
      const id = `fake-trade-${++state.counter}`;
      // あいての服は、こちらが服を出すまで、ドールが決まらない（出したとき、こちらと同じにする）
      trades.set(id, {
        id,
        code: FAKE_CODE,
        me: 'b',
        status: 'claimed',
        theirs: partnerItem(state.items[0]?.dollId ?? 'doll', 'トップス'),
        startedAt: Date.now(),
        joinedAt: Infinity,
        myAccepted: false,
        theirAccepted: false,
      });
      return { tradeId: id };
    },
    async tradeJoin(tradeId, itemId) {
      online();
      tradeOld();
      const trade = tradeOf(tradeId);
      advanceTrade(trade);
      if (trade.status !== 'claimed') throw tradeRefuse('busy', 'この交換には、もう服を出せません');
      const mine = { ...itemOf(itemId) };
      Object.assign(trade, { status: 'joined', mine, joinedAt: Date.now() });
      trade.theirs.dollId = mine.dollId;
      trade.theirs.categoryId = mine.categoryId;
    },
    async trade(tradeId) {
      online();
      tradeOld();
      return tradeView(tradeOf(tradeId));
    },
    async tradeAccept(tradeId) {
      online();
      tradeOld();
      const trade = tradeOf(tradeId);
      advanceTrade(trade);
      if (trade.status === 'joined') trade.myAccepted = true;
      else if (trade.status !== 'done') throw tradeRefuse('busy', 'まだ「はい」を押せません');
      advanceTrade(trade);
      return tradeView(trade);
    },
    async tradeCancel(tradeId) {
      online();
      tradeOld();
      const trade = tradeOf(tradeId);
      advanceTrade(trade);
      if (trade.status !== 'done' && trade.status !== 'cancelled') Object.assign(trade, { status: 'cancelled', reason: 'cancel' });
    },
    async canPay() {
      online();
      return !options.oldServer;
    },
    async shop(): Promise<WireShop> {
      online();
      payOld();
      const open = (options.shop?.open ?? true) || state.user.admin;
      return {
        open: open && packs.length > 0,
        packs: open ? packs : [],
        announce: (state.purchases ?? [])
          .filter((p) => {
            credit(p);
            return p.credited && !p.announced;
          })
          .map((p) => ({ session: p.id, tickets: p.tickets })),
      };
    },
    async checkout(packId) {
      online();
      payOld();
      if (options.anonymous) throw payRefuse('login', 'Google でログインすると、チケットを買えます');
      if (!((options.shop?.open ?? true) || state.user.admin) || packs.length === 0) throw payRefuse('closed', 'いまは、チケットを買えません');
      const pack = packs.find((p) => p.id === packId);
      if (!pack) throw payRefuse('pack', 'このパックは、いまは買えません');
      const now = Date.now();
      const id = `fake-pay-${++state.counter}`;
      state.purchases = [...(state.purchases ?? []), { id, tickets: pack.tickets, expiresAt: addMonthsJst(now, 6), status: 'open' }];
      save();
      // 同じアプリの、にせの支払いページ。いまのページの query は残す
      const query = new URLSearchParams(window.location.search);
      query.set('pay', PAY_PARAM);
      query.set('session', id);
      return { session: id, url: `?${query.toString()}`, expiresAt: now + 30 * 60 * 1000 };
    },
    async purchase(session): Promise<WirePurchase> {
      online();
      payOld();
      const found = purchaseOf(session);
      const added = credit(found);
      return { status: found.status === 'open' ? 'open' : found.status === 'cancel' ? 'expired' : found.credited ? 'paid' : 'open', added, tickets: found.tickets };
    },
    async shopAck(session) {
      online();
      payOld();
      const found = purchaseOf(session);
      if (!found.announced) {
        found.announced = true;
        save();
      }
    },
    onWelcome(listener) {
      welcomeListeners.add(listener);
      return () => welcomeListeners.delete(listener);
    },
    fakePay(session, result) {
      const found = (state.purchases ?? []).find((p) => p.id === session);
      if (!found || found.status !== 'open') return;
      Object.assign(found, result === 'paid' ? { status: 'paid', paidAt: Date.now() } : { status: 'cancel' });
      save();
    },
  };
  return backend;
}
