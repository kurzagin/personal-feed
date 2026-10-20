export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
}
export declare class StorageProvider {
    private s3;
    private bucket;
    private localFallbackDir;
    constructor(config?: Partial<R2Config>);
    putEncryptedObject(key: string, data: Buffer): Promise<void>;
    getEncryptedRange(key: string, startByte: number, endByte: number): Promise<Buffer>;
    getObjectSize(key: string): Promise<number>;
}
//# sourceMappingURL=client.d.ts.map