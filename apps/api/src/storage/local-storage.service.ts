import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '@fixly/config';

@Injectable()
export class LocalStorageService implements OnModuleInit {
  private readonly root = resolve(process.cwd(), env.UPLOAD_DIR);

  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
  }

  async put(buffer: Buffer, extension: string) {
    const objectKey = `${randomUUID()}.${extension}`;
    const path = this.resolveSafe(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer, { flag: 'wx' });
    return objectKey;
  }

  read(objectKey: string) {
    return readFile(this.resolveSafe(objectKey));
  }

  async remove(objectKey: string) {
    await unlink(this.resolveSafe(objectKey));
  }

  private resolveSafe(objectKey: string) {
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}/`)) throw new Error('Invalid storage key');
    return path;
  }
}
