/**
 * AI の呼び出し（文章 = Claude API、画像 = Gemini API）
 *
 * キーはサーバー側の環境変数に置く（ANTHROPIC_API_KEY、GEMINI_API_KEY）。画面には渡さない。
 * テストでは、この interface を満たす偽物を差し込む。
 */
import Anthropic from '@anthropic-ai/sdk';

export class AiError extends Error {
  readonly status: number;
  readonly retryable: boolean; // 同じ依頼をもう一度出す意味があるか（画像が返らなかった、など）
  constructor(message: string, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export interface TextAi {
  // 指示と画像（任意）を渡し、schema に合う JSON を受け取る
  json<T>(input: { system: string; prompt: string; images?: Buffer[]; schema: Record<string, unknown> }): Promise<T>;
}

export interface ImageAi {
  // 指示と参考画像（PNG）を渡し、できた画像を受け取る
  generate(input: { prompt: string; images: Buffer[] }): Promise<Buffer>;
}

export interface AiClients {
  text: TextAi | null; // キーが無ければ null
  image: ImageAi | null;
}

export function createClaude(apiKey: string, model: string): TextAi {
  const client = new Anthropic({ apiKey });
  return {
    async json<T>(input: { system: string; prompt: string; images?: Buffer[]; schema: Record<string, unknown> }): Promise<T> {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        ...(input.images ?? []).map(
          (data): Anthropic.Beta.BetaImageBlockParam => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: data.toString('base64') },
          }),
        ),
        { type: 'text', text: input.prompt },
      ];
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          // 安全上の理由で断られたときは、API 側で別のモデルに切り替えてやり直す
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: input.system,
          messages: [{ role: 'user', content }],
          output_config: { format: { type: 'json_schema', schema: input.schema } },
        });
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) throw new AiError('Claude API のキーが正しくありません（ANTHROPIC_API_KEY）', 500);
        if (error instanceof Anthropic.RateLimitError) throw new AiError('Claude API の利用制限に達しました。少し待ってからやり直してください', 429);
        if (error instanceof Anthropic.APIError) throw new AiError(`Claude API のエラー（${error.status ?? '接続'}）: ${error.message}`);
        throw error;
      }
      if (response.stop_reason === 'refusal') throw new AiError('Claude API がこの依頼を受け付けませんでした。テーマを変えてみてください', 422);
      if (response.stop_reason === 'max_tokens') throw new AiError('Claude API の返答が長すぎて途中で切れました。品目数を減らしてください');
      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
      if (!text) throw new AiError('Claude API から返答がありませんでした');
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AiError('Claude API の返答を読み取れませんでした');
      }
    },
  };
}

interface GeminiBlock {
  type?: string;
  data?: string;
}
interface GeminiInteraction {
  steps?: { type?: string; content?: GeminiBlock[] }[];
  output_image?: GeminiBlock; // SDK が付ける近道。REST の返答に入っていれば使う
  status?: string;
  error?: { message?: string };
}

/**
 * Gemini の画像生成（Interactions API、REST）。
 * 形は公式の説明（https://ai.google.dev/gemini-api/docs/image-generation、2026-11-16 確認）に合わせた:
 *   POST /v1beta/interactions、input に画像と文章を並べ、response_format で正方形の画像だけを求める。
 * 実際のキーではまだ呼んでいない。モデル名は環境変数 STUDIO_GEMINI_MODEL で変えられる。
 */
export function createGemini(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): ImageAi {
  return {
    async generate(input: { prompt: string; images: Buffer[] }): Promise<Buffer> {
      const body = {
        model,
        input: [
          ...input.images.map((data) => ({ type: 'image', mime_type: 'image/png', data: data.toString('base64') })),
          { type: 'text', text: input.prompt },
        ],
        response_format: { type: 'image', aspect_ratio: '1:1', image_size: '2K' },
      };
      let response: Response;
      try {
        response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, 'api-revision': '2026-05-20' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) {
        throw new AiError(`Gemini API に接続できませんでした（${(error as Error).message}）`);
      }
      const json = (await response.json().catch(() => ({}))) as GeminiInteraction;
      if (!response.ok) {
        if (response.status === 429) throw new AiError('Gemini API の利用制限に達しました。少し待ってからやり直してください', 429);
        if (response.status === 401 || response.status === 403) throw new AiError('Gemini API のキーが正しくありません（GEMINI_API_KEY）', 500);
        throw new AiError(`Gemini API のエラー（${response.status}）: ${json.error?.message ?? '詳細なし'}`);
      }
      // 最後に出てきた画像を使う
      let data = json.output_image?.data;
      for (const step of json.steps ?? []) {
        if (step.type !== 'model_output') continue;
        for (const block of step.content ?? []) if (block.type === 'image' && block.data) data = block.data;
      }
      if (data) return Buffer.from(data, 'base64');
      throw new AiError(`Gemini API が画像を返しませんでした（${json.status ?? '理由なし'}）`, 422, true);
    },
  };
}

export function createAiFromEnv(env: NodeJS.ProcessEnv = process.env): AiClients {
  return {
    text: env.ANTHROPIC_API_KEY ? createClaude(env.ANTHROPIC_API_KEY, env.STUDIO_CLAUDE_MODEL || 'claude-opus-5-5') : null,
    image: env.GEMINI_API_KEY ? createGemini(env.GEMINI_API_KEY, env.STUDIO_GEMINI_MODEL || 'gemini-nano-banana-2.1') : null,
  };
}
