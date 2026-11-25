/**
 * 置き場の本物（Firestore）。形は tools/cloud/store.ts、ふるまいの手本は tools/cloud/memoryStore.ts。
 *
 *   users/{uid}                 利用者（利用者コード・チケットの残り）
 *   users/{uid}/ledger/{自動}   チケットの台帳（増減と理由）
 *   users/{uid}/jobs/{jobId}    生成の仕事（進み具合）
 *   users/{uid}/items/{itemId}  自分の服
 *   userCodes/{利用者コード}    利用者コード → uid（重ならないようにするため）
 *   system/usage-{日付}         その日に作った画像の枚数
 *   handoffs/{合い言葉}         引き継ぎの合い言葉（元の uid・時刻・使った人）
 *   trades/{id}                 交換（双方の uid・服・状態・読み取りの印）
 *
 * アプリからは直接読めない（firestore.rules で全部断る）。ここは、管理者の権限で読み書きする。
 */
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { ADOPTED_MAX, CloudError } from '../../tools/cloud/store.ts';
import type { CloudStore, HandoffClaim, HandoffDoc, ItemDoc, JobDoc, TradeDoc, UserDoc } from '../../tools/cloud/store.ts';

// 文書の名前に使えない形（/、.、..、__x__）を避ける
const docId = (id: string) => encodeURIComponent(id).replace(/\./g, '%2E').replace(/^__/, '%5F%5F');
// 仕事の一覧は、新しいものだけ（古い仕事は消さないので、開くたびに全部は読まない）
const JOBS_MAX = 100;
// チケットの数が壊れている（管理画面で文字にしてしまった、など）ときは、0 枚として扱う
const have = (user: UserDoc) => (typeof user.tickets === 'number' && Number.isFinite(user.tickets) ? user.tickets : 0);

export class FirestoreStore implements CloudStore {
  private readonly db: Firestore;
  constructor(db: Firestore) {
    this.db = db;
  }
  private user(uid: string): DocumentReference {
    return this.db.collection('users').doc(docId(uid));
  }
  private job(uid: string, jobId: string): DocumentReference {
    return this.user(uid).collection('jobs').doc(docId(jobId));
  }
  private trade(id: string): DocumentReference {
    return this.db.collection('trades').doc(docId(id));
  }
  private item(uid: string, itemId: string): DocumentReference {
    return this.user(uid).collection('items').doc(docId(itemId));
  }

