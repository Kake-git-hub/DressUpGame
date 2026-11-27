/**
 * カテゴリのラベルから、作り方の違う種類（顔・髪・うしろがみ・くつ）を見分ける。
 * generate.ts と variety.ts の両方が使う（お互いを読み込まないように、ここに分けた）
 */
import { isBackHairCategory } from '../../src/pipeline/hairSplit.ts';

// 顔と髪型は別のカテゴリで着せ替えるので、それぞれ相手の部分を描かせない
const FACE_LABEL = /かお|顔|face|メイク|makeup/i;
const HAIR_LABEL = /^(かみ|髪|ヘア|hair)$|ヘアスタイル|かみがた|髪型|hair ?style|まえがみ|前髪/i;

const SHOES_LABEL = /くつ(?!した)|靴(?!下)|shoe|ブーツ|boot/i;

export function categoryKind(label: string): 'face' | 'hair' | 'backhair' | 'shoes' | null {
  if (isBackHairCategory(label)) return 'backhair';
  if (HAIR_LABEL.test(label.trim())) return 'hair';
  if (FACE_LABEL.test(label)) return 'face';
  if (SHOES_LABEL.test(label)) return 'shoes';
  return null;
}
