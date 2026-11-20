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
import { adultConfirmed, rememberAdult } from './unlock';
import type { StudioMode } from './unlock';
import './appStudio.css';

export interface StudioRootProps {
  mode: StudioMode;
  doll: DollData;
  categories: ManifestCategory[];
  library: Library;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>; // 自分の服が増えた・減った（メニューに重ね直す）
}

export default function StudioRoot({ mode, doll, categories, library, onClose, onLibraryChanged }: StudioRootProps) {
  const [confirmed, setConfirmed] = useState(adultConfirmed);
  // 裏側は、開いている間に 1 つだけ作る
  const backend = useMemo(() => createBackend(mode), [mode]);
  if (!confirmed) {
    return (
      <AdultGate
        onCancel={onClose}
        onPass={() => {
          rememberAdult();
          setConfirmed(true);
        }}
      />
    );
  }
  return <AppStudio backend={backend} doll={doll} categories={categories} library={library} onClose={onClose} onLibraryChanged={onLibraryChanged} demo={mode === 'fake'} />;
}
