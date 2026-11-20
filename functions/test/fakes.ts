/**
 * エミュレーターのテスト用の、偽の素材置き場（公開されている素材の代わり）と、偽の Gemini。
 * エミュレーターの中の関数は、functions/.env.local に書いた場所（ports.mjs）へ取りに来る。
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ContentStore } from '../../tools/content/manifestEdit.ts';
import { CONTENT_PORT, GEMINI_PORT } from './ports.mjs';

const dollPng = () =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000">
    <circle cx="250" cy="80" r="70" fill="#f0c8a8"/><rect x="225" y="140" width="50" height="40" fill="#f0c8a8"/>
    <rect x="170" y="175" width="160" height="330" fill="#f0c8a8"/>
    <rect x="60" y="180" width="60" height="330" fill="#f0c8a8" transform="rotate(12 90 180)"/>
    <rect x="380" y="180" width="60" height="330" fill="#f0c8a8" transform="rotate(-12 410 180)"/>
    <rect x="170" y="500" width="70" height="480" fill="#f0c8a8"/><rect x="260" y="500" width="70" height="480" fill="#f0c8a8"/>
  </svg>`),
  )
    .png()
    .toBuffer();

const listen = (server: http.Server, port: number) => new Promise<void>((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
const close = (server: http.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

export interface Fakes {
  dollId: string;
  gemini: { text: number; image: number; failImages: boolean };
  stop(): Promise<void>;
}

export async function startFakes(): Promise<Fakes> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'emu-content-'));
  const content = new ContentStore(dir);
  await content.init();
  const dollId = (await content.addDoll({ name: 'テスト', data: await dollPng() })).id;
  const contentServer = http.createServer(async (req, res) => {
    try {
      const file = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '');
      const data = await fs.readFile(path.join(dir, path.normalize(file)));
      res.writeHead(200).end(data);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  const gemini = { text: 0, image: 0, failImages: false };
  const reply = (res: http.ServerResponse, content: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [content] }] }));
  const geminiServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        if (req.method !== 'POST' || req.url !== '/v1beta/interactions' || req.headers['x-goog-api-key'] !== 'fake-key-for-emulator') {
          res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad request to the fake' } }));
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          input: { type: string; data?: string; text?: string }[];
          response_format: { type: string; schema?: { properties?: Record<string, unknown> } };
        };
        if (body.response_format.type === 'image') {
          gemini.image++;
          if (gemini.failImages) {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'completed', steps: [] }));
            return;
          }
          // 型（1 枚目の絵）の胸のあたりに、赤い服を描いて返す
          const template = Buffer.from(body.input.find((part) => part.type === 'image')!.data!, 'base64');
          const w = (await sharp(template).metadata()).width!;
          const cloth = await sharp({ create: { width: Math.round(w * 0.24), height: Math.round(w * 0.2), channels: 3, background: '#c81e28' } }).png().toBuffer();
          const image = await sharp(template).composite([{ input: cloth, left: Math.round(w * 0.38), top: Math.round(w * 0.22) }]).png().toBuffer();
          reply(res, { type: 'image', mime_type: 'image/png', data: image.toString('base64') });
          return;
        }
        gemini.text++;
        const props = body.response_format.schema?.properties ?? {};
        const prompt = body.input.find((part) => part.type === 'text')?.text ?? '';
        if ('ok' in props) {
          reply(res, { type: 'text', text: JSON.stringify({ ok: true, reason: 'よくできています' }) });
          return;
        }
        const wanted = [...prompt.matchAll(/^- (\S+)/gm)].map((m) => m[1]).filter((id) => ['トップス', 'アクセサリー', 'ボトムス', 'くつ'].includes(id));
        const items = wanted.map((category) => ({ category, name: `うみの${category}`, description: `A red ${category}.`, colors: ['#c81e28'] }));
        reply(res, { type: 'text', text: JSON.stringify('name' in props ? { name: 'うみのセット', items } : { items }) });
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
  });
  await listen(contentServer, CONTENT_PORT);
  await listen(geminiServer, GEMINI_PORT);
  return {
    dollId,
    gemini,
    async stop() {
      await close(contentServer);
      await close(geminiServer);
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
