// エミュレーターの中の関数に渡す、テスト用の設定を書く（どちらも *.local なので、コミットされない）
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTENT_PORT, GEMINI_PORT } from './ports.mjs';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
fs.writeFileSync(here('../.env.local'), `STUDIO_TEST_CONTENT_URL=http://127.0.0.1:${CONTENT_PORT}/\nSTUDIO_TEST_GEMINI_URL=http://127.0.0.1:${GEMINI_PORT}/\n`);
fs.writeFileSync(here('../.secret.local'), 'GEMINI_API_KEY=fake-key-for-emulator\n');
