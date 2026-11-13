import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

/**
 * 开发环境本地磁盘存储（技术设计 §8.1）。
 * 按内容 SHA-256 命名，同一份文件不会重复占用存储。
 */
@Injectable()
export class LocalStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly baseDir = resolve(
    process.env.LOCAL_STORAGE_DIR ?? '.storage',
  );

  async putObject(
    sha256: string,
    fileName: string,
    data: Buffer,
  ): Promise<string> {
    const key = `${sha256}${extname(fileName).toLowerCase()}`;
    await mkdir(this.baseDir, { recursive: true });
    try {
      await writeFile(join(this.baseDir, key), data, { flag: 'wx' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      this.logger.debug(`Reuse stored object ${key}`);
    }
    return key;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(join(this.baseDir, key));
      return true;
    } catch {
      return false;
    }
  }

  async readObject(key: string): Promise<Buffer> {
    return readFile(join(this.baseDir, key));
  }
}
