/**
 * PixiJS描画エンジン
 * ドールと服のレンダリングを担当
 * フィルターなし版（パフォーマンス最優先）
 */
import { Application, Container, Graphics, Sprite, Assets, ColorMatrixFilter } from 'pixi.js';
import type { ClothingItemData, DollConfig, EquippedItem, DollTransform } from '../types';

export class PixiEngine {
  private app: Application | null = null;
  private backgroundContainer: Container | null = null;
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
  private isPortrait = false; // 縦画面モード
  private tickerRunning = true; // Tickerが動作中かどうか
  private clothingCached = false; // 服コンテナがキャッシュ済みか

  // 初期化
  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    if (this.initialized || this.destroyed) {
      return;
    }

    try {
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
      console.warn('WebGLコンテキストがロストしました');
    });

    // コンテキストが復元された時
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGLコンテキストが復元されました');
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

  // 縦画面モードを設定
  setPortraitMode(isPortrait: boolean): void {
    this.isPortrait = isPortrait;
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
      const texture = await Assets.load(imageUrl);
      
      // パフォーマンス最適化: テクスチャのスケールモードを設定
      // 縮小表示時の品質を維持しつつGPU負荷を軽減
      texture.source.scaleMode = 'linear';
      
      const bgSprite = new Sprite(texture);

      const area = this.getAvailableArea();

      // 背景は1:1正方形で画面縦幅いっぱいに表示
      const bgSize = this.app.screen.height;
      const scale = bgSize / Math.max(texture.width, texture.height);
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
      mask.rect(this.backgroundArea.x, this.backgroundArea.y, bgSize, bgSize);
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

  // ドールを描画（画像URLがあれば画像、なければプレースホルダー）
  async drawDoll(config: DollConfig): Promise<void> {
    if (!this.dollContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存のドールをクリア
    this.dollContainer.removeChildren();

    // 背景領域の中心を基準にドール位置を計算
    const bgCenter = this.getBackgroundCenter();
    // dollTransformのx,yは背景領域内での%位置（50%=中央）
    const centerX = bgCenter.centerX + ((this.dollTransform.x - 50) / 100) * bgCenter.size;
    const centerY = bgCenter.centerY + ((this.dollTransform.y - 50) / 100) * bgCenter.size;
    const dollScale = this.dollTransform.scale;

    // 画像URLが指定されていて、カスタム顔がない場合は画像を読み込む
    if (config.imageUrl && config.imageUrl.length > 0) {
      try {
        const texture = await Assets.load(config.imageUrl);
        // 縮小時の画質向上：リニア補間を使用
        texture.source.scaleMode = 'linear';
        const dollSprite = new Sprite(texture);

        // キャンバスに収まるようにスケーリング（高さの90%に合わせてから、ドールスケールを適用）
        // 縦画面モードではメニューバー分を考慮して小さめに
        const heightRatio = this.isPortrait ? 0.75 : 0.9;
        const maxHeight = this.app.screen.height * heightRatio;
        const baseScale = maxHeight / texture.height;
        dollSprite.scale.set(baseScale * dollScale);

        // 位置を設定
        dollSprite.anchor.set(0.5);
        dollSprite.x = centerX;
        dollSprite.y = centerY;

        // フィルターなし（画像は透過PNG前提）

        this.dollContainer.addChild(dollSprite);
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

  // 服を描画（imageUrlがあれば画像、なければプレースホルダー）
  async drawClothing(items: (ClothingItemData | EquippedItem)[]): Promise<void> {
    if (!this.clothingContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 背景領域の中心を基準に服の位置を計算
    const bgCenter = this.getBackgroundCenter();
    const centerX = bgCenter.centerX + ((this.dollTransform.x - 50) / 100) * bgCenter.size;
    const centerY = bgCenter.centerY + ((this.dollTransform.y - 50) / 100) * bgCenter.size;
    const s = this.dollTransform.scale; // スケール

    // 新しい一時コンテナを作成（全ロード完了後に一括表示するため）
    const tempContainer = new Container();
    tempContainer.label = 'tempClothingContainer';

    // 全アイテムのテクスチャを並列で先にロード（ラグ解消）
    const loadPromises = items.map(async (item) => {
      if (item.imageUrl) {
        try {
          // キャッシュ済みならすぐに返る
          const texture = await Assets.load(item.imageUrl);
          return { item, texture, error: null };
        } catch (error) {
          return { item, texture: null, error };
        }
      }
      return { item, texture: null, error: null };
    });

    const loadedItems = await Promise.all(loadPromises);

    // 破棄チェック（ロード中に破棄された場合）
    if (this.destroyed || !this.clothingContainer) {
      tempContainer.destroy({ children: true });
      return;
    }

    // ロード完了後、一時コンテナに描画
    for (const { item, texture, error } of loadedItems) {
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

      // テクスチャがロード済みの場合はスプライトを作成
      if (texture) {
        // 縮小時の画質向上：リニア補間を使用
        texture.source.scaleMode = 'linear';
        const clothingSprite = new Sprite(texture);

        // 服のサイズをドールと同じスケーリング
        // 縦画面モードではメニューバー分を考慮して小さめに
        const heightRatio = this.isPortrait ? 0.75 : 0.9;
        const maxHeight = this.app.screen.height * heightRatio;
        const baseScale = maxHeight / texture.height;
        // 調整スケールを適用
        clothingSprite.scale.set(baseScale * s * adjustScale);

        // アンカーを中央に
        clothingSprite.anchor.set(0.5);

        // 位置を設定
        clothingSprite.x = itemX;
        clothingSprite.y = itemY;
        
        // 回転を適用（度からラジアンに変換）
        clothingSprite.rotation = (adjustRotation * Math.PI) / 180;

        // 色相フィルター（colorHueが設定されている場合のみ個別適用）
        const colorHue = (item as EquippedItem).colorHue ?? 0;
        if (colorHue !== 0) {
          const hueFilter = new ColorMatrixFilter();
          hueFilter.hue(colorHue, false);
          // 解像度をデバイスに合わせる（画質維持）
          hueFilter.resolution = window.devicePixelRatio || 1;
          // パディングを0にして位置ずれを防止
          hueFilter.padding = 0;
          clothingSprite.filters = [hueFilter];
        }

        tempContainer.addChild(clothingSprite);
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
    
    while (tempContainer.children.length > 0) {
      const child = tempContainer.children[0];
      tempContainer.removeChild(child);
      this.clothingContainer.addChild(child);
    }
    tempContainer.destroy();

    // 描画後に服コンテナをテクスチャにキャッシュ（大幅な軽量化）
    this.cacheClothingContainer();
  }

  // 服コンテナをテクスチャにキャッシュ（パフォーマンス大幅改善）
  private cacheClothingContainer(): void {
    if (!this.clothingContainer || !this.app) return;
    
    // 一旦キャッシュを解除（変更を反映するため）
    if (this.clothingCached) {
      this.clothingContainer.cacheAsTexture(false);
      this.clothingCached = false;
    }
    
    // 服が1枚以上ある場合のみキャッシュ
    if (this.clothingContainer.children.length > 0) {
      // 1フレーム描画してからキャッシュ（フィルター適用後の状態を焼き込む）
      this.app.render();
      this.clothingContainer.cacheAsTexture(true);
      this.clothingCached = true;
      console.log('服コンテナをキャッシュしました（フィルター処理軽減）');
    }
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

      // 縦画面モード: 画面全体（縦長）をキャプチャ
      if (this.isPortrait) {
        const cropWidth = Math.round(this.app.screen.width * resolution);
        const cropHeight = Math.round(this.app.screen.height * resolution);

        const out = document.createElement('canvas');
        out.width = cropWidth;
        out.height = cropHeight;
        const ctx = out.getContext('2d');
        if (!ctx) {
          return source.toDataURL('image/png');
        }

        ctx.drawImage(source, 0, 0, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        return out.toDataURL('image/png');
      }

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

  // フィルター関連（互換性のためダミーメソッドを残す）
  setChromaKeyEnabled(_enabled: boolean): void {
    // フィルター削除済み - 何もしない
  }

  setEdgeTrimEnabled(_enabled: boolean): void {
    // フィルター削除済み - 何もしない
  }

  isChromaKeyEnabled(): boolean {
    return false; // フィルター削除済み
  }

  setChromaKeyParams(_params: { keyColor?: number; threshold?: number; smoothing?: number }): void {
    // フィルター削除済み - 何もしない
  }
}
