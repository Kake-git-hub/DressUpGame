/**
 * アプリの中のスタジオ（入口の確認 + 画面）。ゲームの最初の読み込みには入れず、「つくる」を押したときに読み込む。
 */
import { useMemo, useState } from 'react';
import type { ManifestCategory } from '../content/manifest';
import { createBackend } from '../cloud/createBackend';
import type { Library } from '../cloud/library';
import type { DollData } from '../types';
import { AdultGate } from './AdultGate';
import { AppStudio } from './AppStudio';
import type { StudioMode } from './unlock';
import './appStudio.css';

export interface StudioRootProps {
  mode: StudioMode;
  doll: DollData;
  categories: ManifestCategory[];
  library: Library;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>; // 自分の服が増えた・減った（メニューに重ね直す）
  skipGate?: boolean; // 保護者の確認をしない（ホーム画面の「つくる」から。開発中だけ）
}

export default function StudioRoot({ mode, doll, categories, library, onClose, onLibraryChanged, skipGate = false }: StudioRootProps) {
  // 保護者の確認は、開くたびに毎回たずねる（覚えない）
  const [confirmed, setConfirmed] = useState(skipGate);
  // 裏側は、開いている間に 1 つだけ作る
  const backend = useMemo(() => createBackend(mode), [mode]);
  if (!confirmed) {
    return (
      <AdultGate
        onCancel={onClose}
        onPass={() => setConfirmed(true)}
      />
    );
  }
  return <AppStudio backend={backend} doll={doll} categories={categories} library={library} onClose={onClose} onLibraryChanged={onLibraryChanged} demo={mode === 'fake'} />;
}
