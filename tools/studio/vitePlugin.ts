/**
 * スタジオの API を、Vite の開発サーバーに載せる
 *
 *   /api/*                          → StudioApi
 *   <base>local-content/*           → 素材フォルダの中身（ゲーム本体を ?content=local-content/ で開いて確認できる）
 */
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { createAiFromEnv } from './ai.ts';
import { StudioApi } from './api.ts';
import { Budget } from './budget.ts';

const MAX_BODY = 30 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function studioPlugin(env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: 'dressup-studio',
    apply: 'serve',
    async configureServer(server) {
      const contentDir = path.resolve(env.CONTENT_DIR || '../DressUpGame-content');
      const api = new StudioApi({
        contentDir,
        ai: createAiFromEnv(env),
        budget: new Budget(path.resolve('.studio/usage.json'), {
          perDay: positive(env.STUDIO_DAILY_IMAGE_LIMIT, 60),
          perRun: positive(env.STUDIO_RUN_IMAGE_LIMIT, 30),
        }),
      });
      if (!fs.existsSync(path.join(contentDir, 'manifest.json'))) {
        if (env.STUDIO_CREATE === '1') {
          await api.store.init();
        } else {
          throw new Error(
            `素材フォルダが見つかりません: ${contentDir}\n` +
              '  DressUpGame-content を DressUpGame の隣に置くか、環境変数 CONTENT_DIR で場所を指定してください。\n' +
              '  空のフォルダから始めるときは STUDIO_CREATE=1 を付けてください。',
          );
        }
      }
      const base = server.config.base.replace(/\/$/, '');
      const contentPrefix = `${base}/local-content/`;
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let apiPath: string;
        if (url.pathname.startsWith('/api/')) apiPath = url.pathname;
        else if (url.pathname.startsWith(contentPrefix)) apiPath = `/content/${url.pathname.slice(contentPrefix.length)}`;
        else return next();
        try {
          const body = await readBody(req);
          if (body === null) {
            res.statusCode = 413;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: '画像が大きすぎます（上限 30 MB）' }));
            return;
          }
          const result = await api.handle({ method: req.method ?? 'GET', path: apiPath, query: url.searchParams, host: req.headers.host ?? '', origin: req.headers.origin, body });
          res.statusCode = result.status;
          res.setHeader('content-type', result.type);
          res.setHeader('cache-control', 'no-store');
          res.end(result.body);
        } catch (error) {
          next(error);
        }
      });
      server.config.logger.info(`\n  スタジオ: 素材フォルダ ${contentDir}\n  画面: ${base}/studio.html\n`);
    },
  };
}
