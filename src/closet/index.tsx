/**
 * クローゼット（ホームのボタンを押したときに読み込む）
 */
import { Closet } from './Closet';
import type { ClosetProps } from './Closet';
import './closet.css';

export default function ClosetRoot(props: ClosetProps) {
  return <Closet {...props} />;
}
