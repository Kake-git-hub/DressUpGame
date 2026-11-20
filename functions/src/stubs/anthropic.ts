// サーバーの関数では、Claude を使わない（文章の AI も Gemini）。まとめるときに、Claude の部品の代わりに入れる
export default class Anthropic {
  constructor() {
    throw new Error('サーバーの関数では、Claude は使えません');
  }
}