  async getUser(uid: string): Promise<UserDoc | null> {
    const snap = await this.user(uid).get();
    return snap.exists ? (snap.data() as UserDoc) : null;
  }
  async createUser(uid: string, makeCode: () => string, now: number): Promise<UserDoc> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (snap.exists) return snap.data() as UserDoc;
      // 取り引きの中では、読むのを先に済ませる（空いている利用者コードを探してから、書く）
      for (let i = 0; i < 20; i++) {
        const userCode = makeCode();
        const codeRef = this.db.collection('userCodes').doc(docId(userCode));
        if ((await tx.get(codeRef)).exists) continue;
        const user: UserDoc = { userCode, tickets: 0, createdAt: now };
        tx.create(ref, user);
        tx.create(codeRef, { uid });
        return user;
      }
      throw new Error('利用者コードを作れませんでした');
    });
  }
  async findUidByCode(userCode: string): Promise<string | null> {
    if (!userCode) return null;
    const snap = await this.db.collection('userCodes').doc(docId(userCode)).get();
    const uid = snap.exists ? (snap.data() as { uid?: unknown }).uid : null;
    return typeof uid === 'string' ? uid : null;
  }
  private async changeTickets(uid: string, delta: number, reason: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      const user = snap.data() as UserDoc;
      const tickets = have(user);
      if (tickets + delta < 0) throw new CloudError('no-tickets', `チケットが足りません（のこり ${tickets} 枚、必要 ${-delta} 枚）`);
      tx.update(ref, { tickets: tickets + delta });
      tx.create(ref.collection('ledger').doc(), { count: delta, reason, at: now });
      return tickets + delta;
    });
  }
  async refundOnce(uid: string, key: string, reason: string, now: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      // 台帳の行の名前を key から決める。もうあれば、戻し済み
      const row = ref.collection('ledger').doc(docId(`refund:${key}`));
      if ((await tx.get(row)).exists) return false;
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      tx.update(ref, { tickets: have(snap.data() as UserDoc) + 1 });
      tx.create(row, { count: 1, reason, at: now });
      return true;
    });
  }
  charge(uid: string, cost: number, reason: string, now: number): Promise<number> {
    return this.changeTickets(uid, -Math.abs(cost), reason, now);
  }
  addTickets(uid: string, count: number, reason: string, now: number): Promise<number> {
    return this.changeTickets(uid, Math.abs(count), reason, now);
  }
  async note(uid: string, count: number, reason: string, now: number): Promise<void> {
    await this.user(uid).collection('ledger').doc().create({ count, reason, at: now });
  }
  async spendImage(day: string, perDay: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('system').doc(`usage-${docId(day)}`);
      const snap = await tx.get(ref);
      const used = snap.exists ? Number((snap.data() as { count?: unknown }).count) || 0 : 0;
      if (used >= perDay) throw new CloudError('limit', '今日は、作れる枚数の上限に達しました。あした、もう一度ためしてください');
      tx.set(ref, { count: used + 1 });
    });
  }
  async createJob(uid: string, job: JobDoc): Promise<void> {
    await this.job(uid, job.id).create(job);
  }
  async chargeAndCreateJob(uid: string, job: JobDoc, cost: number, reason: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      const tickets = have(snap.data() as UserDoc);
      // 取り引きは、確定の返事が届かなかったとき、もう一度呼ばれる。前の回が確定していたら（仕事が、もうある）、二重に引かない
      const jobRef = this.job(uid, job.id);
      if ((await tx.get(jobRef)).exists) return tickets;
      if (tickets < cost) throw new CloudError('no-tickets', `チケットが足りません（のこり ${tickets} 枚、必要 ${cost} 枚）`);
      tx.update(ref, { tickets: tickets - cost });
      tx.create(ref.collection('ledger').doc(), { count: -cost, reason, at: now });
      tx.create(jobRef, job);
      return tickets - cost;
    });
  }
  async getJob(uid: string, jobId: string): Promise<JobDoc | null> {
    const snap = await this.job(uid, jobId).get();
    return snap.exists ? (snap.data() as JobDoc) : null;
  }
  async updateJob(uid: string, jobId: string, change: (job: JobDoc) => JobDoc | null): Promise<JobDoc> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.job(uid, jobId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', 'この仕事は見つかりません');
      const current = snap.data() as JobDoc;
      // change が中身を書き換えても、読んだものが変わらないように、写しを渡す
      const next = change(structuredClone(current));
      if (!next) return current;
      tx.set(ref, next);
      return next;
    });
  }
  async listJobs(uid: string): Promise<JobDoc[]> {
    const snap = await this.user(uid).collection('jobs').orderBy('createdAt', 'desc').limit(JOBS_MAX).get();
    return snap.docs.map((doc) => doc.data() as JobDoc);
  }
  async listOpenJobs(limit: number): Promise<{ uid: string; job: JobDoc }[]> {
    // 全部の利用者の仕事をまたいで探す（索引は firestore.indexes.json）
    const snap = await this.db.collectionGroup('jobs').where('done', '==', false).orderBy('createdAt', 'asc').limit(limit).get();
    return snap.docs.flatMap((doc) => {
      const owner = doc.ref.parent.parent;
      return owner ? [{ uid: decodeURIComponent(owner.id), job: doc.data() as JobDoc }] : [];
    });
  }
  async updateItem(uid: string, itemId: string, change: (item: ItemDoc) => ItemDoc | null): Promise<ItemDoc> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.item(uid, itemId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', 'この服は見つかりません');
      const current = snap.data() as ItemDoc;
      const next = change(structuredClone(current));
      if (!next) return current;
      tx.set(ref, next);
      return next;
    });
  }
  async putItem(uid: string, item: ItemDoc): Promise<void> {
    await this.item(uid, item.id).set(item);
  }
  async getItem(uid: string, itemId: string): Promise<ItemDoc | null> {
    const snap = await this.item(uid, itemId).get();
    return snap.exists ? (snap.data() as ItemDoc) : null;
  }
  async listItems(uid: string): Promise<ItemDoc[]> {
    const snap = await this.user(uid).collection('items').orderBy('createdAt', 'asc').get(); // 全部（途中で切ると、アプリが「消えた」とみなして端末の控えを消してしまう）
    return snap.docs.map((doc) => doc.data() as ItemDoc);
  }
  async deleteItem(uid: string, itemId: string): Promise<void> {
    await this.item(uid, itemId).delete();
  }

  // ── 引き継ぎ。どれも、取り引きの中で読み直すので、確定の返事が届かずにもう一度呼ばれても、2 回めは何も変えない ──
  private handoff(word: string): DocumentReference {
    return this.db.collection('handoffs').doc(docId(word));
  }
  async markUser(uid: string, change: { movedTo?: string; named?: true }): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      const user = snap.data() as UserDoc;
      const patch: Partial<UserDoc> = {};
      if (change.movedTo !== undefined && user.movedTo !== change.movedTo) patch.movedTo = change.movedTo;
      if (change.named && user.named !== true) patch.named = true;
      if (Object.keys(patch).length > 0) tx.update(ref, patch);
    });
  }
  async addAdopted(uid: string, from: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      const list = (snap.data() as UserDoc).adopted;
      const adopted = Array.isArray(list) ? list.filter((u): u is string => typeof u === 'string') : [];
      if (adopted.at(-1) === from) return;
      tx.update(ref, { adopted: [...adopted.filter((u) => u !== from), from].slice(-ADOPTED_MAX) });
    });
  }
  async offerHandoff(uid: string, makeWord: () => string, now: number): Promise<string> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      const current = (snap.data() as UserDoc).handoff;
      if (typeof current === 'string' && current) {
        const old = await tx.get(this.handoff(current));
        const data = old.data() as HandoffDoc | undefined;
        if (data && data.uid === uid && !data.usedBy) return current;
      }
      // 合い言葉は 32 バイトの乱数なので、重なりは考えない（重なったら create が落ちて、取り引きごと失敗する = 上書きはしない）
      const word = makeWord();
      const handoff: HandoffDoc = { uid, createdAt: now };
      tx.create(this.handoff(word), handoff);
      tx.update(ref, { handoff: word });
      return word;
    });
  }
  async getHandoff(word: string): Promise<HandoffDoc | null> {
    const snap = await this.handoff(word).get();
    return snap.exists ? (snap.data() as HandoffDoc) : null;
  }
  async claimHandoff(word: string, by: string): Promise<HandoffClaim> {
    return this.db.runTransaction(async (tx): Promise<HandoffClaim> => {
      const ref = this.handoff(word);
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 'unknown' };
      const handoff = snap.data() as HandoffDoc;
      if (handoff.usedBy && handoff.usedBy !== by) return { status: 'used' };
      if (!handoff.usedBy) tx.update(ref, { usedBy: by });
      return { status: 'ok', uid: handoff.uid };
    });
  }
  async moveTickets(from: string, to: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const fromRef = this.user(from);
      const toRef = this.user(to);
      const [source, target] = [await tx.get(fromRef), await tx.get(toRef)];
      if (!target.exists) throw new CloudError('refused', '利用者が見つかりません');
      if (!source.exists || (source.data() as UserDoc).named) return 0;
      // ここで読み直した残り（前の回が確定していれば 0）
      const count = have(source.data() as UserDoc);
      if (count <= 0) return 0;
      tx.update(fromRef, { tickets: 0 });
      tx.update(toRef, { tickets: have(target.data() as UserDoc) + count });
      tx.create(fromRef.collection('ledger').doc(), { count: -count, reason: `adopt:out:${to}`, at: now });
      tx.create(toRef.collection('ledger').doc(), { count, reason: `adopt:in:${from}`, at: now });
      return count;
    });
  }
  async moveItem(from: string, to: string, itemId: string): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const fromRef = this.item(from, itemId);
      const toRef = this.item(to, itemId);
      const [source, target] = [await tx.get(fromRef), await tx.get(toRef)];
      if (!source.exists) return false;
      if (!target.exists) tx.set(toRef, source.data() as ItemDoc);
      tx.delete(fromRef);
      return true;
    });
  }

  async putTrade(trade: TradeDoc): Promise<void> {
    await this.trade(trade.id).set(trade);
  }
  async getTrade(id: string): Promise<TradeDoc | null> {
    const snap = await this.trade(id).get();
    return snap.exists ? (snap.data() as TradeDoc) : null;
  }
  async findTradeByCode(code: string): Promise<TradeDoc | null> {
    const snap = await this.db.collection('trades').where('code', '==', code).limit(1).get();
    return snap.empty ? null : (snap.docs[0].data() as TradeDoc);
  }
  async updateTrade(id: string, change: (trade: TradeDoc) => TradeDoc | null): Promise<TradeDoc> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.trade(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', 'この交換は見つかりません');
      const current = snap.data() as TradeDoc;
      const next = change(structuredClone(current));
      if (!next) return current;
      tx.set(ref, next);
      return next;
    });
  }
  async swapTrade(id: string, now: number): Promise<TradeDoc> {
    return this.db.runTransaction(async (tx) => {
      const tradeRef = this.trade(id);
      const tradeSnap = await tx.get(tradeRef);
      if (!tradeSnap.exists) throw new CloudError('refused', 'この交換は見つかりません');
      const trade = tradeSnap.data() as TradeDoc;
      const { a, b } = trade;
      if (trade.status !== 'joined' || !b || !a.accepted || !b.accepted || !a.itemId || !b.itemId) return trade;
      // 読むのを先に全部済ませる（2 点の服と、受け取る側の同じ ID）
      const mineRef = this.item(a.uid, a.itemId);
      const theirsRef = this.item(b.uid, b.itemId);
      const toBRef = this.item(b.uid, a.itemId);
      const toARef = this.item(a.uid, b.itemId);
      const [mine, theirs, toB, toA] = [await tx.get(mineRef), await tx.get(theirsRef), await tx.get(toBRef), await tx.get(toARef)];
      const end = (reason: 'gone' | 'conflict'): TradeDoc => {
        const ended: TradeDoc = { ...trade, status: 'cancelled', reason, endedAt: now };
        tx.set(tradeRef, ended);
        return ended;
      };
      if (!mine.exists || !theirs.exists) return end('gone');
      if (toB.exists || toA.exists) return end('conflict');
      const moved = (doc: ItemDoc): ItemDoc => {
        const next: ItemDoc = { ...doc, order: now, updatedAt: now };
        delete next.set;
        return next;
      };
      tx.delete(mineRef);
      tx.delete(theirsRef);
      tx.set(toBRef, moved(mine.data() as ItemDoc));
      tx.set(toARef, moved(theirs.data() as ItemDoc));
      const done: TradeDoc = { ...trade, status: 'done', endedAt: now };
      tx.set(tradeRef, done);
      return done;
    });
  }
  async setUserTrade(uid: string, tradeId: string | null): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
      tx.update(ref, { trade: tradeId ?? FieldValue.delete() });
    });
  }
}
