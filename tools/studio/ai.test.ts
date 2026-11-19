// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiError, createGemini } from './ai.ts';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('createGemini', () => {
  it('公式の形で呼び、返答の画像を取り出す', async () => {
    let seen: { url: string; headers: Record<string, string>; body: { model: string; input: { type: string; data?: string; text?: string }[]; response_format: object } } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'ok' }, { type: 'image', data: Buffer.from('PNG!').toString('base64') }] }] }));
    }) as unknown as typeof fetch;
    const image = await createGemini('KEY', 'gemini-nano-banana-2.1', fake).generate({ prompt: 'a hat', images: [Buffer.from('ref')] });
    expect(image.toString()).toBe('PNG!');
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(seen!.headers['x-goog-api-key']).toBe('KEY');
    expect(seen!.body.model).toBe('gemini-nano-banana-2.1');
    expect(seen!.body.input).toEqual([{ type: 'image', mime_type: 'image/png', data: Buffer.from('ref').toString('base64') }, { type: 'text', text: 'a hat' }]);
    expect(seen!.body.response_format).toEqual({ type: 'image', aspect_ratio: '1:1', image_size: '1K' }); // 既定は 1K（値段を抑える）
  });
  it('画像が無い返答は、やり直せるエラー。キーの誤りと利用制限は、やり直さない', async () => {
    const none = await createGemini('k', 'm', reply(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'no' }] }] })).generate({ prompt: 'x', images: [] }).catch((e: AiError) => e);
    expect(none).toMatchObject({ status: 422, retryable: true });
    const key = await createGemini('k', 'm', reply(403, { error: { message: 'bad key' } })).generate({ prompt: 'x', images: [] }).catch((e: AiError) => e);
    expect(key).toMatchObject({ status: 500, retryable: false });
    const limit = await createGemini('k', 'm', reply(429, {})).generate({ prompt: 'x', images: [] }).catch((e: AiError) => e);
    expect(limit).toMatchObject({ status: 429, retryable: false });
  });
  it('月の上限額に達したときは、待っても直らないことが分かる文にする', async () => {
    const cap = await createGemini('k', 'm', reply(429, { error: { message: 'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.', code: 'too_many_requests' } }))
      .generate({ prompt: 'x', images: [] })
      .catch((e: AiError) => e);
    expect(cap).toMatchObject({ status: 429, retryable: false });
    expect((cap as AiError).message).toMatch(/月の上限額/);
    expect((cap as AiError).message).not.toMatch(/少し待って/);
  });
  it('内容の決まりで断られたときは、書き直しの対象として印を付ける', async () => {
    const blocked = await createGemini('k', 'm', reply(400, { error: { message: 'Request blocked due to prohibited content guidelines. Please modify your input and retry' } }))
      .generate({ prompt: 'x', images: [] })
      .catch((e: AiError) => e);
    expect(blocked).toMatchObject({ status: 422, retryable: false, blocked: true });
    const other = await createGemini('k', 'm', reply(400, { error: { message: 'bad request' } })).generate({ prompt: 'x', images: [] }).catch((e: AiError) => e);
    expect(other).toMatchObject({ blocked: false });
  });
});
