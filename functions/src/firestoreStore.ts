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
const LIST_MAX = 500;

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
      if (user.tickets + delta < 0) throw new CloudError('no-tickets', `チケットが足りません（のこり ${user.tickets} 枚、必要 ${-delta} 枚）`);
      tx.update(ref, { tickets: user.tickets + delta });
      tx.create(ref.collection('ledger').doc(), { count: delta, reason, at: now });
      return user.tickets + delta;
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
    const snap = await this.user(uid).collection('jobs').orderBy('createdAt', 'desc').limit(LIST_MAX).get();
    return snap.docs.map((doc) => doc.data() as JobDoc);
  }
  async putItem(uid: string, item: ItemDoc): Promise<void> {
    await this.item(uid, item.id).set(item);
  }
  async getItem(uid: string, itemId: string): Promise<ItemDoc | null> {
    const snap = await this.item(uid, itemId).get();
    return snap.exists ? (snap.data() as ItemDoc) : null;
  }
  async listItems(uid: string): Promise<ItemDoc[]> {
    const snap = await this.user(uid).collection('items').orderBy('createdAt', 'asc').limit(LIST_MAX).get();
    return snap.docs.map((doc) => doc.data() as ItemDoc);
  }
  async deleteItem(uid: string, itemId: string): Promise<void> {
    await this.item(uid, itemId).delete();
  }
}
