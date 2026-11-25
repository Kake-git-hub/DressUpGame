/**
 * アプリの中のスタジオ（入口の確認 + 画面）。ゲームの最初の読み込みには入れず、「つくる」を押したときに読み込む。
 */
import { useState } from 'react';
import type { ManifestCategory } from '../content/manifest';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import type { DollData } from '../types';
import { AdultGate } from './AdultGate';
import orderArt from '../assets/shop/order.webp';
import shopArt from '../assets/shop/shop.webp';
import ticketArt from '../assets/shop/ticket.webp';
import { AppStudio } from './AppStudio';
import type { ShopArt } from './OrderShow';
import type { PayReturn } from './payReturn';
import './appStudio.css';

export interface StudioRootProps {
  session: CloudSession;
  library: Library;
  dolls: DollData[];
  categoriesByDoll: Record<string, ManifestCategory[]>;
  initialDollId: string;
  onClose: () => void;
  onOpenCloset: () => void;
  skipGate?: boolean; // 保護者の確認をしない（販売を始めるまで）
  demo?: boolean; // 確認用（偽物の裏側）
  payReturn?: PayReturn | null; // 支払いのページから戻ってきたとき
}

// 注文の演出の絵（洋服屋の店員とお店。この画面と一緒に、開いたときに読み込む）
const ART: ShopArt = { shop: shopArt, order: orderArt, ticket: ticketArt };

export default function StudioRoot({ session, library, dolls, categoriesByDoll, initialDollId, onClose, onOpenCloset, skipGate = false, demo = false, payReturn = null }: StudioRootProps) {
  // 保護者の確認は、開くたびに毎回たずねる（覚えない）
  const [confirmed, setConfirmed] = useState(skipGate);
  if (!confirmed) return <AdultGate onCancel={onClose} onPass={() => setConfirmed(true)} />;
  return <AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId={initialDollId} onClose={onClose} onOpenCloset={onOpenCloset} demo={demo} art={ART} payReturn={payReturn} />;
}
