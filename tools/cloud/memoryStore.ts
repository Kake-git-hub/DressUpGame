/**
 * メモリの中の置き場（テストと、手元の確認用）。本物（Firestore・Storage）と同じ形。
 */
import { CloudError } from './store.ts';
import type { CloudFiles, CloudStore, ItemDoc, JobDoc, UserDoc } from './store.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// チケットの数が壊れている（数でない）ときは、0 枚として扱う
const have = (user: UserDoc) => (typeof user.tickets === 'number' && Number.isFinite(user.tickets) ? user.tickets : 0);

export class MemoryStore implements CloudStore {
  readonly users = new Map<string, UserDoc>();
  readonly jobs = new Map<string, JobDoc>(); // `${uid}/${jobId}`
  readonly items = new Map<string, ItemDoc>(); // `${uid}/${itemId}`
  readonly ledger: { uid: string; count: number; reason: string; at: number }[] = [];
  readonly usage = new Map<string, number>();
  readonly refunds = new Set<string>();

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
  async charge(uid: string, cost: number, reason: string, now: number): Promise<number> {
    const user = this.users.get(uid);
    if (!user) throw new CloudError('refused', '利用者が見つかりません');
    if (have(user) < cost) throw new CloudError('no-tickets', `チケットが足りません（のこり ${have(user)} 枚、必要 ${cost} 枚）`);
    user.tickets = have(user) - cost;
    this.ledger.push({ uid, count: -cost, reason, at: now });
    return user.tickets;
  }
  async addTickets(uid: string, count: number, reason: string, now: number): Promise<number> {
    const user = this.users.get(uid);
    if (!user) throw new CloudError('refused', '利用者が見つかりません');
    user.tickets = have(user) + count;
    this.ledger.push({ uid, count, reason, at: now });
    return user.tickets;
  }
  async refundOnce(uid: string, key: string, reason: string, now: number): Promise<boolean> {
    if (this.refunds.has(`${uid}/${key}`)) return false;
    this.refunds.add(`${uid}/${key}`);
    await this.addTickets(uid, 1, reason, now);
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
    const user = this.users.get(uid);
    if (!user) throw new CloudError('refused', '利用者が見つかりません');
    // やり直し: 前の回で、もう引いて、作ってある
    if (this.jobs.has(`${uid}/${job.id}`)) return have(user);
    if (have(user) < cost) throw new CloudError('no-tickets', `チケットが足りません（のこり ${have(user)} 枚、必要 ${cost} 枚）`);
    user.tickets = have(user) - cost;
    this.ledger.push({ uid, count: -cost, reason, at: now });
    this.jobs.set(`${uid}/${job.id}`, clone(job));
    return user.tickets;
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
  async deleteItem(uid: string, itemId: string): Promise<void> {
    this.items.delete(`${uid}/${itemId}`);
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
