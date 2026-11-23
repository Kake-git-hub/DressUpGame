/**
 * 置き場の本物（Firestore）。形は tools/cloud/store.ts、ふるまいの手本は tools/cloud/memoryStore.ts。
 *
 *   users/{uid}                 利用者（利用者コード・チケットの残り）
 *   users/{uid}/ledger/{自動}   チケットの台帳（増減と理由）
 *   users/{uid}/jobs/{jobId}    生成の仕事（進み具合）
 *   users/{uid}/items/{itemId}  自分の服
 *   userCodes/{利用者コード}    利用者コード → uid（重ならないようにするため）
 *   system/usage-{日付}         その日に作った画像の枚数
 *
 * アプリからは直接読めない（firestore.rules で全部断る）。ここは、管理者の権限で読み書きする。
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { CloudError } from '../../tools/cloud/store.ts';
import type { CloudStore, ItemDoc, JobDoc, UserDoc } from '../../tools/cloud/store.ts';

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
      if (tickets < cost) throw new CloudError('no-tickets', `チケットが足りません（のこり ${tickets} 枚、必要 ${cost} 枚）`);
      tx.update(ref, { tickets: tickets - cost });
      tx.create(ref.collection('ledger').doc(), { count: -cost, reason, at: now });
      tx.create(this.job(uid, job.id), job);
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
}
