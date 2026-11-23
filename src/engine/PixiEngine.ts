/**
 * PixiJS描画エンジン
 * ドールと服のレンダリングを担当
 * フィルターなし版（パフォーマンス最優先）
 */
import { Application, Container, Graphics, Sprite, Assets, ColorMatrixFilter, Texture } from 'pixi.js';
import { diag } from '../services/diag';
import { isBehindDoll } from './layers';
import { eraseHides } from './hides';
import type { Hide } from './hides';
import { partnerOf } from './pairs';
import { isDarkImage, recolor } from '../pipeline/recolor';
import type { Box, ClothingItemData, DollConfig, EquippedItem, DollTransform, Position } from '../types';

// ドール・服の表示高さ（画面の高さに対する割合）
const HEIGHT_RATIO = 0.9;

interface Placed {
  canvasW?: number;
  canvasH?: number;
  box?: Box;
}

// スプライトの原点を「切り抜く前の元キャンバスの中心」に合わせる。
// 切り抜き情報が無い画像は、画像全体を元キャンバスとみなす（＝画像の中心）。
function setCanvasOrigin(sprite: Sprite, placed: Placed, texture: { width: number; height: number }): void {
  const canvasW = placed.canvasW ?? texture.width;
  const canvasH = placed.canvasH ?? texture.height;
  const box = placed.box ?? { x: 0, y: 0, w: texture.width, h: texture.height };
  // 配信画像は box と同じ大きさ。違う場合に備えてテクスチャ基準に換算する
  const sx = texture.width / box.w;
  const sy = texture.height / box.h;
  sprite.anchor.set(0);
  sprite.pivot.set((canvasW / 2 - box.x) * sx, (canvasH / 2 - box.y) * sy);
}

// 拡大・回転の軸（テクスチャ上）と、元キャンバスの中心から軸までのずれ（元キャンバスの px）。
// 軸は、ふつうは服の中心。pivot（元キャンバスの中心からの px）を持つ服は、そこが軸（うしろがみは、前髪の中心で回る）
export function itemPivot(placed: Placed & { pivot?: Position }, texture: { width: number; height: number }): { x: number; y: number; fromCanvasCenter: { x: number; y: number } } {
  const canvasW = placed.canvasW ?? texture.width;
  const canvasH = placed.canvasH ?? texture.height;
  const box = placed.box ?? { x: 0, y: 0, w: texture.width, h: texture.height };
  if (placed.pivot) {
    return {
      x: (canvasW / 2 + placed.pivot.x - box.x) * (texture.width / box.w),
      y: (canvasH / 2 + placed.pivot.y - box.y) * (texture.height / box.h),
      fromCanvasCenter: { x: placed.pivot.x, y: placed.pivot.y },
    };
  }
  return {
    x: texture.width / 2,
    y: texture.height / 2,
    fromCanvasCenter: { x: box.x + box.w / 2 - canvasW / 2, y: box.y + box.h / 2 - canvasH / 2 },
  };
}

// 絵の画素を読む（読めない絵は null）
function pixelsOf(source: CanvasImageSource & { width: number; height: number }): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    return { canvas, ctx, image: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } catch {
    return null;
  }
}

// 服に付いた「ドールのすぐ上に描く分」（くつの中の肌など）の原点。服と同じ軸（服の中心）で回り、大きくなるように、
// 服の中心が、その絵のテクスチャ上のどこに当たるかを返す。scale は、テクスチャ 1px が元キャンバスの何 px か
export function underPivot(item: { box: Box; canvasW: number; canvasH: number }, under: { canvasW: number; canvasH: number; box: Box }, texture: { width: number; height: number }): { x: number; y: number; scale: number } {
  const k = texture.width / under.box.w;
  const centerX = item.box.x + item.box.w / 2 - item.canvasW / 2; // 元キャンバスの中心から、服の中心まで
  const centerY = item.box.y + item.box.h / 2 - item.canvasH / 2;
  const left = under.box.x - under.canvasW / 2; // 元キャンバスの中心から、絵の左上まで
  const top = under.box.y - under.canvasH / 2;
  return { x: (centerX - left) * k, y: (centerY - top) * k, scale: 1 / k };
}

// 描き直しのたびに作る、隠す所を消した服のテクスチャ（次の描き直しで捨てる）
type ClothingOptions = {
  clip?: ReadonlyMap<string, Hide[]>; // 服の ID → その服から消す所（服のキャンバス上の位置）
  adjustingItemId?: string | null; // 調整中の服。その「ドールのすぐ上の分」は、調整画面が服と一緒に描く
};

