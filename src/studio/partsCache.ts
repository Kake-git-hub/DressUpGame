/**
 * ドールごとの体の部位（型紙）。服のカードごとに読み直さない
 */
import type { BodyParts } from '../pipeline/bodyParts';
import { api } from './api';

const cache = new Map<string, Promise<BodyParts>>();

export function loadParts(dollId: string): Promise<BodyParts> {
  let p = cache.get(dollId);
  if (!p) {
    p = api.template(dollId).then((t) => t.parts as BodyParts);
    p.catch(() => cache.delete(dollId));
    cache.set(dollId, p);
  }
  return p;
}

// 型紙を保存したら、次に開くカードから新しい部位を使う
export function forgetParts(dollId: string): void {
  cache.delete(dollId);
}
