/**
 * 交換の画面（クローゼットの「こうかん」を押したときに読み込む）
 */
import { Trade } from './Trade';
import type { TradeProps } from './Trade';
import './trade.css';

export default function TradeRoot(props: TradeProps) {
  return <Trade {...props} />;
}
