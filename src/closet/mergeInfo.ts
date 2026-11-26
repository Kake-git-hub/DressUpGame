/**
 * サーバーの返事（服の一覧に載る中身）を、端末の控えの服に重ねる（名前・色・並び・はじめの位置）
 */
import type { MyItem, MyItemInfo } from '../cloud/backend';

export const mergeInfo = (item: MyItem, info: MyItemInfo): MyItem => {
  const { fit: _old, ...rest } = item;
  void _old;
  return { ...rest, item: { ...item.item, name: info.item.name }, hue: info.hue, order: info.order, updatedAt: info.updatedAt, notes: info.notes, ...(info.fit ? { fit: info.fit } : {}) };
};