export class PixiEngine {
  private app: Application | null = null;
  private backgroundContainer: Container | null = null;
  private backContainer: Container | null = null; // ドールの後ろの服（うしろがみ・後ろに回した服）
  private dollContainer: Container | null = null;
  private clothingContainer: Container | null = null;
  private faceContainer: Container | null = null;
  private initialized = false;
  private destroyed = false;
  private customFaceUrl: string | null = null;
  private dollTransform: DollTransform = { x: 50, y: 50, scale: 1.0 }; // %単位、背景領域の中央
  private menuOffset = 0; // メニュー幅オフセット（左側）
  private rightOffset = 60; // 右ボタン領域のオフセット（右側）
  private contextLostCallback: (() => void) | null = null; // コンテキストロスト時のコールバック
  private backgroundArea: { x: number; y: number; size: number } | null = null; // 背景領域（1:1正方形）
  private tickerRunning = true; // Tickerが動作中かどうか
  // 描画の通し番号。画像の読み込み中に次の描画が始まったら、古いほうは捨てる
  private dollDrawId = 0;
  private clothingDrawId = 0;
  private backgroundDrawId = 0;
  // 服が隠す所を消したドールのテクスチャ（作り直したら前のものは捨てる）
  private hiddenDollTexture: Texture | null = null;
  private clippedTextures: Texture[] = []; // 隠す所を消した服・色を付けた黒っぽい服（次の描き直しで捨てる）
  private darkImages = new Map<string, boolean>(); // 絵の URL → 黒っぽい絵か

  // 初期化
  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    if (this.initialized || this.destroyed) {
      return;
    }

