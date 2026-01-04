/**
 * PixiJS描画エンジン
 * ドールと服のレンダリングを担当
 */
import { Application, Container, Graphics } from 'pixi.js';
import type { ClothingItemData, DollConfig } from '../types';

export class PixiEngine {
  private app: Application | null = null;
  private dollContainer: Container | null = null;
  private clothingContainer: Container | null = null;
  private initialized = false;
  private destroyed = false;

  // 初期化
  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    if (this.initialized || this.destroyed) {
      console.log('[PixiEngine] Already initialized or destroyed, skipping init');
      return;
    }

    try {
      console.log('[PixiEngine] Starting initialization...');
      this.app = new Application();
      await this.app.init({
        canvas,
        width,
        height,
        backgroundColor: 0xfff5ee, // 薄いピンクベージュの背景
        antialias: true,
      });
      console.log('[PixiEngine] Application initialized');

      // 既に破棄されていたら処理を中止
      if (this.destroyed) {
        console.log('[PixiEngine] Destroyed during init, cleaning up');
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

      // 服用コンテナ（ドールの上に表示）
      this.clothingContainer = new Container();
      this.clothingContainer.label = 'clothingContainer';
      this.app.stage.addChild(this.clothingContainer);

      this.initialized = true;
      console.log('[PixiEngine] Initialization complete');
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
    if (this.app) {
      try {
        this.app.destroy(true, { children: true });
      } catch {
        // 無視
      }
      this.app = null;
    }
  }

  // ドールを描画（プレースホルダー）
  drawDoll(_config: DollConfig): void {
    if (!this.dollContainer || !this.app || !this.initialized || this.destroyed) {
      console.log('[PixiEngine] drawDoll: Not ready', {
        dollContainer: !!this.dollContainer,
        app: !!this.app,
        initialized: this.initialized,
        destroyed: this.destroyed
      });
      return;
    }

    console.log('[PixiEngine] Drawing doll...');

    // 既存のドールをクリア
    this.dollContainer.removeChildren();

    // プレースホルダーとしてシンプルな人形を描画
    const doll = new Graphics();

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;

    // 頭（円）
    doll.circle(centerX, centerY - 80, 40);
    doll.fill(0xffe4c4); // 肌色

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

    // 顔（目）
    doll.circle(centerX - 12, centerY - 85, 5);
    doll.fill(0x333333);
    doll.circle(centerX + 12, centerY - 85, 5);
    doll.fill(0x333333);

    // 口（笑顔）
    doll.arc(centerX, centerY - 70, 15, 0.1, Math.PI - 0.1);
    doll.stroke({ width: 2, color: 0xff6b6b });

    this.dollContainer.addChild(doll);
    console.log('[PixiEngine] Doll drawn successfully');
  }

  // 服を描画（プレースホルダー）
  drawClothing(items: ClothingItemData[]): void {
    if (!this.clothingContainer || !this.app || !this.initialized || this.destroyed) {
      console.log('[PixiEngine] drawClothing: Not ready');
      return;
    }

    console.log('[PixiEngine] Drawing clothing:', items.length, 'items');

    // 既存の服をクリア
    this.clothingContainer.removeChildren();

    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;

    // zIndex順にソートして描画
    const sortedItems = [...items].sort((a, b) => a.zIndex - b.zIndex);

    sortedItems.forEach((item) => {
      const clothing = new Graphics();

      switch (item.type) {
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
      console.log('[PixiEngine] Already destroyed, skipping');
      return;
    }

    console.log('[PixiEngine] Destroying...');
    this.destroyed = true;
    this.initialized = false;

    // コンテナをクリア
    if (this.dollContainer) {
      try {
        this.dollContainer.removeChildren();
      } catch {
        // 無視
      }
      this.dollContainer = null;
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
      } catch (e) {
        console.log('[PixiEngine] Error during destroy (ignored):', e);
      }
      this.app = null;
    }
    console.log('[PixiEngine] Destroyed');
  }

  // 初期化済みかどうか
  isInitialized(): boolean {
    return this.initialized && this.app !== null && !this.destroyed;
  }
}
