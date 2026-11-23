/**
 * つなぎ役（session.ts）を用意する。「つくる」を出す端末でだけ、読み込む（ふだん遊ぶ人の読み込みには入れない）。
 */
import type { StudioMode } from '../appStudio/unlock';
import { createBackend } from './createBackend';
import type { Library } from './library';
import { createSession, USED_KEY } from './session';
import type { CloudSession } from './session';

// つなぎ役は、ページに 1 つだけ（開発用の設定で 2 回呼ばれても、同じものを返す）
let session: CloudSession | null = null;

export function bootSession(mode: StudioMode, library: Library, onLibraryChanged: () => void | Promise<void>): CloudSession {
  return (session ??= createSession({ backend: createBackend(mode), library, onLibraryChanged }));
}

// この端末で、前に「つくる」「クローゼット」を使ったか（使っていれば、起動のあと、裏でつなぐ）
export function usedBefore(): boolean {
  try {
    return localStorage.getItem(USED_KEY) === '1';
  } catch {
    return false;
  }
}

// 戻りの仕上げ（App.tsx が使う）。account.ts は、「つくる」を教えた端末の、この読み込みにだけ入れる
export { completeRedirect } from './account';
export { hasReturn } from './googleRedirect';
