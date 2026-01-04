/**
 * PixiJS描画エンジン
 * ドールと服のレンダリングを担当
 */
import { Application, Container, Graphics, Sprite, Assets } from 'pixi.js';
import type { ClothingItemData, DollConfig, EquippedItem } from '../types';

export class PixiEngine {
  private app: Application | null = null;
  private dollContainer: Container | null = null;
  private clothingContainer: Container | null = null;
  private faceContainer: Container | null = null;
  private initialized = false;
  private destroyed = false;
  private customFaceUrl: string | null = null;

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
        backgroundColor: 0xfff5ee, // 薄いピンクベージュの背景
        antialias: true,
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

  // ドールを描画（画像URLがあれば画像、なければプレースホルダー）
  async drawDoll(config: DollConfig): Promise<void> {
    if (!this.dollContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存のドールをクリア
    this.dollContainer.removeChildren();

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;

    // 画像URLが指定されていて、カスタム顔がない場合は画像を読み込む
    if (config.imageUrl) {
      try {
        const texture = await Assets.load(config.imageUrl);
        const dollSprite = new Sprite(texture);

        // キャンバスに収まるようにスケーリング（高さの90%に合わせる）
        const maxHeight = this.app.screen.height * 0.9;
        const scale = maxHeight / texture.height;
        dollSprite.scale.set(scale);

        // 中心に配置
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

    // 頭（円）- カスタム顔がない場合のみ描画
    if (!this.customFaceUrl) {
      doll.circle(centerX, centerY - 80, 40);
      doll.fill(0xffe4c4); // 肌色
    }

    // 体（楕円風の四角形）
    doll.roundRect(centerX - 35, centerY - 30, 70, 100, 10);
    doll.fill(0xffe4c4);

    // 腕
    doll.roundRect(centerX - 55, centerY - 20, 20, 60, 5);
    doll.fill(0xffe4c4);
    doll.roundRect(centerX + 35, centerY - 20, 20, 60, 5);
    doll.fill(0xffe4c4);

    // 脚
    doll.roundRect(centerX - 25, centerY + 70, 20, 70, 5);
    doll.fill(0xffe4c4);
    doll.roundRect(centerX + 5, centerY + 70, 20, 70, 5);
    doll.fill(0xffe4c4);

    // 顔（目）- カスタム顔がない場合のみ
    if (!this.customFaceUrl) {
      doll.circle(centerX - 12, centerY - 85, 5);
      doll.fill(0x333333);
      doll.circle(centerX + 12, centerY - 85, 5);
      doll.fill(0x333333);

      // 口（笑顔）
      doll.arc(centerX, centerY - 70, 15, 0.1, Math.PI - 0.1);
      doll.stroke({ width: 2, color: 0xff6b6b });
    }

    this.dollContainer.addChild(doll);
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

  // 服を描画（プレースホルダー）
  drawClothing(items: (ClothingItemData | EquippedItem)[]): void {
    if (!this.clothingContainer || !this.app || !this.initialized || this.destroyed) {
      return;
    }

    // 既存の服をクリア
    this.clothingContainer.removeChildren();

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;

    // 既にソートされていることを想定（useDressUpでソート済み）
    items.forEach((item) => {
      const clothing = new Graphics();

      switch (item.type) {
        case 'underwear_top':
          // 白いキャミソール
          clothing.roundRect(centerX - 30, centerY - 25, 60, 45, 5);
          clothing.fill(0xffffff);
          clothing.stroke({ width: 1, color: 0xdddddd });
          // ストラップ
          clothing.moveTo(centerX - 20, centerY - 25);
          clothing.lineTo(centerX - 15, centerY - 40);
          clothing.stroke({ width: 3, color: 0xffffff });
          clothing.moveTo(centerX + 20, centerY - 25);
          clothing.lineTo(centerX + 15, centerY - 40);
          clothing.stroke({ width: 3, color: 0xffffff });
          break;

        case 'underwear_bottom':
          // 白いショーツ
          clothing.roundRect(centerX - 25, centerY + 30, 50, 30, 5);
          clothing.fill(0xffffff);
          clothing.stroke({ width: 1, color: 0xdddddd });
          break;

        case 'top':
          // Tシャツ
          clothing.roundRect(centerX - 40, centerY - 30, 80, 60, 5);
          clothing.fill(0x6495ed); // 青
          // 袖
          clothing.roundRect(centerX - 55, centerY - 25, 20, 40, 3);
          clothing.fill(0x6495ed);
          clothing.roundRect(centerX + 35, centerY - 25, 20, 40, 3);
          clothing.fill(0x6495ed);
          break;

        case 'bottom':
          // スカート/パンツ
          clothing.roundRect(centerX - 35, centerY + 30, 70, 50, 3);
          clothing.fill(0xff69b4); // ピンク
          break;

        case 'dress':
          // ワンピース
          clothing.roundRect(centerX - 40, centerY - 30, 80, 110, 5);
          clothing.fill(0x9370db); // 紫
          // 袖
          clothing.roundRect(centerX - 55, centerY - 25, 20, 40, 3);
          clothing.fill(0x9370db);
          clothing.roundRect(centerX + 35, centerY - 25, 20, 40, 3);
          clothing.fill(0x9370db);
          break;

        case 'shoes':
          // 靴
          clothing.roundRect(centerX - 28, centerY + 135, 25, 12, 3);
          clothing.fill(0x8b4513); // 茶色
          clothing.roundRect(centerX + 3, centerY + 135, 25, 12, 3);
          clothing.fill(0x8b4513);
          break;

        case 'accessory':
          // リボン（頭）
          clothing.star(centerX, centerY - 125, 5, 15, 8);
          clothing.fill(0xff1493); // ピンク
          break;
      }

      this.clothingContainer!.addChild(clothing);
    });
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

  // 初期化済みかどうか
  isInitialized(): boolean {
    return this.initialized && this.app !== null && !this.destroyed;
  }
}
