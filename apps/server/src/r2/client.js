import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export class StorageProvider {
    s3 = null;
    bucket;
    localFallbackDir;
    constructor(config) {
        this.bucket = config?.bucketName || process.env.R2_BUCKET || "personal-feed-encrypted";
        this.localFallbackDir = join(process.cwd(), ".local_storage");
        if (config?.accountId && config?.accessKeyId && config?.secretAccessKey) {
            this.s3 = new S3Client({
                region: "auto",
                endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey,
                },
            });
        }
        else {
            if (!existsSync(this.localFallbackDir)) {
                mkdirSync(this.localFallbackDir, { recursive: true });
            }
        }
    }
    async putEncryptedObject(key, data) {
        if (this.s3) {
            await this.s3.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: data,
                ContentType: "application/octet-stream",
            }));
        }
        else {
            // Local encrypted mock storage
            const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
            writeFileSync(filePath, data);
        }
    }
    async getEncryptedRange(key, startByte, endByte) {
        if (this.s3) {
            const res = await this.s3.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Range: `bytes=${startByte}-${endByte}`,
            }));
            const bytes = await res.Body?.transformToByteArray();
            return bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        }
        else {
            // Local fallback range read
            const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
            const full = readFileSync(filePath);
            return full.subarray(startByte, Math.min(endByte + 1, full.length));
        }
    }
    async getObjectSize(key) {
        if (this.s3) {
            const res = await this.s3.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            return res.ContentLength || 0;
        }
        else {
            const filePath = join(this.localFallbackDir, key.replace(/\//g, "_"));
            const full = readFileSync(filePath);
            return full.length;
        }
    }
}
//# sourceMappingURL=client.js.map