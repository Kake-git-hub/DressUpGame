// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AiError, createAiFromEnv, createGemini, createGeminiText } from './ai.ts';

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

describe('createGeminiText（文章の AI を Gemini で）', () => {
  const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } } }, required: ['items'], additionalProperties: false };
  it('公式の形で呼び、最後の返答の文章を JSON として返す', async () => {
    let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'thought', signature: 'x' }, { type: 'model_output', content: [{ type: 'text', text: '{"items":[{"name":"ぼうし"}]}' }] }] }));
    }) as unknown as typeof fetch;
    const result = await createGeminiText('KEY', 'gemini-3.8-flash', fake).json<{ items: { name: string }[] }>({ system: 'SYS', prompt: 'PROMPT', images: [Buffer.from('img')], schema });
    expect(result).toEqual({ items: [{ name: 'ぼうし' }] });
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(seen!.headers['x-goog-api-key']).toBe('KEY');
    expect(seen!.headers['api-revision']).toBe('2026-05-20');
    expect(seen!.body.model).toBe('gemini-3.8-flash');
    expect(seen!.body.system_instruction).toBe('SYS');
    expect(seen!.body.input).toEqual([{ type: 'image', mime_type: 'image/png', data: Buffer.from('img').toString('base64') }, { type: 'text', text: 'PROMPT' }]);
    // Gemini が受け付けない additionalProperties は、どの深さからも取り除く。ほかはそのまま
    expect(seen!.body.response_format).toEqual({
      type: 'text',
      mime_type: 'application/json',
      schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }, required: ['items'] },
    });
    // 渡した schema は書き換えない
    expect(schema.additionalProperties).toBe(false);
  });
  it('画像なしでも呼べる', async () => {
    let input: unknown = null;
    const fake = (async (_url: string, init: RequestInit) => {
      input = JSON.parse(init.body as string).input;
      return new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"items":[]}' }] }] }));
    }) as unknown as typeof fetch;
    await createGeminiText('k', 'm', fake).json({ system: 's', prompt: 'p', schema });
    expect(input).toEqual([{ type: 'text', text: 'p' }]);
  });
  it('JSON でない・文章が無い・キーの誤り・利用制限・断られた、は分かるエラーになる', async () => {
    const call = (status: number, body: unknown) => createGeminiText('k', 'm', reply(status, body)).json({ system: 's', prompt: 'p', schema }).catch((e: AiError) => e);
    const notJson = await call(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'すみません' }] }] });
    expect(notJson).toBeInstanceOf(AiError);
    expect((notJson as AiError).message).toMatch(/読み取れません/);
    const empty = await call(200, { status: 'completed', steps: [{ type: 'thought' }] });
    expect((empty as AiError).message).toMatch(/返答がありません/);
    expect(await call(403, { error: { message: 'bad key' } })).toMatchObject({ status: 500 });
    const limit = await call(429, {});
    expect(limit).toMatchObject({ status: 429 });
    expect((limit as AiError).message).toMatch(/少し待って/);
    const cap = await call(429, { error: { message: 'exceeded its monthly spending cap' } });
    expect((cap as AiError).message).toMatch(/月の上限額/);
    expect(await call(400, { error: { message: 'Request blocked due to prohibited content' } })).toMatchObject({ status: 422 });
    const other = await call(500, { error: { message: 'boom' } });
    expect((other as AiError).message).toMatch(/500/);
  });
  it('つながらないときも AiError', async () => {
    const down = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const e = await createGeminiText('k', 'm', down).json({ system: 's', prompt: 'p', schema }).catch((x: AiError) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).message).toMatch(/接続できません/);
  });
});

describe('createAiFromEnv', () => {
  it('Claude のキーが無くても、Gemini のキーがあれば文章の AI も使える', () => {
    expect(createAiFromEnv({}).text).toBeNull();
    expect(createAiFromEnv({}).image).toBeNull();
    const geminiOnly = createAiFromEnv({ GEMINI_API_KEY: 'g' });
    expect(geminiOnly.text).not.toBeNull();
    expect(geminiOnly.image).not.toBeNull();
    // Claude のキーだけでは、画像は作れない（文章だけ）
    const claudeOnly = createAiFromEnv({ ANTHROPIC_API_KEY: 'a' });
    expect(claudeOnly.text).not.toBeNull();
    expect(claudeOnly.image).toBeNull();
  });
});
