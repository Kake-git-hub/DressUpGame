/**
 * メモリの中の置き場（テストと、手元の確認用）。本物（Firestore・Storage）と同じ形。
 */
import { ADOPTED_MAX, CloudError } from './store.ts';
import type { CloudFiles, CloudStore, Draw, HandoffClaim, HandoffDoc, ItemDoc, JobDoc, Lot, PurchaseDoc, TradeDoc, UserDoc } from './store.ts';
import { addFree, addLot, draw, expire, merge, readWallet, reclaim, refundTicket, usable, walletFields } from './wallet.ts';
import type { Wallet } from './wallet.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// 台帳の行（draws = 引いた所、to = 戻した所）
interface LedgerRow {
  uid: string;
  count: number;
  reason: string;
  at: number;
}

export class MemoryStore implements CloudStore {
  readonly users = new Map<string, UserDoc>();
  readonly jobs = new Map<string, JobDoc>(); // `${uid}/${jobId}`
  readonly items = new Map<string, ItemDoc>(); // `${uid}/${itemId}`
  readonly ledger: (LedgerRow & { draws?: Draw[]; to?: string })[] = [];
  readonly usage = new Map<string, number>();
  readonly refunds = new Set<string>();
  readonly handoffs = new Map<string, HandoffDoc>();
  readonly trades = new Map<string, TradeDoc>();
  readonly purchases = new Map<string, PurchaseDoc>();

