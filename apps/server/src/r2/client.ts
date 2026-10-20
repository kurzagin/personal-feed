import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export class StorageProvider {
  private s3: S3Client | null = null;
  private bucket: string;
  private localFallbackDir: string;

  constructor(config?: Partial<R2Config>) {
    this.bucket = config?.bucketName || process.env.R2_BUCKET || "personal-feed-encrypted";
    this.localFallbackDir = join(process.cwd(), ".local_storage");

    const isPlaceholder = config?.accountId?.includes("your_") || config?.accessKeyId?.includes("your_");
    if (config?.accountId && config?.accessKeyId && config?.secretAccessKey && !isPlaceholder) {
      this.s3 = new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
    } else {
      if (!existsSync(this.localFallbackDir)) {
        mkdirSync(this.localFallbackDir, { recursive: true });
      }
    }
  }

  async putEncryptedObject(key: string, data: Buffer): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: "application/octet-stream",
        })
      );
    } else {
      // Local encrypted mock storage
      const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
      writeFileSync(filePath, data);
    }
  }

  async getEncryptedObject(key: string): Promise<Buffer> {
    if (this.s3) {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    } else {
      const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
      if (!existsSync(filePath)) {
        throw new Error(`Storage key not found: ${key}`);
      }
      return readFileSync(filePath);
    }
  }

  async getEncryptedRange(key: string, startByte: number, endByte: number): Promise<Buffer> {
    if (this.s3) {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${startByte}-${endByte}`,
        })
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    } else {
      // Local fallback range read
      const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
      const full = readFileSync(filePath);
      return full.subarray(startByte, Math.min(endByte + 1, full.length));
    }
  }

  async getObjectSize(key: string): Promise<number> {
    if (this.s3) {
      const res = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return res.ContentLength || 0;
    } else {
      const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
      const full = readFileSync(filePath);
      return full.length;
    }
  }
}
