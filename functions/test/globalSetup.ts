/**
 * エミュレーターのテストの前に 1 回: 作者が管理画面で書く設定（system/config）を入れておく。
 * 関数は、この設定を 1 分おぼえるので、どのテストよりも先に書く（テストの順番で結果が変わらないように）。
 */
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ADMIN_CODE, PROJECT } from './ports.mjs';

export default async function setup(): Promise<void> {
  const app = initializeApp({ projectId: PROJECT }, `setup-${Date.now()}`);
  // 管理者の利用者コードは、小文字・空白まじりでも、配列でも受け付ける
  await getFirestore(app).doc('system/config').set({ adminCodes: ['nobody', ` ${ADMIN_CODE.toLowerCase()} `], imagesPerDay: 50, imagesPerUserPerDay: 20 });
  await deleteApp(app);
}
