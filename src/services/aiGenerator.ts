/**
 * AI画像生成サービス
 * 将来的にStable Diffusion / DALL-E / Midjourney APIと連携
 */

export interface AIGenerationRequest {
  prompt: string;
  type: 'doll' | 'top' | 'bottom' | 'dress' | 'shoes' | 'accessory';
  style?: 'cute' | 'cool' | 'elegant' | 'casual';
  color?: string;
}

export interface AIGenerationResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

/**
 * AI画像生成サービスのインターフェース
 * 実際のAPI連携時にこのインターフェースを実装する
 */
export interface AIImageGenerator {
  generate(request: AIGenerationRequest): Promise<AIGenerationResult>;
  isAvailable(): boolean;
}

/**
 * モックAI画像生成サービス（開発・デモ用）
 * 実際のAPIが利用可能になるまでのプレースホルダー
 */
export class MockAIGenerator implements AIImageGenerator {
  private mockImages: Record<string, string[]> = {
    doll: [
      'https://via.placeholder.com/200x300/FFE4C4/333333?text=Doll',
    ],
    top: [
      'https://via.placeholder.com/100x100/6495ED/FFFFFF?text=Top',
      'https://via.placeholder.com/100x100/FF6B6B/FFFFFF?text=Top',
      'https://via.placeholder.com/100x100/98D8C8/FFFFFF?text=Top',
    ],
    bottom: [
      'https://via.placeholder.com/100x100/FF69B4/FFFFFF?text=Bottom',
      'https://via.placeholder.com/100x100/4ECDC4/FFFFFF?text=Bottom',
    ],
    dress: [
      'https://via.placeholder.com/100x150/9370DB/FFFFFF?text=Dress',
      'https://via.placeholder.com/100x150/F7DC6F/333333?text=Dress',
    ],
    shoes: [
      'https://via.placeholder.com/80x40/8B4513/FFFFFF?text=Shoes',
    ],
    accessory: [
      'https://via.placeholder.com/60x60/FF1493/FFFFFF?text=Acc',
    ],
  };

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    // 開発用の遅延シミュレーション
    await new Promise(resolve => setTimeout(resolve, 1000));

    const images = this.mockImages[request.type];
    if (!images || images.length === 0) {
      return {
        success: false,
        error: `No mock images available for type: ${request.type}`,
      };
    }

    // ランダムに画像を選択
    const randomIndex = Math.floor(Math.random() * images.length);
    
    return {
      success: true,
      imageUrl: images[randomIndex],
    };
  }

  isAvailable(): boolean {
    return true; // モックは常に利用可能
  }
}

/**
 * Stable Diffusion API連携（将来実装）
 * 
 * 使用例:
 * const generator = new StableDiffusionGenerator('your-api-key');
 * const result = await generator.generate({
 *   prompt: 'cute pink dress for paper doll, flat design, transparent background',
 *   type: 'dress',
 *   style: 'cute',
 *   color: 'pink'
 * });
 */
export class StableDiffusionGenerator implements AIImageGenerator {
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, apiUrl = 'https://api.stability.ai/v1/generation') {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'API key not configured',
      };
    }

    try {
      // プロンプトを最適化
      const optimizedPrompt = this.buildPrompt(request);
      
      // TODO: 実際のAPI呼び出しを実装
      // const response = await fetch(`${this.apiUrl}/text-to-image`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${this.apiKey}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({
      //     text_prompts: [{ text: optimizedPrompt }],
      //     cfg_scale: 7,
      //     height: 512,
      //     width: 512,
      //     samples: 1,
      //   }),
      // });

      console.log('StableDiffusion prompt:', optimizedPrompt);
      
      return {
        success: false,
        error: 'Stable Diffusion API not yet implemented',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildPrompt(request: AIGenerationRequest): string {
    const basePrompt = request.prompt;
    const typePrompts: Record<string, string> = {
      doll: 'cute paper doll character, full body, simple design, flat illustration style',
      top: 'clothing item, shirt or top, flat design, paper doll style, transparent background',
      bottom: 'clothing item, pants or skirt, flat design, paper doll style, transparent background',
      dress: 'dress clothing item, flat design, paper doll style, transparent background',
      shoes: 'pair of shoes, flat design, paper doll style, transparent background',
      accessory: 'accessory item, flat design, paper doll style, transparent background',
    };

    const stylePrompts: Record<string, string> = {
      cute: 'kawaii, adorable, pastel colors',
      cool: 'stylish, modern, bold colors',
      elegant: 'sophisticated, graceful, refined',
      casual: 'relaxed, comfortable, everyday style',
    };

    let prompt = `${basePrompt}, ${typePrompts[request.type]}`;
    
    if (request.style) {
      prompt += `, ${stylePrompts[request.style]}`;
    }
    
    if (request.color) {
      prompt += `, ${request.color} color`;
    }

    return prompt;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}

/**
 * OpenAI DALL-E API連携（将来実装）
 */
export class DallEGenerator implements AIImageGenerator {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'OpenAI API key not configured',
      };
    }

    // TODO: DALL-E API実装
    console.log('DALL-E generation request:', request);
    
    return {
      success: false,
      error: 'DALL-E API not yet implemented',
    };
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}

/**
 * AIサービスファクトリー
 * 設定に基づいて適切なAI生成サービスを返す
 */
export function createAIGenerator(config?: {
  provider?: 'mock' | 'stable-diffusion' | 'dall-e';
  apiKey?: string;
}): AIImageGenerator {
  const provider = config?.provider ?? 'mock';

  switch (provider) {
    case 'stable-diffusion':
      return new StableDiffusionGenerator(config?.apiKey ?? '');
    case 'dall-e':
      return new DallEGenerator(config?.apiKey ?? '');
    case 'mock':
    default:
      return new MockAIGenerator();
  }
}
