/**
 * 置き場の本物（Firestore）。形は tools/cloud/store.ts、ふるまいの手本は tools/cloud/memoryStore.ts。
 *
 *   users/{uid}                 利用者（利用者コード・チケットの残り）
 *   users/{uid}/ledger/{自動}   チケットの台帳（増減と理由）
 *   users/{uid}/jobs/{jobId}    生成の仕事（進み具合）
 *   users/{uid}/items/{itemId}  自分の服
 *   userCodes/{利用者コード}    利用者コード → uid（重ならないようにするため）
 *   system/usage-{日付}         その日に作った画像の枚数
 *   system/trade-{日付}-{uid}   その人がその日に始めた交換の回数
 *   handoffs/{合い言葉}         引き継ぎの合い言葉（元の uid・時刻・使った人）
 *   trades/{id}                 交換（双方の uid・服・状態・読み取りの印）
 *   purchases/{session}         支払い（Checkout Session の ID。買った人・枚数・状態）
 *   checkouts/{uid}_{日付}      その人がその日に作った支払いページの回数
 *
 * アプリからは直接読めない（firestore.rules で全部断る）。ここは、管理者の権限で読み書きする。
 */
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { ADOPTED_MAX, CloudError } from '../../tools/cloud/store.ts';
import type { CloudStore, Draw, HandoffClaim, HandoffDoc, ItemDoc, JobDoc, Lot, PurchaseDoc, TradeDoc, UserDoc } from '../../tools/cloud/store.ts';
import { addFree, addLot, draw, expire, merge, readWallet, reclaim, refundTicket, usable, walletFields } from '../../tools/cloud/wallet.ts';
import type { Wallet } from '../../tools/cloud/wallet.ts';