    try {
      // 画像はページ本体から取得する（ワーカー経由だと、Safari でサービスワーカーの
      // キャッシュを通らずオフラインで読めない恐れがある）
      Assets.setPreferences({ preferWorkers: false });
      this.app = new Application();
      await this.app.init({
        canvas,
        width,
        height,
        backgroundAlpha: 0, // 透明背景
        antialias: true,
        preserveDrawingBuffer: true, // スクリーンショット用
        resolution: window.devicePixelRatio || 1, // 高解像度対応
        autoDensity: true, // 高解像度ディスプレイ自動対応
      });

      // 既に破棄されていたら処理を中止
      if (this.destroyed) {
        try {
          this.app.destroy(true, { children: true });
        } catch {
          // 無視
        }
        this.app = null;
        return;
      }

      // 背景用コンテナ（最背面）
      this.backgroundContainer = new Container();
      this.backgroundContainer.label = 'backgroundContainer';
      this.app.stage.addChild(this.backgroundContainer);

      // ドールの後ろの服（うしろがみ・後ろに回した服）。背景の上、ドールの下
      this.backContainer = new Container();
      this.backContainer.label = 'backContainer';
      this.app.stage.addChild(this.backContainer);

      // ドール用コンテナ
      this.dollContainer = new Container();
      this.dollContainer.label = 'dollContainer';
      this.app.stage.addChild(this.dollContainer);

      // 顔用コンテナ（ドールの上、服の下）
      this.faceContainer = new Container();
      this.faceContainer.label = 'faceContainer';
      this.app.stage.addChild(this.faceContainer);

      // 服用コンテナ（ドールの上に表示）
      this.clothingContainer = new Container();
      this.clothingContainer.label = 'clothingContainer';
      this.app.stage.addChild(this.clothingContainer);

      // キャンバス参照を保存（コンテキストロスト検知用）
      // WebGLコンテキストロスト対策（iPad等でバックグラウンドから復帰時）
      this.setupContextLostHandler(canvas);

      this.initialized = true;
    } catch (error) {
      console.error('PixiJS初期化エラー:', error);
      this.cleanup();
    }
  }

  // 内部クリーンアップ
  private cleanup(): void {
    this.initialized = false;
    this.backgroundContainer = null;
    this.backContainer = null;
    this.dollContainer = null;
    this.clothingContainer = null;
    this.faceContainer = null;
    if (this.app) {
      try {
        this.app.destroy(true, { children: true });
      } catch {
        // 無視
      }
      this.app = null;
    }
    // テクスチャキャッシュをクリア（メモリ解放）
    try {
      Assets.reset();
    } catch {
      // 無視
    }
  }

  // WebGLコンテキストロストのハンドリング設定
  private setupContextLostHandler(canvas: HTMLCanvasElement): void {
    // コンテキストが失われた時
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      // 片付け（ホームへ戻る、など）のときも、Pixi が土台を手放すので、ここに来る。それは落ちたのではない（Issue 7 のきろく）
      if (this.destroyed) {
        diag.note('gl', 'closed');
        return;
      }
      console.warn('WebGLコンテキストがロストしました');
    });

    // コンテキストが復元された時
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGLコンテキストが復元されました');
      diag.note('gl', 'restored');
      // コールバックがあれば呼び出し
      if (this.contextLostCallback) {
        this.contextLostCallback();
      }
    });
  }

  // コンテキストロスト時のコールバックを設定
  setContextLostCallback(callback: () => void): void {
    this.contextLostCallback = callback;
  }

  // 強制的に再描画を要求（コンテキスト復元後等に使用）
  forceRedraw(): void {
    if (this.app && this.initialized && !this.destroyed) {
      this.app.render();
    }
  }

  // メニューオフセットを設定（背景・ドール位置調整用）
  setMenuOffset(offset: number): void {
    this.menuOffset = offset;
  }

  // 右ボタン領域オフセットを設定
  setRightOffset(offset: number): void {
    this.rightOffset = offset;
  }

  // 利用可能な描画領域（メニューとボタンを除いた中央領域）
  private getAvailableArea(): { x: number; width: number; centerX: number } {
    if (!this.app) return { x: 0, width: 0, centerX: 0 };
    const x = this.menuOffset;
    const width = Math.max(0, this.app.screen.width - this.menuOffset - this.rightOffset);
    const centerX = x + width / 2;
    return { x, width, centerX };
  }

  // 背景を設定
  async setBackground(imageUrl: string | null): Promise<void> {
    if (!this.backgroundContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存の背景をクリア（テクスチャも解放してメモリ節約）
    for (const child of this.backgroundContainer.children) {
      if (child instanceof Sprite && child.texture) {
        // テクスチャのソースを解放（GPUメモリ節約）
        child.texture.destroy(true);
      }
    }
    this.backgroundContainer.removeChildren();

    if (!imageUrl) {
      this.backgroundDrawId++; // 読み込み中の背景があれば無効にする
      // 背景なしでもスクリーンショット用に背景領域を設定（1:1正方形）
      const area = this.getAvailableArea();
      const bgSize = this.app.screen.height;
      this.backgroundArea = {
        x: area.centerX - bgSize / 2,
        y: 0,
        size: bgSize,
      };
      return;
    }

    try {
      const drawId = ++this.backgroundDrawId;
      const texture = await Assets.load(imageUrl);
      // 読み込み中に別の背景が指定されたら、こちらは捨てる
      if (drawId !== this.backgroundDrawId || this.destroyed || !this.backgroundContainer) return;
      
      // パフォーマンス最適化: テクスチャのスケールモードを設定
      // 縮小表示時の品質を維持しつつGPU負荷を軽減
      texture.source.scaleMode = 'linear';
      
      const bgSprite = new Sprite(texture);
      const area = this.getAvailableArea();

      // 背景は1:1正方形で画面縦幅いっぱいに表示
      const bgSize = this.app.screen.height;
      // 縦画面（メニューが下）で、キャンバスが正方形より横に広いとき（服を 2 段にして、正方形を低くしたタブレット）は、
      // 背景を幅いっぱいに広げて描く（上下は切れる）。正方形のままだと、左右に背景の無いすきまができる。
      // ドールの基準（backgroundArea）は正方形のまま: ドールと服の位置・写真の範囲は変わらない
      const fill = this.menuOffset === 0 && this.rightOffset === 0 && area.width > bgSize;
      const drawSize = fill ? area.width : bgSize;
      const scale = drawSize / Math.max(texture.width, texture.height);
      bgSprite.scale.set(scale);

      // 利用可能領域の中心に配置
      bgSprite.anchor.set(0.5);
      bgSprite.x = area.centerX;
      bgSprite.y = this.app.screen.height / 2;

      // 背景領域情報を保存（スクリーンショット用）
      this.backgroundArea = {
        x: area.centerX - bgSize / 2,
        y: (this.app.screen.height - bgSize) / 2,
        size: bgSize,
      };

      // 背景領域のみ表示（メニュー・ボタン領域をマスク）
      const mask = new Graphics();
      if (fill) mask.rect(area.x, 0, area.width, this.app.screen.height);
      else mask.rect(this.backgroundArea.x, this.backgroundArea.y, bgSize, bgSize);
      mask.fill(0xffffff);
      bgSprite.mask = mask;

      this.backgroundContainer.addChild(bgSprite);
      this.backgroundContainer.addChild(mask);
    } catch (error) {
      console.warn('背景画像の読み込みに失敗:', error);
    }
  }

  // 背景領域の中心を取得（1:1正方形の中心）
  private getBackgroundCenter(): { centerX: number; centerY: number; size: number } {
    if (!this.app) return { centerX: 0, centerY: 0, size: 0 };
    
    if (this.backgroundArea) {
      return {
        centerX: this.backgroundArea.x + this.backgroundArea.size / 2,
        centerY: this.backgroundArea.y + this.backgroundArea.size / 2,
        size: this.backgroundArea.size,
      };
    }
    
    // フォールバック：画面高さを正方形として中心を計算
    const area = this.getAvailableArea();
    const size = this.app.screen.height;
    return {
      centerX: area.centerX,
      centerY: size / 2,
      size: size,
    };
  }

  // ドールを隠す・戻す（ドールの後ろの服を調整している間は、画面側のプレビューが代わりにドールを描く）
  setDollVisible(visible: boolean): void {
    if (this.dollContainer) this.dollContainer.visible = visible;
  }

  // ドールを描画（画像URLがあれば画像、なければプレースホルダー）
  async drawDoll(config: DollConfig): Promise<void> {
    if (!this.dollContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存のドールをクリア
    this.dollContainer.removeChildren();
    const drawId = ++this.dollDrawId;

    // 背景領域の中心を基準にドール位置を計算
    const bgCenter = this.getBackgroundCenter();
    // dollTransformのx,yは背景領域内での%位置（50%=中央）
    const centerX = bgCenter.centerX + ((this.dollTransform.x - 50) / 100) * bgCenter.size;
    const centerY = bgCenter.centerY + ((this.dollTransform.y - 50) / 100) * bgCenter.size;
    const dollScale = this.dollTransform.scale;

    // 画像URLが指定されていて、カスタム顔がない場合は画像を読み込む
    if (config.imageUrl && config.imageUrl.length > 0) {
      try {
        let texture: Texture = await Assets.load(config.imageUrl);
        // 着ている服が隠す所（手袋・くつの下の指先など）を消したドールにする
        const hides = config.hides ?? [];
        let hidden: Texture | null = null;
        if (hides.length > 0 && config.box) {
          try {
            const masks = await Promise.all(
              hides.map(async (h) => ({ image: ((await Assets.load(h.url)) as Texture).source.resource as CanvasImageSource, box: h.box })),
            );
            const source = texture.source.resource as CanvasImageSource & { width: number; height: number };
            hidden = Texture.from(eraseHides(source, config.box, masks));
          } catch (error) {
            console.warn('服が隠す所を読めませんでした。ドールをそのまま表示します:', error);
          }
        }
        // 読み込み中に別のドールの描画が始まったら、こちらは捨てる（二重に表示しない）
        if (drawId !== this.dollDrawId || this.destroyed || !this.dollContainer) {
          hidden?.destroy(true);
          return;
        }
        this.dollContainer.removeChildren();
        this.hiddenDollTexture?.destroy(true);
        this.hiddenDollTexture = hidden;
        if (hidden) texture = hidden;
        // 縮小時の画質向上：リニア補間を使用
        texture.source.scaleMode = 'linear';
        const dollSprite = new Sprite(texture);

        // キャンバスに収まるようにスケーリング（高さの90%に合わせてから、ドールスケールを適用）
        const maxHeight = this.app.screen.height * HEIGHT_RATIO;
        // 基準高さを固定値にして、ドールと服のスケールを統一
        // ※インポート時に最大1024pxにリサイズされるため、1024を基準にする
        const REFERENCE_HEIGHT = 1024;
        const baseScale = maxHeight / REFERENCE_HEIGHT;
        dollSprite.scale.set(baseScale * dollScale);

        // 位置を設定（切り抜き画像を、元キャンバスの中心が原点になるように置く）
        setCanvasOrigin(dollSprite, config, texture);
        dollSprite.x = centerX;
        dollSprite.y = centerY;

        // フィルターなし（画像は透過PNG前提）

        this.dollContainer.addChild(dollSprite);
        diag.note('doll', `hides=${hides.length}`, `erased=${!!hidden}`, `${texture.width}x${texture.height}`);
        return;
      } catch (error) {
        console.warn('ドール画像の読み込みに失敗、プレースホルダーを表示:', error);
        // 画像読み込み失敗時はプレースホルダーを表示
      }
    }

    // プレースホルダーとしてシンプルな人形を描画
    const doll = new Graphics();

    // スケールを適用したサイズ計算
    const s = dollScale;

    // 頭（円）- カスタム顔がない場合のみ描画
    if (!this.customFaceUrl) {
      doll.circle(centerX, centerY - 80 * s, 40 * s);
      doll.fill(0xffe4c4); // 肌色
    }

    // 体（楕円風の四角形）
    doll.roundRect(centerX - 35 * s, centerY - 30 * s, 70 * s, 100 * s, 10 * s);
    doll.fill(0xffe4c4);

    // 腕
    doll.roundRect(centerX - 55 * s, centerY - 20 * s, 20 * s, 60 * s, 5 * s);
    doll.fill(0xffe4c4);
    doll.roundRect(centerX + 35 * s, centerY - 20 * s, 20 * s, 60 * s, 5 * s);
    doll.fill(0xffe4c4);

    // 脚
    doll.roundRect(centerX - 25 * s, centerY + 70 * s, 20 * s, 70 * s, 5 * s);
    doll.fill(0xffe4c4);
    doll.roundRect(centerX + 5 * s, centerY + 70 * s, 20 * s, 70 * s, 5 * s);
    doll.fill(0xffe4c4);

    // 顔（目）- カスタム顔がない場合のみ
    if (!this.customFaceUrl) {
      doll.circle(centerX - 12 * s, centerY - 85 * s, 5 * s);
      doll.fill(0x333333);
      doll.circle(centerX + 12 * s, centerY - 85 * s, 5 * s);
      doll.fill(0x333333);

      // 口（笑顔）
      doll.arc(centerX, centerY - 70 * s, 15 * s, 0.1, Math.PI - 0.1);
      doll.stroke({ width: 2, color: 0xff6b6b });
    }

    this.dollContainer.addChild(doll);
  }

  // ドールの位置・スケールを設定
  setDollTransform(transform: DollTransform): void {
    this.dollTransform = transform;
  }

  // 現在のドール位置・スケールを取得
  getDollTransform(): DollTransform {
    return { ...this.dollTransform };
  }

  // カスタム顔を設定
  async setCustomFace(imageUrl: string | null): Promise<void> {
    if (!this.faceContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    this.customFaceUrl = imageUrl;

    // 既存の顔をクリア
    this.faceContainer.removeChildren();

    if (!imageUrl) {
      // 顔をクリアしてドールを再描画
      this.drawDoll({ width: 200, height: 300, imageUrl: '' });
      return;
    }

    // 背景領域の中心を基準に顔の位置を計算
    const bgCenter = this.getBackgroundCenter();
    const centerX = bgCenter.centerX + ((this.dollTransform.x - 50) / 100) * bgCenter.size;
    const centerY = bgCenter.centerY + ((this.dollTransform.y - 50) / 100) * bgCenter.size;

    try {
      // 画像をロード
      const texture = await Assets.load(imageUrl);
      const faceSprite = new Sprite(texture);

      // 顔のサイズを調整（直径80px程度）
      const faceSize = 80;
      const scale = faceSize / Math.max(texture.width, texture.height);
      faceSprite.scale.set(scale);

      // 中心に配置
      faceSprite.anchor.set(0.5);
      faceSprite.x = centerX;
      faceSprite.y = centerY - 80;

      // 円形にマスクする
      const mask = new Graphics();
      mask.circle(centerX, centerY - 80, 40);
      mask.fill(0xffffff);
      faceSprite.mask = mask;
      this.faceContainer.addChild(mask);

      this.faceContainer.addChild(faceSprite);

      // ドールを再描画（顔部分を除外）
      this.drawDoll({ width: 200, height: 300, imageUrl: '' });
    } catch (error) {
      console.error('顔画像の読み込みエラー:', error);
    }
  }

  // 服を描画（imageUrlがあれば画像、なければプレースホルダー）。
  // 描く順番（下から）: ドールの後ろの服（うしろがみ・後ろに回した服）→ ドール → ほかの服（layers.ts の drawOrder と同じ）。
  // hidden の服は描かない（調整中は画面側のプレビューが代わりに出る）
  // 服の「ドールのすぐ上に描く分」（くつの中の肌）は、ドールの前の服より下にまとめて描く（ドールの後ろの服なら、その服のすぐ下）。
  // options.clip にある服は、その所を消して描く（くつの下の靴下が、くつの外にはみ出さないように）
  async drawClothing(
    items: (ClothingItemData | EquippedItem)[],
    hidden: ReadonlySet<string> | null = null,
    options: ClothingOptions = {},
  ): Promise<void> {
    if (!this.clothingContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    const startedAt = performance.now();
    // 背景領域の中心を基準に服の位置を計算
    const bgCenter = this.getBackgroundCenter();
    const centerX = bgCenter.centerX + ((this.dollTransform.x - 50) / 100) * bgCenter.size;
    const centerY = bgCenter.centerY + ((this.dollTransform.y - 50) / 100) * bgCenter.size;
    const s = this.dollTransform.scale; // スケール

    // 新しい一時コンテナを作成（全ロード完了後に一括表示するため）
    const tempContainer = new Container();
    tempContainer.label = 'tempClothingContainer';
    const behindSprites: Sprite[] = []; // ドールの後ろの服（うしろがみ・後ろに回した服）

    // 全アイテムのテクスチャを並列で先にロード（ラグ解消）
    const clip = options.clip ?? new Map<string, Hide[]>();
    const madeTextures: Texture[] = []; // この描き直しで作ったテクスチャ
    const loadPromises = items.map(async (item) => {
      // ドールのすぐ上に描く分。読めなければ描かない（服そのものは描く）
      const loadUnder = async (): Promise<Texture | null> => {
        if (!item.under || hidden?.has(item.id) || item.id === options.adjustingItemId) return null;
        try {
          return (await Assets.load(item.under.url)) as Texture;
        } catch (error) {
          console.warn(`服の下に描く分の読み込みに失敗 (${item.name}):`, error);
          return null;
        }
      };
      if (item.imageUrl) {
        try {
          // キャッシュ済みならすぐに返る
          let texture = (await Assets.load(item.imageUrl)) as Texture;
          const masks = clip.get(item.id);
          if (masks?.length && item.box) {
            try {
              const images = await Promise.all(masks.map(async (h) => ({ image: ((await Assets.load(h.url)) as Texture).source.resource as CanvasImageSource, box: h.box })));
              const source = texture.source.resource as CanvasImageSource & { width: number; height: number };
              texture = Texture.from(eraseHides(source, item.box, images));
              madeTextures.push(texture);
            } catch (error) {
              console.warn(`服が隠す所を読めませんでした。服をそのまま表示します (${item.name}):`, error);
            }
          }
          // 黒っぽい絵（黒髪など）は、色相を回しても色が変わらないので、絵そのものに色を付ける
          let recolored = false;
          const hue = (item as EquippedItem).colorHue ?? 0;
          if (hue !== 0 && !hidden?.has(item.id) && (await this.isDark(item, items))) {
            const pixels = pixelsOf(texture.source.resource as CanvasImageSource & { width: number; height: number });
            if (pixels) {
              recolor(pixels.image.data, pixels.image.data, hue, true);
              pixels.ctx.putImageData(pixels.image, 0, 0);
              texture = Texture.from(pixels.canvas);
              madeTextures.push(texture);
              recolored = true;
            }
          }
          return { item, texture, under: await loadUnder(), error: null, recolored };
        } catch (error) {
          return { item, texture: null, under: null, error, recolored: false };
        }
      }
      return { item, texture: null, under: null, error: null, recolored: false };
    });

    const drawId = ++this.clothingDrawId;
    const loadedItems = await Promise.all(loadPromises);

    // 破棄チェック（ロード中に破棄された場合）。
    // 読み込み中に次の描画が始まった場合も捨てる（遅れて届いた古い服装で上書きしない）
    if (this.destroyed || !this.clothingContainer || !this.backContainer || drawId !== this.clothingDrawId) {
      tempContainer.destroy({ children: true });
      for (const texture of madeTextures) texture.destroy(true);
      return;
    }

    const underSprites: Sprite[] = []; // ドールの前の服の「ドールのすぐ上の分」（服より下にまとめる）
    // ロード完了後、一時コンテナに描画
    for (const { item, texture, under, error, recolored } of loadedItems) {
      // movableアイテムの場合、オフセットを取得
      const offsetX = (item as EquippedItem).offsetX ?? 0;
      const offsetY = (item as EquippedItem).offsetY ?? 0;
      
      // 調整値を取得（デフォルト値を設定）
      const adjustOffsetX = (item as EquippedItem).adjustOffsetX ?? 0;
      const adjustOffsetY = (item as EquippedItem).adjustOffsetY ?? 0;
      const adjustScale = (item as EquippedItem).adjustScale ?? 1.0;
      const adjustRotation = (item as EquippedItem).adjustRotation ?? 0;
      
      // movableアイテムの位置計算
      // offsetX/offsetYは中央(50%)からのパーセンテージオフセット
      let itemX = centerX;
      let itemY = centerY;
      
      if (item.movable && (offsetX !== 0 || offsetY !== 0)) {
        // ドロップ位置を背景領域内のピクセルに変換
        itemX = bgCenter.centerX + (offsetX / 100) * bgCenter.size;
        itemY = bgCenter.centerY + (offsetY / 100) * bgCenter.size;
      }
      
      // 調整オフセットを適用（ピクセル単位）
      itemX += adjustOffsetX;
      itemY += adjustOffsetY;

      // 色相フィルター（colorHueが設定されている場合のみ個別適用）
      const colorHue = (item as EquippedItem).colorHue ?? 0;
      const hueFilters = () => {
        const hueFilter = new ColorMatrixFilter();
        hueFilter.hue(colorHue, false);
        // 解像度をデバイスに合わせる（画質維持）
        hueFilter.resolution = window.devicePixelRatio || 1;
        // パディングを0にして位置ずれを防止
        hueFilter.padding = 0;
        return [hueFilter];
      };

      const behind = isBehindDoll(item as EquippedItem);
      if (hidden?.has(item.id)) continue;

      // テクスチャがロード済みの場合はスプライトを作成
      if (texture) {
        // 縮小時の画質向上：リニア補間を使用
        texture.source.scaleMode = 'linear';
        const clothingSprite = new Sprite(texture);

        // 服のサイズをドールと同じスケーリング
        const maxHeight = this.app.screen.height * HEIGHT_RATIO;
        // 基準高さを固定値にして、ドールと服のスケールを統一
        // ※インポート時に最大1024pxにリサイズされるため、1024を基準にする
        const REFERENCE_HEIGHT = 1024;
        const baseScale = maxHeight / REFERENCE_HEIGHT;
        // 調整スケールを適用
        clothingSprite.scale.set(baseScale * s * adjustScale);

        // 拡大・回転は服そのものの中心を軸にする（シールのように、その場で回る）。
        // 調整していなければ、元キャンバスの中心を原点に置いたときと同じ位置になる
        const pivot = itemPivot(item, texture);
        clothingSprite.anchor.set(0);
        clothingSprite.pivot.set(pivot.x, pivot.y);
        clothingSprite.x = itemX + pivot.fromCanvasCenter.x * baseScale * s;
        clothingSprite.y = itemY + pivot.fromCanvasCenter.y * baseScale * s;
        
        // 回転を適用（度からラジアンに変換）
        clothingSprite.rotation = (adjustRotation * Math.PI) / 180;

        if (colorHue !== 0 && !recolored) clothingSprite.filters = hueFilters();

        // ドールのすぐ上に描く分: 服と同じ位置・大きさ・向き。色は変えない
        let underSprite: Sprite | null = null;
        if (under && item.under) {
          under.source.scaleMode = 'linear';
          underSprite = new Sprite(under);
          const p = underPivot({ ...item, box: item.box, canvasW: item.canvasW, canvasH: item.canvasH }, item.under, under);
          underSprite.anchor.set(0);
          underSprite.pivot.set(p.x, p.y);
          underSprite.scale.set(baseScale * s * adjustScale * p.scale);
          underSprite.x = clothingSprite.x;
          underSprite.y = clothingSprite.y;
          underSprite.rotation = clothingSprite.rotation;
        }

        if (behind) {
          if (underSprite) behindSprites.push(underSprite);
          behindSprites.push(clothingSprite);
        } else {
          if (underSprite) underSprites.push(underSprite);
          tempContainer.addChild(clothingSprite);
        }
      } else if (error) {
        // 画像読み込み失敗時はプレースホルダーを表示
        console.warn(`服画像の読み込みに失敗 (${item.name}):`, error);
        this.drawClothingPlaceholderTo(tempContainer, item, itemX, itemY, s);
      } else {
        // imageUrlがない場合はプレースホルダー
        this.drawClothingPlaceholderTo(tempContainer, item, itemX, itemY, s);
      }
    }

    // 全描画完了後、既存の服を削除して一時コンテナの内容を移動
    // 古いスプライトのフィルターをクリア（メモリリーク防止）
    for (const child of this.clothingContainer.children) {
      if (child instanceof Sprite) {
        child.filters = null;
      }
    }
    this.clothingContainer.removeChildren();
    for (const sprite of underSprites) this.clothingContainer.addChild(sprite);

    while (tempContainer.children.length > 0) {
      const child = tempContainer.children[0];
      tempContainer.removeChild(child);
      this.clothingContainer.addChild(child);
    }
    tempContainer.destroy();

    // ドールの後ろの服を入れ替える
    for (const child of this.backContainer.children) if (child instanceof Sprite) child.filters = null;
    this.backContainer.removeChildren().forEach((child) => child.destroy());
    for (const sprite of behindSprites) this.backContainer.addChild(sprite);
    // 前の描き直しで作ったテクスチャを捨てる（いまの絵は、この描き直しで作ったものを使う）
    for (const texture of this.clippedTextures) texture.destroy(true);
    this.clippedTextures = madeTextures;

    // 服は、スプライトのまま描く。前は、服をまとめて 1 枚のテクスチャに写していた（cacheAsTexture）が、
    // その作業用の領域が大きく（2 のべき乗の大きさ × なめらかにする 4 倍）、セットを着せた瞬間に数十〜数百 MB を取って、
    // iPad で描画の土台（WebGL）が落ちた（v0.35.1）。描き直すのは着せ替えのあとの 1 秒だけなので、写す得は無い
    const bounds = this.clothingContainer.getLocalBounds();
    diag.note(
      'clothes',
      `n=${items.length}`,
      `hidden=${hidden?.size ?? 0}`,
      `front=${this.clothingContainer.children.length}`,
      `behind=${behindSprites.length}`,
      `made=${madeTextures.length}`,
      `bounds=${Math.round(bounds.width)}x${Math.round(bounds.height)}`,
      `screen=${Math.round(this.app.screen.width)}x${Math.round(this.app.screen.height)}@${this.app.renderer.resolution}`,
      `ms=${Math.round(performance.now() - startedAt)}`,
    );
  }

  // 黒っぽい絵か。髪は、前髪と対のうしろがみのどちらかが黒っぽければ、両方とも同じ色変えにする
  private async isDark(item: ClothingItemData, items: (ClothingItemData | EquippedItem)[]): Promise<boolean> {
    if (await this.isDarkImage(item.imageUrl)) return true;
    const partner = partnerOf(items, item.id);
    return partner ? this.isDarkImage(partner.imageUrl) : false;
  }
  private async isDarkImage(url: string): Promise<boolean> {
    const known = this.darkImages.get(url);
    if (known !== undefined) return known;
    let dark = false;
    try {
      const texture = (await Assets.load(url)) as Texture;
      const pixels = pixelsOf(texture.source.resource as CanvasImageSource & { width: number; height: number });
      dark = pixels ? isDarkImage(pixels.image.data) : false;
    } catch {
      // 読めない絵は、ふつうの色変え
    }
    this.darkImages.set(url, dark);
    return dark;
  }

  // レンダリングループを停止（パフォーマンス最適化）
  pauseRendering(): void {
    if (!this.app || !this.tickerRunning) return;
    this.app.ticker.stop();
    this.tickerRunning = false;
    console.log('レンダリングループを一時停止');
  }

  // レンダリングループを再開
  resumeRendering(): void {
    if (!this.app || this.tickerRunning) return;
    this.app.ticker.start();
    this.tickerRunning = true;
    console.log('レンダリングループを再開');
  }

  // Ticker状態を取得
  isTickerRunning(): boolean {
    return this.tickerRunning;
  }

  // 服のプレースホルダーを指定コンテナに描画
  private drawClothingPlaceholderTo(
    container: Container,
    item: ClothingItemData | EquippedItem,
    centerX: number,
    centerY: number,
    s: number
  ): void {
    const clothing = new Graphics();

      switch (item.type) {
        case 'underwear_top':
          // 白いキャミソール
          clothing.roundRect(centerX - 30 * s, centerY - 25 * s, 60 * s, 45 * s, 5 * s);
          clothing.fill(0xffffff);
          clothing.stroke({ width: 1, color: 0xdddddd });
          // ストラップ
          clothing.moveTo(centerX - 20 * s, centerY - 25 * s);
          clothing.lineTo(centerX - 15 * s, centerY - 40 * s);
          clothing.stroke({ width: 3, color: 0xffffff });
          clothing.moveTo(centerX + 20 * s, centerY - 25 * s);
          clothing.lineTo(centerX + 15 * s, centerY - 40 * s);
          clothing.stroke({ width: 3, color: 0xffffff });
          break;

        case 'underwear_bottom':
          // 白いショーツ
          clothing.roundRect(centerX - 25 * s, centerY + 30 * s, 50 * s, 30 * s, 5 * s);
          clothing.fill(0xffffff);
          clothing.stroke({ width: 1, color: 0xdddddd });
          break;

        case 'top':
          // Tシャツ
          clothing.roundRect(centerX - 40 * s, centerY - 30 * s, 80 * s, 60 * s, 5 * s);
          clothing.fill(0x6495ed); // 青
          // 袖
          clothing.roundRect(centerX - 55 * s, centerY - 25 * s, 20 * s, 40 * s, 3 * s);
          clothing.fill(0x6495ed);
          clothing.roundRect(centerX + 35 * s, centerY - 25 * s, 20 * s, 40 * s, 3 * s);
          clothing.fill(0x6495ed);
          break;

        case 'bottom':
          // スカート/パンツ
          clothing.roundRect(centerX - 35 * s, centerY + 30 * s, 70 * s, 50 * s, 3 * s);
          clothing.fill(0xff69b4); // ピンク
          break;

        case 'dress':
          // ワンピース
          clothing.roundRect(centerX - 40 * s, centerY - 30 * s, 80 * s, 110 * s, 5 * s);
          clothing.fill(0x9370db); // 紫
          // 袖
          clothing.roundRect(centerX - 55 * s, centerY - 25 * s, 20 * s, 40 * s, 3 * s);
          clothing.fill(0x9370db);
          clothing.roundRect(centerX + 35 * s, centerY - 25 * s, 20 * s, 40 * s, 3 * s);
          clothing.fill(0x9370db);
          break;

        case 'shoes':
          // 靴
          clothing.roundRect(centerX - 28 * s, centerY + 135 * s, 25 * s, 12 * s, 3 * s);
          clothing.fill(0x8b4513); // 茶色
          clothing.roundRect(centerX + 3 * s, centerY + 135 * s, 25 * s, 12 * s, 3 * s);
          clothing.fill(0x8b4513);
          break;

        case 'accessory':
          // リボン（頭）
          clothing.star(centerX, centerY - 125 * s, 5 * s, 15 * s, 8);
          clothing.fill(0xff1493); // ピンク
          break;
      }

      container.addChild(clothing);
  }

  // リサイズ
  resize(width: number, height: number): void {
    if (this.app && this.initialized && !this.destroyed) {
      this.app.renderer.resize(width, height);
      // リサイズ後に強制再描画
      this.app.render();
    }
  }

  // テクスチャキャッシュをクリア（メモリ解放）
  async clearTextureCache(): Promise<void> {
    try {
      // 未使用のテクスチャをアンロード
      await Assets.unloadBundle('default');
    } catch {
      // バンドルがない場合は無視
    }
    
    // 全キャッシュをリセット
    Assets.reset();
    console.log('テクスチャキャッシュをクリアしました');
  }

  // 特定のテクスチャをアンロード
  async unloadTexture(url: string): Promise<void> {
    try {
      await Assets.unload(url);
    } catch {
      // 存在しない場合は無視
    }
  }

  // クリーンアップ
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.initialized = false;
    this.customFaceUrl = null;
    try {
      this.hiddenDollTexture?.destroy(true);
    } catch {
      // 無視
    }
    this.hiddenDollTexture = null;
    for (const texture of this.clippedTextures) {
      try {
        texture.destroy(true);
      } catch {
        // 無視
      }
    }
    this.clippedTextures = [];

    // コンテナをクリア
    if (this.dollContainer) {
      try {
        this.dollContainer.removeChildren();
      } catch {
        // 無視
      }
      this.dollContainer = null;
    }
    if (this.faceContainer) {
      try {
        this.faceContainer.removeChildren();
      } catch {
        // 無視
      }
      this.faceContainer = null;
    }
    if (this.clothingContainer) {
      try {
        this.clothingContainer.removeChildren();
      } catch {
        // 無視
      }
      this.clothingContainer = null;
    }

    // アプリケーションを破棄
    if (this.app) {
      try {
        // stageが存在する場合のみ破棄
        if (this.app.stage) {
          this.app.destroy(true, { children: true, texture: true });
        }
      } catch {
        // 無視
      }
      this.app = null;
    }
  }

  // スクリーンショットを取得（Data URL）- 横画面は1:1正方形、縦画面は画面全体
  async takeScreenshot(): Promise<string | null> {
    if (!this.app || !this.initialized || this.destroyed) {
      return null;
    }

    try {
      // レンダリングを強制更新
      this.app.render();

      const source = this.app.canvas as HTMLCanvasElement;
      const resolution = this.app.renderer.resolution ?? 1;

      // 横画面モード: 背景領域（1:1正方形）をキャプチャ
      if (this.backgroundArea) {
        const cropX = Math.max(0, Math.round(this.backgroundArea.x * resolution));
        const cropY = Math.max(0, Math.round(this.backgroundArea.y * resolution));
        const cropSize = Math.round(this.backgroundArea.size * resolution);

        const safeX = Math.min(cropX, source.width);
        const safeY = Math.min(cropY, source.height);
        const safeSize = Math.min(cropSize, source.width - safeX, source.height - safeY);

        if (safeSize <= 0) {
          return source.toDataURL('image/png');
        }

        const out = document.createElement('canvas');
        out.width = safeSize;
        out.height = safeSize;
        const ctx = out.getContext('2d');
        if (!ctx) {
          return source.toDataURL('image/png');
        }

        ctx.drawImage(source, safeX, safeY, safeSize, safeSize, 0, 0, safeSize, safeSize);
        return out.toDataURL('image/png');
      }

      // 背景領域がない場合は全体をキャプチャ
      return source.toDataURL('image/png');
    } catch (error) {
      console.error('スクリーンショット取得エラー:', error);
      return null;
    }
  }

  // 初期化済みかどうか
  isInitialized(): boolean {
    return this.initialized && this.app !== null && !this.destroyed;
  }
}
