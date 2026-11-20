/**
 * 絵の置き場の本物（Cloud Storage）。アプリからは直接読めない（storage.rules で全部断る）。
 */
import type { Storage } from 'firebase-admin/storage';
import type { CloudFiles } from '../../tools/cloud/store.ts';

type Bucket = ReturnType<Storage['bucket']>;

export class StorageFiles implements CloudFiles {
  private readonly bucket: Bucket;
  constructor(bucket: Bucket) {
    this.bucket = bucket;
  }
  async put(path: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(path).save(data, { contentType, resumable: false });
  }
  async get(path: string): Promise<Buffer | null> {
    try {
      const [data] = await this.bucket.file(path).download();
      return data;
    } catch (error) {
      if ((error as { code?: unknown }).code === 404) return null;
      throw error;
    }
  }
  async removeAll(prefix: string): Promise<void> {
    // 空の prefix で、置き場をまるごと消してしまわないように
    if (!prefix) throw new Error('消す場所が指定されていません');
    await this.bucket.deleteFiles({ prefix, force: true });
  }
}