// 文書の名前に使えない形（/、.、..、__x__）を避ける
const docId = (id: string) => encodeURIComponent(id).replace(/\./g, '%2E').replace(/^__/, '%5F%5F');
// 仕事の一覧は、新しいものだけ（古い仕事は消さないので、開くたびに全部は読まない）
const JOBS_MAX = 100;

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
  private purchase(id: string): DocumentReference {
    return this.db.collection('purchases').doc(docId(id));
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
  // 取り引きの中で、利用者の財布を読み、期限の切れた分を落とす（落とした分は、台帳に残す）。
  // 書くのは、読んだあと（tx は、読むのを先に済ませる）
  private async open(tx: Transaction, uid: string, now: number): Promise<{ ref: DocumentReference; wallet: Wallet; expired: { lot: string; n: number }[] }> {
    const ref = this.user(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
    const { wallet, expired } = expire(readWallet(snap.data() as UserDoc, now), now);
    return { ref, wallet, expired };
  }
  private write(tx: Transaction, opened: { ref: DocumentReference; expired: { lot: string; n: number }[] }, wallet: Wallet, now: number): number {
    const fields = walletFields(wallet, now);
    tx.update(opened.ref, fields);
    for (const e of opened.expired) tx.create(opened.ref.collection('ledger').doc(), { count: -e.n, reason: `expire:${e.lot}`, at: now });
    return fields.tickets;
  }
  private lack(wallet: Wallet, cost: number, now: number): CloudError {
    return new CloudError('no-tickets', `チケットが足りません（のこり ${usable(wallet, now)} 枚、必要 ${cost} 枚）`);
  }
  async charge(uid: string, cost: number, reason: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const opened = await this.open(tx, uid, now);
      const drawn = draw(opened.wallet, Math.abs(cost), now);
      if (!drawn) throw this.lack(opened.wallet, Math.abs(cost), now);
      tx.create(opened.ref.collection('ledger').doc(), { count: -Math.abs(cost), reason, at: now, draws: drawn.draws });
      return this.write(tx, opened, drawn.wallet, now);
    });
  }
  async addTickets(uid: string, count: number, reason: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const opened = await this.open(tx, uid, now);
      const n = Math.abs(count);
      tx.create(opened.ref.collection('ledger').doc(), { count: n, reason, at: now });
      return this.write(tx, opened, { free: opened.wallet.free + n, lots: opened.wallet.lots }, now);
    });
  }
  async getWallet(uid: string, now: number): Promise<{ free: number; lots: Lot[] }> {
    const snap = await this.user(uid).get();
    if (!snap.exists) throw new CloudError('refused', '利用者が見つかりません');
    return expire(readWallet(snap.data() as UserDoc, now), now).wallet;
  }
  async refundOnce(uid: string, key: string, index: number, draws: Draw[] | undefined, reason: string, now: number): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.user(uid);
      // 台帳の行の名前を key から決める。もうあれば、戻し済み
      const row = ref.collection('ledger').doc(docId(`refund:${key}`));
      if ((await tx.get(row)).exists) return false;
      const opened = await this.open(tx, uid, now);
      const back = refundTicket(opened.wallet, draws, index, now);
      const to = back.lots.find((l, i) => l.left !== opened.wallet.lots[i].left)?.id ?? 'free';
      tx.create(row, { count: 1, reason, at: now, to });
      this.write(tx, opened, back, now);
      return true;
    });
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
  async countTrade(uid: string, day: string, perDay: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('system').doc(`trade-${docId(day)}-${docId(uid)}`);
      const snap = await tx.get(ref);
      const used = snap.exists ? Number((snap.data() as { count?: unknown }).count) || 0 : 0;
      if (used >= perDay) throw new CloudError('limit', '今日は、こうかんできる回数の上限に達しました。あした、もう一度ためしてください');
      tx.set(ref, { count: used + 1 });
    });
  }
  async createJob(uid: string, job: JobDoc): Promise<void> {
    await this.job(uid, job.id).create(job);
  }
  async chargeAndCreateJob(uid: string, job: JobDoc, cost: number, reason: string, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const opened = await this.open(tx, uid, now);
      // 取り引きは、確定の返事が届かなかったとき、もう一度呼ばれる。前の回が確定していたら（仕事が、もうある）、二重に引かない
      const jobRef = this.job(uid, job.id);
      if ((await tx.get(jobRef)).exists) return usable(opened.wallet, now);
      const drawn = draw(opened.wallet, cost, now);
      if (!drawn) throw this.lack(opened.wallet, cost, now);
      tx.create(opened.ref.collection('ledger').doc(), { count: -cost, reason, at: now, draws: drawn.draws });
      tx.create(jobRef, { ...job, draws: drawn.draws });
      return this.write(tx, opened, drawn.wallet, now);
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
  async deleteItem(uid: string, itemId: string): Promise<boolean> {
    try {
      await this.item(uid, itemId).delete({ exists: true }); // 無ければ NOT_FOUND（5）
      return true;
    } catch (e) {
      if ((e as { code?: unknown }).code === 5) return false;
      throw e;
    }
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
      const [source, target] = [await tx.get(fromRef), await this.open(tx, to, now)];
      if (!source.exists || (source.data() as UserDoc).named) return 0;
      // ここで読み直した財布（前の回が確定していれば 0）
      const { wallet: moving } = expire(readWallet(source.data() as UserDoc, now), now);
      const count = usable(moving, now);
      if (count <= 0) return 0;
      tx.update(fromRef, walletFields({ free: 0, lots: [] }, now));
      // 買った分は、期限も一緒に移る
      this.write(tx, target, merge(target.wallet, moving), now);
      tx.create(fromRef.collection('ledger').doc(), { count: -count, reason: `adopt:out:${to}`, at: now });
      tx.create(target.ref.collection('ledger').doc(), { count, reason: `adopt:in:${from}`, at: now });
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

  // 支払い
  async putPurchase(p: PurchaseDoc): Promise<void> {
    await this.purchase(p.id).set(p);
  }
  async getPurchase(id: string): Promise<PurchaseDoc | null> {
    const snap = await this.purchase(id).get();
    return snap.exists ? (snap.data() as PurchaseDoc) : null;
  }
  async fulfillPurchase(id: string, paidAt: number, now: number): Promise<{ added: number; purchase: PurchaseDoc } | null> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.purchase(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const p = snap.data() as PurchaseDoc;
      if (p.status === 'paid') return { added: 0, purchase: p };
      const opened = await this.open(tx, p.uid, now);
      const lot: Lot = { id, count: p.tickets, left: p.tickets, boughtAt: paidAt, expiresAt: p.expiresAt };
      // 台帳の行の名前を支払いから決める（取り引きのやり直しでも、2 行にならない）
      tx.create(opened.ref.collection('ledger').doc(docId(`buy:${id}`)), { count: p.tickets, reason: `buy:${id}`, at: now });
      this.write(tx, opened, addLot(opened.wallet, lot), now);
      const purchase: PurchaseDoc = { ...p, status: 'paid', paidAt };
      tx.update(ref, { status: 'paid', paidAt });
      return { added: p.tickets, purchase };
    });
  }
  async expirePurchase(id: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.purchase(id);
      const snap = await tx.get(ref);
      if (snap.exists && (snap.data() as PurchaseDoc).status === 'open') tx.update(ref, { status: 'expired' });
    });
  }
  async reclaimPurchase(id: string, target: number, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.purchase(id);
      const snap = await tx.get(ref);
      if (!snap.exists) return 0;
      const p = snap.data() as PurchaseDoc;
      const before = p.reclaimed ?? 0;
      if (p.status !== 'paid' || !(target > before)) return 0;
      const opened = await this.open(tx, p.uid, now);
      const { wallet, taken } = reclaim(opened.wallet, id, target - before);
      if (taken > 0) tx.create(opened.ref.collection('ledger').doc(), { count: -taken, reason: `refund-paid:${id}`, at: now });
      this.write(tx, opened, wallet, now);
      tx.update(ref, { reclaimed: target });
      return taken;
    });
  }
  async listUnannounced(uid: string): Promise<PurchaseDoc[]> {
    const snap = await this.db.collection('purchases').where('uid', '==', uid).where('status', '==', 'paid').get();
    return snap.docs
      .map((d) => d.data() as PurchaseDoc)
      .filter((p) => !p.announced)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async markAnnounced(id: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.purchase(id);
      const snap = await tx.get(ref);
      if (snap.exists) tx.update(ref, { announced: true });
    });
  }
  async countCheckout(uid: string, day: string, perDay: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('checkouts').doc(`${docId(uid)}_${docId(day)}`);
      const snap = await tx.get(ref);
      const used = snap.exists ? Number((snap.data() as { count?: unknown }).count) || 0 : 0;
      if (used >= perDay) throw new CloudError('limit', '今日は、お支払いを始められる回数の上限に達しました。あした、もう一度ためしてください');
      tx.set(ref, { count: used + 1 });
    });
  }
  async markWelcome(uid: string, n: number, now: number): Promise<number> {
    return this.db.runTransaction(async (tx) => {
      const opened = await this.open(tx, uid, now);
      const snap = await tx.get(opened.ref);
      if ((snap.data() as UserDoc).welcomed) return 0;
      tx.create(opened.ref.collection('ledger').doc(), { count: n, reason: 'welcome', at: now });
      this.write(tx, opened, addFree(opened.wallet, n), now);
      tx.update(opened.ref, { welcomed: true });
      return n;
    });
  }
}
