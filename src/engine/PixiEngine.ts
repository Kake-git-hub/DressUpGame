/**
 * PixiJS描画エンジン
 * ドールと服のレンダリングを担当
 */
import { Application, Container, Graphics, Sprite, Assets } from 'pixi.js';
import type { ClothingItemData, DollConfig, EquippedItem, DollTransform } from '../types';
import { ChromaKeyFilter } from './ChromaKeyFilter';

export class PixiEngine {
  private app: Application | null = null;
  private backgroundContainer: Container | null = null;
  private dollContainer: Container | null = null;
  private clothingContainer: Container | null = null;
  private faceContainer: Container | null = null;
  private initialized = false;
  private destroyed = false;
  private customFaceUrl: string | null = null;
  private dollTransform: DollTransform = { x: 50, y: 50, scale: 1.0 }; // %単位、中央
  private menuOffset = 0; // メニュー幅オフセット（背景中心調整用）
  private chromaKeyFilter: ChromaKeyFilter | null = null; // クロマキーフィルタ
  private chromaKeyEnabled = false; // クロマキー有効フラグ

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
  }

  // メニューオフセットを設定（背景位置調整用）
  setMenuOffset(offset: number): void {
    this.menuOffset = offset;
  }

  // 背景を設定
  async setBackground(imageUrl: string | null): Promise<void> {
    if (!this.backgroundContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存の背景をクリア
    this.backgroundContainer.removeChildren();

    if (!imageUrl) {
      return;
    }

    try {
      const texture = await Assets.load(imageUrl);
      const bgSprite = new Sprite(texture);

      const availableWidth = Math.max(0, this.app.screen.width - this.menuOffset);

      // ドール領域（メニュー以外）をカバーするようにスケーリング
      const scaleX = availableWidth / texture.width;
      const scaleY = this.app.screen.height / texture.height;
      const scale = Math.max(scaleX, scaleY);
      bgSprite.scale.set(scale);

      // ドール領域の中心に配置
      bgSprite.anchor.set(0.5);
      bgSprite.x = this.menuOffset + availableWidth / 2;
      bgSprite.y = this.app.screen.height / 2;

      // メニュー領域をマスクして背景が被らないようにする
      const mask = new Graphics();
      mask.rect(this.menuOffset, 0, availableWidth, this.app.screen.height);
      mask.fill(0xffffff);
      bgSprite.mask = mask;

      this.backgroundContainer.addChild(bgSprite);
      this.backgroundContainer.addChild(mask);
    } catch (error) {
      console.warn('背景画像の読み込みに失敗:', error);
    }
  }

  // ドールを描画（画像URLがあれば画像、なければプレースホルダー）
  async drawDoll(config: DollConfig): Promise<void> {
    if (!this.dollContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存のドールをクリア
    this.dollContainer.removeChildren();

    // 位置をパーセントからピクセルに変換
    const centerX = (this.app.screen.width * this.dollTransform.x) / 100;
    const centerY = (this.app.screen.height * this.dollTransform.y) / 100;
    const dollScale = this.dollTransform.scale;

    // 画像URLが指定されていて、カスタム顔がない場合は画像を読み込む
    if (config.imageUrl && config.imageUrl.length > 0) {
      try {
        const texture = await Assets.load(config.imageUrl);
        // 縮小時の画質向上：リニア補間を使用
        texture.source.scaleMode = 'linear';
        const dollSprite = new Sprite(texture);

        // キャンバスに収まるようにスケーリング（高さの90%に合わせてから、ドールスケールを適用）
        const maxHeight = this.app.screen.height * 0.9;
        const baseScale = maxHeight / texture.height;
        dollSprite.scale.set(baseScale * dollScale);

        // 位置を設定
        dollSprite.anchor.set(0.5);
        dollSprite.x = centerX;
        dollSprite.y = centerY;

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

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;

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

    // 既存の服をクリア
    this.clothingContainer.removeChildren();

    // 位置をパーセントからピクセルに変換
    const centerX = (this.app.screen.width * this.dollTransform.x) / 100;
    const centerY = (this.app.screen.height * this.dollTransform.y) / 100;
    const s = this.dollTransform.scale; // スケール

    // 既にソートされていることを想定（useDressUpでソート済み）
    for (const item of items) {
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
        // ドロップ位置をピクセルに変換
        itemX = (this.app.screen.width * (50 + offsetX)) / 100;
        itemY = (this.app.screen.height * (50 + offsetY)) / 100;
      }
      
      // 調整オフセットを適用（ピクセル単位）
      itemX += adjustOffsetX;
      itemY += adjustOffsetY;

      // imageUrlがある場合は画像を読み込み
      if (item.imageUrl) {
        try {
          const texture = await Assets.load(item.imageUrl);
          // 縮小時の画質向上：リニア補間を使用
          texture.source.scaleMode = 'linear';
          const clothingSprite = new Sprite(texture);

          // 服のサイズをドールと同じスケーリング（キャンバス高さの90%基準）
          const maxHeight = this.app.screen.height * 0.9;
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

          // クロマキーフィルタを適用（有効な場合）
          if (this.chromaKeyEnabled && this.chromaKeyFilter) {
            clothingSprite.filters = [this.chromaKeyFilter];
          }

          this.clothingContainer!.addChild(clothingSprite);
        } catch (error) {
          console.warn(`服画像の読み込みに失敗 (${item.name}):`, error);
          // 画像読み込み失敗時はプレースホルダーを表示
          this.drawClothingPlaceholder(item, itemX, itemY, s);
        }
      } else {
        // imageUrlがない場合はプレースホルダー
        this.drawClothingPlaceholder(item, itemX, itemY, s);
      }
    }
  }

  // 服のプレースホルダーを描画
  private drawClothingPlaceholder(
    item: ClothingItemData | EquippedItem,
    centerX: number,
    centerY: number,
    s: number
  ): void {
    if (!this.clothingContainer) return;
    
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

      this.clothingContainer.addChild(clothing);
  }

  // リサイズ
  resize(width: number, height: number): void {
    if (this.app && this.initialized && !this.destroyed) {
      this.app.renderer.resize(width, height);
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

  // スクリーンショットを取得（Data URL）- ドールと背景を中央に配置
  async takeScreenshot(): Promise<string | null> {
    if (!this.app || !this.initialized || this.destroyed) {
      return null;
    }

    try {
      // 現在のドール位置を保存
      const savedTransform = { ...this.dollTransform };
      const savedMenuOffset = this.menuOffset;
      
      // 一時的に中央に配置
      this.dollTransform = { x: 50, y: 50, scale: savedTransform.scale };
      this.menuOffset = 0;
      
      // 背景を中央に再描画
      if (this.backgroundContainer && this.backgroundContainer.children.length > 0) {
        const bgSprite = this.backgroundContainer.children[0];
        if (bgSprite && 'anchor' in bgSprite) {
          (bgSprite as Sprite).x = this.app.screen.width / 2;
        }
      }
      
      // ドールと服を中央に再描画するため、一度描画を更新
      // (実際の再描画は呼び出し側で行う想定だが、位置だけ調整)
      const centerX = this.app.screen.width / 2;
      const centerY = this.app.screen.height / 2;
      
      // ドールコンテナ内のスプライトを中央に移動
      if (this.dollContainer) {
        for (const child of this.dollContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = centerX;
            (child as Sprite).y = centerY;
          }
        }
      }
      
      // 顔コンテナ内のスプライトを中央に移動
      if (this.faceContainer) {
        for (const child of this.faceContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = centerX;
            (child as Sprite).y = centerY - 80 * savedTransform.scale;
          }
        }
      }
      
      // 服コンテナ内のスプライトを中央に移動
      if (this.clothingContainer) {
        for (const child of this.clothingContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = centerX;
            (child as Sprite).y = centerY;
          }
        }
      }
      
      // レンダリングを強制更新
      this.app.render();
      
      // rendererからキャンバスをキャプチャ
      const canvas = this.app.canvas as HTMLCanvasElement;
      const dataUrl = canvas.toDataURL('image/png');
      
      // 元の位置に戻す
      this.dollTransform = savedTransform;
      this.menuOffset = savedMenuOffset;
      
      // 位置を元に戻す
      const originalCenterX = (this.app.screen.width * savedTransform.x) / 100;
      const originalCenterY = (this.app.screen.height * savedTransform.y) / 100;
      
      if (this.backgroundContainer && this.backgroundContainer.children.length > 0) {
        const bgSprite = this.backgroundContainer.children[0];
        if (bgSprite && 'anchor' in bgSprite) {
          (bgSprite as Sprite).x = this.app.screen.width / 2 + savedMenuOffset / 2;
        }
      }
      
      if (this.dollContainer) {
        for (const child of this.dollContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = originalCenterX;
            (child as Sprite).y = originalCenterY;
          }
        }
      }
      
      if (this.faceContainer) {
        for (const child of this.faceContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = originalCenterX;
            (child as Sprite).y = originalCenterY - 80 * savedTransform.scale;
          }
        }
      }
      
      if (this.clothingContainer) {
        for (const child of this.clothingContainer.children) {
          if ('anchor' in child) {
            (child as Sprite).x = originalCenterX;
            (child as Sprite).y = originalCenterY;
          }
        }
      }
      
      // 元の表示に戻す
      this.app.render();
      
      return dataUrl;
    } catch (error) {
      console.error('スクリーンショット取得エラー:', error);
      return null;
    }
  }

  // 初期化済みかどうか
  isInitialized(): boolean {
    return this.initialized && this.app !== null && !this.destroyed;
  }

  // クロマキーフィルタの有効/無効を設定
  setChromaKeyEnabled(enabled: boolean): void {
    this.chromaKeyEnabled = enabled;
    if (enabled && !this.chromaKeyFilter) {
      // フィルタを作成（RGB(0, 255, 0) のグリーンバック用）
      this.chromaKeyFilter = new ChromaKeyFilter({
        keyColor: 0x00FF00,
        threshold: 0.4,   // 色の許容範囲
        smoothing: 0.15,  // エッジのスムージング
        spillRemoval: 0.8, // スピル除去強度
      });
    }
  }

  // クロマキーフィルタが有効かどうか
  isChromaKeyEnabled(): boolean {
    return this.chromaKeyEnabled;
  }

  // クロマキーフィルタのパラメータを設定
  setChromaKeyParams(params: { keyColor?: number; threshold?: number; smoothing?: number }): void {
    if (!this.chromaKeyFilter) {
      this.chromaKeyFilter = new ChromaKeyFilter(params);
    } else {
      if (params.keyColor !== undefined) {
        this.chromaKeyFilter.keyColor = params.keyColor;
      }
      if (params.threshold !== undefined) {
        this.chromaKeyFilter.threshold = params.threshold;
      }
      if (params.smoothing !== undefined) {
        this.chromaKeyFilter.smoothing = params.smoothing;
      }
    }
  }
}
