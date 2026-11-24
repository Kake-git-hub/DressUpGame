/**
 * Firebase のプロジェクトの設定値（作者のプロジェクト `dressup-game-89f6e`）
 *
 * これは公開してよい値（アプリの中に書くもので、Gemini のキーとは別物）。
 * ほかの人のデータを読めないようにするのは、Firestore と Storage の決まり（firestore.rules・storage.rules）と、サーバーの関数。
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyADG-s1EIeQdpWte0PQ9D9VvQNI4XqltlY',
  authDomain: 'dressup-game-89f6e.firebaseapp.com',
  projectId: 'dressup-game-89f6e',
  storageBucket: 'dressup-game-89f6e.firebasestorage.app',
  messagingSenderId: '389373249780',
  appId: '1:389373249780:web:30eff72e457ff1ca2e36a1',
};

// サーバーの関数を置く場所（東京）
export const FUNCTIONS_REGION = 'asia-northeast1';

// 画面を移る方法の Google の client_id（Firebase が作ったウェブ用のもの）。公開してよい値。空なら、アプリが Firebase に聞いて調べる
export const GOOGLE_CLIENT_ID = '389373249780-na1putbqacl36ste99du074tm5hojb8d.apps.googleusercontent.com';
