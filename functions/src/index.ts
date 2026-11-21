/**
 * アプリの中のスタジオの、サーバーの関数（Cloud Functions 第 2 世代、東京）
 *
 *   studio     軽い呼び出し（利用者・始める・進み具合・使う・捨てる・自分の服）。中身は tools/cloud/api.ts
 *   studioRun  生成を進める（時間がかかる。1 点で 30 秒〜1 分）。中身は tools/cloud/studioCore.ts の runJob
 *
 * アプリは、匿名のログインをしてから、この 2 つだけを呼ぶ。Firestore と Storage は、アプリからは読めない。
 * Gemini のキーは、サーバーの「秘密の値」（GEMINI_API_KEY）にだけ置く。アプリには渡さない。
 *
 * 作者が変えられる設定は、Firestore の system/config（管理画面で作る。無ければ既定）:
 *   adminCodes   管理者の利用者コード（カンマ区切りの文字列）。管理者は、チケットが無くても作れる
 *   imagesPerDay サーバー全体で、1 日に作る画像の上限（数。既定 100。0 にすると、だれも作れない = 急いで止めたいとき）
 *   imagesPerUserPerDay 利用者 1 人が、1 日に作る画像の上限（数。既定 30。管理者にはかからない）
 * 1 日の区切りは、世界標準時の 0 時（日本の朝 9 時）。
 */
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { handleCall } from '../../tools/cloud/api.ts';
import { createPublicContent } from '../../tools/cloud/publicContent.ts';
import { CloudError } from '../../tools/cloud/store.ts';
import type { CloudFiles, CloudStore } from '../../tools/cloud/store.ts';
import { runJob } from '../../tools/cloud/studioCore.ts';
import type { CoreDeps, PublicContent } from '../../tools/cloud/studioCore.ts';
import { firebaseConfig } from '../../src/cloud/firebaseConfig.ts';
import { createGemini, createGeminiText, GEMINI_IMAGE_MODEL, GEMINI_TEXT_MODEL } from '../../tools/studio/ai.ts';
import { FirestoreStore } from './firestoreStore.ts';
import { StorageFiles } from './storageFiles.ts';

const REGION = 'asia-northeast1';
// 公開されている素材（src/content/loadContent.ts の DEFAULT_CONTENT_URL と同じ場所）
const CONTENT_URL = 'https://kake-git-hub.github.io/DressUpGame-content/';
const IMAGES_PER_DAY = 100;
const IMAGES_PER_USER_PER_DAY = 30;
const MAX_ATTEMPTS = 2; // 1 品目あたりの生成回数（作り直しを含む）
const CONFIG_TTL_MS = 60_000;

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// 手元のエミュレーターでのテストのときだけ、素材と Gemini の行き先を差し替えられる（本番では、この環境変数を見ない）
const emulated = process.env.FUNCTIONS_EMULATOR === 'true';
const contentUrl = (emulated && process.env.STUDIO_TEST_CONTENT_URL) || CONTENT_URL;
const geminiUrl = emulated ? process.env.STUDIO_TEST_GEMINI_URL : undefined;
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/';
const aiFetch: typeof fetch = geminiUrl ? (input, init) => fetch(String(input).replace(GEMINI_ORIGIN, geminiUrl), init) : fetch;

interface Config {
  adminCodes: string[];
  perDay: number;
  perUserDay: number;
}
interface Services {
  store: CloudStore;
  files: CloudFiles;
  content: PublicContent;
  config(): Promise<Config>;
}
let services: Services | null = null;
function getServices(): Services {
  if (services) return services;
  // 既定のアプリが無いときだけ作る。firebase-functions は、ログインの確かめのために、自分用の名前付きのアプリ
  // （__FIREBASE_FUNCTIONS_SDK__）を先に作ることがあるので、「アプリが 1 つも無い」では判定できない
  if (!getApps().some((app) => app.name === '[DEFAULT]')) initializeApp();
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  let cached: { at: number; value: Config } | null = null;
  const count = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback);
  services = {
    store: new FirestoreStore(db),
    // 置き場の名前は、はっきり指定する（手元のエミュレーターでは、既定のもの）
    files: new StorageFiles(emulated ? getStorage().bucket() : getStorage().bucket(firebaseConfig.storageBucket)),
    content: createPublicContent(contentUrl),
    async config() {
      if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
      const data = ((await db.collection('system').doc('config').get()).data() ?? {}) as { adminCodes?: unknown; imagesPerDay?: unknown; imagesPerUserPerDay?: unknown };
      // 文字列（カンマ・空白区切り）でも、配列でも受け付ける
      const listed = Array.isArray(data.adminCodes) ? data.adminCodes.filter((code): code is string => typeof code === 'string').join(',') : typeof data.adminCodes === 'string' ? data.adminCodes : '';
      const adminCodes = listed.split(/[\s,、]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
      const value: Config = { adminCodes, perDay: count(data.imagesPerDay, IMAGES_PER_DAY), perUserDay: count(data.imagesPerUserPerDay, IMAGES_PER_USER_PER_DAY) };
      cached = { at: Date.now(), value };
      return value;
    },
  };
  return services;
}

async function coreDeps(): Promise<CoreDeps> {
  const { store, files, content, config } = getServices();
  const { adminCodes, perDay, perUserDay } = await config();
  const key = GEMINI_API_KEY.value();
  return {
    store,
    files,
    content,
    ai: key ? { text: createGeminiText(key, GEMINI_TEXT_MODEL, aiFetch), image: createGemini(key, GEMINI_IMAGE_MODEL, aiFetch, '1K') } : { text: null, image: null },
    adminCodes,
    limits: { perDay, perUserDay, maxAttempts: MAX_ATTEMPTS },
    now: () => Date.now(),
    newId: () => randomUUID().replace(/-/g, '').slice(0, 20),
  };
}

// 利用者に伝える失敗（CloudError）は、理由の印（code）を付けて返す。それ以外は、記録して、くわしい中身は返さない
async function answer<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof CloudError) throw new HttpsError('failed-precondition', error.message, { code: error.code });
    logger.error(`${name} で失敗しました`, error);
    throw new HttpsError('internal', 'サーバーで問題が起きました。少し待ってから、もう一度ためしてください', { code: 'unknown' });
  }
}
function uidOf(request: { auth?: { uid: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'ログインできていません。アプリを開き直してください');
  return uid;
}

export const studio = onCall({ region: REGION, secrets: [GEMINI_API_KEY], memory: '1GiB', timeoutSeconds: 180, concurrency: 8, maxInstances: 5 }, (request) =>
  answer('studio', async () => handleCall(await coreDeps(), uidOf(request), request.data)),
);

export const studioRun = onCall({ region: REGION, secrets: [GEMINI_API_KEY], memory: '2GiB', timeoutSeconds: 900, concurrency: 1, maxInstances: 3 }, (request) =>
  answer('studioRun', async () => {
    const uid = uidOf(request);
    const jobId = (request.data as { jobId?: unknown } | null)?.jobId;
    if (typeof jobId !== 'string' || !jobId || jobId.length > 100) throw new CloudError('refused', '呼び出しの形が正しくありません');
    await runJob(await coreDeps(), uid, jobId);
    return { ok: true };
  }),
);