  async getUser(uid: string): Promise<UserDoc | null> {
    const user = this.users.get(uid);
    return user ? clone(user) : null;
  }
  async createUser(uid: string, makeCode: () => string, now: number): Promise<UserDoc> {
    const existing = this.users.get(uid);
    if (existing) return clone(existing);
    let userCode = makeCode();
    while ([...this.users.values()].some((u) => u.userCode === userCode)) userCode = makeCode();
    const user: UserDoc = { userCode, tickets: 0, createdAt: now };
    this.users.set(uid, user);
    return clone(user);
  }
  async findUidByCode(userCode: string): Promise<string | null> {
    for (const [uid, user] of this.users) if (user.userCode === userCode) return uid;
    return null;
  }
  // 利用者の財布を読み、期限の切れた分を落とす（落とした分は、台帳に残す）
  // （台帳に書くのは、save で保存するときだけ）
  private open(uid: string, now: number): { uid: string; user: UserDoc; wallet: Wallet; expired: { lot: string; n: number }[] } {
    const user = this.users.get(uid);
    if (!user) throw new CloudError('refused', '利用者が見つかりません');
    const { wallet, expired } = expire(readWallet(user, now), now);
    return { uid, user, wallet, expired };
  }
  private save(opened: { uid: string; user: UserDoc; expired: { lot: string; n: number }[] }, wallet: Wallet, now: number): number {
    const { uid, user, expired } = opened;
    for (const e of expired) this.ledger.push({ uid, count: -e.n, reason: `expire:${e.lot}`, at: now });
    Object.assign(user, walletFields(wallet, now));
    return user.tickets;
  }
  private lack(wallet: Wallet, cost: number, now: number): CloudError {
    return new CloudError('no-tickets', `チケットが足りません（のこり ${usable(wallet, now)} 枚、必要 ${cost} 枚）`);
  }
  async charge(uid: string, cost: number, reason: string, now: number): Promise<number> {
    const opened = this.open(uid, now);
    const { wallet } = opened;
    const drawn = draw(wallet, cost, now);
    if (!drawn) throw this.lack(wallet, cost, now);
    this.ledger.push({ uid, count: -cost, reason, at: now, draws: drawn.draws });
    return this.save(opened, drawn.wallet, now);
  }
  async addTickets(uid: string, count: number, reason: string, now: number): Promise<number> {
    const opened = this.open(uid, now);
    const { wallet } = opened;
    this.ledger.push({ uid, count, reason, at: now });
    return this.save(opened, { free: wallet.free + count, lots: wallet.lots }, now);
  }
  async getWallet(uid: string, now: number): Promise<{ free: number; lots: Lot[] }> {
    const { wallet } = expire(readWallet(this.mustUser(uid), now), now);
    return clone(wallet);
  }
  async refundOnce(uid: string, key: string, index: number, draws: Draw[] | undefined, reason: string, now: number): Promise<boolean> {
    if (this.refunds.has(`${uid}/${key}`)) return false;
    const opened = this.open(uid, now);
    const { wallet } = opened;
    this.refunds.add(`${uid}/${key}`);
    const back = refundTicket(wallet, draws, index, now);
    const to = back.lots.find((l, i) => l.left !== wallet.lots[i].left)?.id ?? 'free';
    this.ledger.push({ uid, count: 1, reason, at: now, to });
    this.save(opened, back, now);
    return true;
  }
  async note(uid: string, count: number, reason: string, now: number): Promise<void> {
    this.ledger.push({ uid, count, reason, at: now });
  }
  async spendImage(day: string, perDay: number): Promise<void> {
    const used = this.usage.get(day) ?? 0;
    if (used >= perDay) throw new CloudError('limit', '今日は、作れる枚数の上限に達しました。あした、もう一度ためしてください');
    this.usage.set(day, used + 1);
  }
  async createJob(uid: string, job: JobDoc): Promise<void> {
    this.jobs.set(`${uid}/${job.id}`, clone(job));
  }
  async chargeAndCreateJob(uid: string, job: JobDoc, cost: number, reason: string, now: number): Promise<number> {
    // 間に待ちを入れない（引くのと作るのが、片方だけにならない）
    const opened = this.open(uid, now);
    const { wallet } = opened;
    // やり直し: 前の回で、もう引いて、作ってある
    if (this.jobs.has(`${uid}/${job.id}`)) return usable(wallet, now);
    const drawn = draw(wallet, cost, now);
    if (!drawn) throw this.lack(wallet, cost, now);
    this.ledger.push({ uid, count: -cost, reason, at: now, draws: drawn.draws });
    this.jobs.set(`${uid}/${job.id}`, clone({ ...job, draws: drawn.draws }));
    return this.save(opened, drawn.wallet, now);
  }
  async getJob(uid: string, jobId: string): Promise<JobDoc | null> {
    const job = this.jobs.get(`${uid}/${jobId}`);
    return job ? clone(job) : null;
  }
  // 本物（Firestore の取り引き）と同じく、読んでから書くまでの間に割り込まれうる。割り込まれたら、やり直す（change は、もう一度呼ばれる）
  async updateJob(uid: string, jobId: string, change: (job: JobDoc) => JobDoc | null): Promise<JobDoc> {
    const key = `${uid}/${jobId}`;
    for (;;) {
      const current = this.jobs.get(key);
      if (!current) throw new CloudError('refused', 'この仕事は見つかりません');
      const before = JSON.stringify(current);
      const next = change(clone(current));
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (JSON.stringify(this.jobs.get(key)) !== before) continue;
      if (next) this.jobs.set(key, clone(next));
      return clone(next ?? current);
    }
  }
  async listJobs(uid: string): Promise<JobDoc[]> {
    return [...this.jobs.entries()]
      .filter(([key]) => key.startsWith(`${uid}/`))
      .map(([, job]) => clone(job))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async listOpenJobs(limit: number): Promise<{ uid: string; job: JobDoc }[]> {
    return [...this.jobs.entries()]
      .filter(([, job]) => !job.done)
      .map(([key, job]) => ({ uid: key.slice(0, key.indexOf('/')), job: clone(job) }))
      .sort((a, b) => a.job.createdAt - b.job.createdAt)
      .slice(0, limit);
  }
  // updateJob と同じく、割り込まれたら、やり直す
  async updateItem(uid: string, itemId: string, change: (item: ItemDoc) => ItemDoc | null): Promise<ItemDoc> {
    const key = `${uid}/${itemId}`;
    for (;;) {
      const current = this.items.get(key);
      if (!current) throw new CloudError('refused', 'この服は見つかりません');
      const before = JSON.stringify(current);
      const next = change(clone(current));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const now = this.items.get(key);
      if (!now) throw new CloudError('refused', 'この服は見つかりません');
      if (JSON.stringify(now) !== before) continue;
      if (next) this.items.set(key, clone(next));
      return clone(next ?? current);
    }
  }
  async putItem(uid: string, item: ItemDoc): Promise<void> {
    this.items.set(`${uid}/${item.id}`, clone(item));
  }
  async getItem(uid: string, itemId: string): Promise<ItemDoc | null> {
    const item = this.items.get(`${uid}/${itemId}`);
    return item ? clone(item) : null;
  }
  async listItems(uid: string): Promise<ItemDoc[]> {
    return [...this.items.entries()]
      .filter(([key]) => key.startsWith(`${uid}/`))
      .map(([, item]) => clone(item))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async deleteItem(uid: string, itemId: string): Promise<boolean> {
    return this.items.delete(`${uid}/${itemId}`);
  }
  // 引き継ぎの操作は、どれも、間に待ちを入れない（読んで書くまでが、割り込まれない = 本物の 1 つの取り引き）
  private mustUser(uid: string): UserDoc {
    const user = this.users.get(uid);
    if (!user) throw new CloudError('refused', '利用者が見つかりません');
    return user;
  }
  async markUser(uid: string, change: { movedTo?: string; named?: true }): Promise<void> {
    const user = this.mustUser(uid);
    if (change.movedTo !== undefined && user.movedTo !== change.movedTo) user.movedTo = change.movedTo;
    if (change.named && user.named !== true) user.named = true;
  }
  async addAdopted(uid: string, from: string): Promise<void> {
    const user = this.mustUser(uid);
    const list = user.adopted ?? [];
    if (list.at(-1) === from) return;
    user.adopted = [...list.filter((u) => u !== from), from].slice(-ADOPTED_MAX);
  }
  async offerHandoff(uid: string, makeWord: () => string, now: number): Promise<string> {
    const user = this.mustUser(uid);
    const current = user.handoff ? this.handoffs.get(user.handoff) : undefined;
    if (user.handoff && current && current.uid === uid && !current.usedBy) return user.handoff;
    let word = makeWord();
    while (this.handoffs.has(word)) word = makeWord();
    this.handoffs.set(word, { uid, createdAt: now });
    user.handoff = word;
    return word;
  }
  async getHandoff(word: string): Promise<HandoffDoc | null> {
    const handoff = this.handoffs.get(word);
    return handoff ? clone(handoff) : null;
  }
  async claimHandoff(word: string, by: string): Promise<HandoffClaim> {
    const handoff = this.handoffs.get(word);
    if (!handoff) return { status: 'unknown' };
    if (handoff.usedBy && handoff.usedBy !== by) return { status: 'used' };
    if (!handoff.usedBy) handoff.usedBy = by;
    return { status: 'ok', uid: handoff.uid };
  }
  async moveTickets(from: string, to: string, now: number): Promise<number> {
    const target = this.open(to, now);
    const source = this.users.get(from);
    if (!source || source.named) return 0;
    const { wallet: moving } = expire(readWallet(source, now), now);
    const count = usable(moving, now);
    if (count <= 0) return 0;
    this.save({ uid: from, user: source, expired: [] }, { free: 0, lots: [] }, now);
    // 買った分は、期限も一緒に移る
    this.save(target, merge(target.wallet, moving), now);
    this.ledger.push({ uid: from, count: -count, reason: `adopt:out:${to}`, at: now });
    this.ledger.push({ uid: to, count, reason: `adopt:in:${from}`, at: now });
    return count;
  }
  async moveItem(from: string, to: string, itemId: string): Promise<boolean> {
    const item = this.items.get(`${from}/${itemId}`);
    if (!item) return false;
    if (!this.items.has(`${to}/${itemId}`)) this.items.set(`${to}/${itemId}`, clone(item));
    this.items.delete(`${from}/${itemId}`);
    return true;
  }

  // 交換
  async putTrade(trade: TradeDoc): Promise<void> {
    this.trades.set(trade.id, clone(trade));
  }
  async getTrade(id: string): Promise<TradeDoc | null> {
    const trade = this.trades.get(id);
    return trade ? clone(trade) : null;
  }
  async findTradeByCode(code: string): Promise<TradeDoc | null> {
    for (const trade of this.trades.values()) if (trade.code === code) return clone(trade);
    return null;
  }
  // updateJob と同じく、割り込まれたら、やり直す
  async updateTrade(id: string, change: (trade: TradeDoc) => TradeDoc | null): Promise<TradeDoc> {
    for (;;) {
      const current = this.trades.get(id);
      if (!current) throw new CloudError('refused', 'この交換は見つかりません');
      const before = JSON.stringify(current);
      const next = change(clone(current));
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (JSON.stringify(this.trades.get(id)) !== before) continue;
      if (next) this.trades.set(id, clone(next));
      return clone(next ?? current);
    }
  }
  // 間に待ちを入れない（読んで書くまでが、割り込まれない = 本物の 1 つの取り引き）
  async swapTrade(id: string, now: number): Promise<TradeDoc> {
    const trade = this.trades.get(id);
    if (!trade) throw new CloudError('refused', 'この交換は見つかりません');
    const { a, b } = trade;
    if (trade.status !== 'joined' || !b || !a.accepted || !b.accepted || !a.itemId || !b.itemId) return clone(trade);
    const end = (reason: 'gone' | 'conflict'): TradeDoc => {
      trade.status = 'cancelled';
      trade.reason = reason;
      trade.endedAt = now;
      return clone(trade);
    };
    const mine = this.items.get(`${a.uid}/${a.itemId}`);
    const theirs = this.items.get(`${b.uid}/${b.itemId}`);
    if (!mine || !theirs) return end('gone');
    if (this.items.has(`${b.uid}/${a.itemId}`) || this.items.has(`${a.uid}/${b.itemId}`)) return end('conflict');
    this.items.delete(`${a.uid}/${a.itemId}`);
    this.items.delete(`${b.uid}/${b.itemId}`);
    for (const [owner, doc] of [[b.uid, mine], [a.uid, theirs]] as const) {
      const moved: ItemDoc = { ...clone(doc), order: now, updatedAt: now };
      delete moved.set;
      this.items.set(`${owner}/${moved.id}`, moved);
    }
    trade.status = 'done';
    trade.endedAt = now;
    return clone(trade);
  }
  async countTrade(uid: string, day: string, perDay: number): Promise<void> {
    const key = `trade:${day}:${uid}`;
    const used = this.usage.get(key) ?? 0;
    if (used >= perDay) throw new CloudError('limit', '今日は、こうかんできる回数の上限に達しました。あした、もう一度ためしてください');
    this.usage.set(key, used + 1);
  }
  async setUserTrade(uid: string, tradeId: string | null): Promise<void> {
    const user = this.mustUser(uid);
    if (tradeId === null) delete user.trade;
    else user.trade = tradeId;
  }

  // 支払い（どれも、間に待ちを入れない = 本物の 1 つの取り引き）
  async putPurchase(p: PurchaseDoc): Promise<void> {
    this.purchases.set(p.id, clone(p));
  }
  async getPurchase(id: string): Promise<PurchaseDoc | null> {
    const p = this.purchases.get(id);
    return p ? clone(p) : null;
  }
  async fulfillPurchase(id: string, paidAt: number, now: number): Promise<{ added: number; purchase: PurchaseDoc } | null> {
    const p = this.purchases.get(id);
    if (!p) return null;
    if (p.status === 'paid') return { added: 0, purchase: clone(p) };
    const opened = this.open(p.uid, now);
    const lot: Lot = { id, count: p.tickets, left: p.tickets, boughtAt: paidAt, expiresAt: p.expiresAt };
    this.ledger.push({ uid: p.uid, count: p.tickets, reason: `buy:${id}`, at: now });
    this.save(opened, addLot(opened.wallet, lot), now);
    p.status = 'paid';
    p.paidAt = paidAt;
    return { added: p.tickets, purchase: clone(p) };
  }
  async expirePurchase(id: string): Promise<void> {
    const p = this.purchases.get(id);
    if (p && p.status === 'open') p.status = 'expired';
  }
  async reclaimPurchase(id: string, target: number, now: number): Promise<number> {
    const p = this.purchases.get(id);
    if (!p || p.status !== 'paid') return 0;
    const before = p.reclaimed ?? 0;
    if (!(target > before)) return 0;
    const opened = this.open(p.uid, now);
    const { wallet, taken } = reclaim(opened.wallet, id, target - before);
    if (taken > 0) this.ledger.push({ uid: p.uid, count: -taken, reason: `refund-paid:${id}`, at: now });
    this.save(opened, wallet, now);
    p.reclaimed = target;
    return taken;
  }
  async listUnannounced(uid: string): Promise<PurchaseDoc[]> {
    return [...this.purchases.values()]
      .filter((p) => p.uid === uid && p.status === 'paid' && !p.announced)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }
  async markAnnounced(id: string): Promise<void> {
    const p = this.purchases.get(id);
    if (p) p.announced = true;
  }
  async countCheckout(uid: string, day: string, perDay: number): Promise<void> {
    const key = `checkout:${day}:${uid}`;
    const used = this.usage.get(key) ?? 0;
    if (used >= perDay) throw new CloudError('limit', '今日は、お支払いを始められる回数の上限に達しました。あした、もう一度ためしてください');
    this.usage.set(key, used + 1);
  }
  async markWelcome(uid: string, n: number, now: number): Promise<number> {
    const opened = this.open(uid, now);
    if (opened.user.welcomed) return 0;
    this.ledger.push({ uid, count: n, reason: 'welcome', at: now });
    this.save(opened, addFree(opened.wallet, n), now);
    opened.user.welcomed = true;
    return n;
  }
}

export class MemoryFiles implements CloudFiles {
  readonly files = new Map<string, { data: Buffer; contentType: string }>();
  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    this.files.set(path, { data, contentType });
  }
  async get(path: string): Promise<Buffer | null> {
    return this.files.get(path)?.data ?? null;
  }
  async removeAll(prefix: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) this.files.delete(key);
  }
}
