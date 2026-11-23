/**
 * 服が届いた演出（届いた仕事があるときに読み込む）。端末の控えから、届いた服を読んで出す。
 */
import { useEffect, useState } from 'react';
import type { MyItem, StudioJob } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';
import { Reveal } from './Reveal';
import { revealView } from './revealView';
import './reveal.css';

export interface RevealRootProps {
  job: StudioJob; // 終わった仕事（結果を、まだ見ていない）
  library: Library;
  dolls: DollData[];
  categoriesByDoll: Record<string, ManifestCategory[]>;
  storeFailed: boolean;
  art?: { deliver?: string };
  // 届いた服を着せられるか（そのドールがゲームに出ていて、服がメニューに入っている）
  canTryOn: (dollId: string, itemIds: string[]) => boolean;
  onTryOn: (dollId: string, itemIds: string[]) => void;
  onOpenCloset: () => void;
  onClose: () => void;
}

export default function RevealRoot({ job, library, dolls, categoriesByDoll, storeFailed, art, canTryOn, onTryOn, onOpenCloset, onClose }: RevealRootProps) {
  const [items, setItems] = useState<MyItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    void library.all().then(
      (all) => alive && setItems(all),
      () => alive && setItems([]),
    );
    return () => {
      alive = false;
    };
  }, [library, job.id]);
  if (items === null) return null;
  const view = revealView(job, items, dolls, categoriesByDoll);
  const ids = view.items.map((item) => item.id);
  return (
    <Reveal
      view={view}
      storeFailed={storeFailed}
      art={art}
      canTryOn={ids.length > 0 && canTryOn(job.dollId, ids)}
      onTryOn={() => onTryOn(job.dollId, ids)}
      onOpenCloset={onOpenCloset}
      onClose={onClose}
    />
  );
}
