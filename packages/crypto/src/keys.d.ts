/**
 * Derives a 256-bit Master Key from a user passphrase and salt.
 */
export declare function deriveMasterKey(passphrase: string, salt: Buffer): Buffer;
/**
 * Generates a random 256-bit Content Encryption Key (CEK).
 */
export declare function generateContentKey(): Buffer;
/**
 * Wraps (encrypts) the Content Key with the Master Key using AES-256-GCM.
 */
export declare function wrapContentKey(contentKey: Buffer, masterKey: Buffer): string;
/**
 * Unwraps (decrypts) the Content Key using the Master Key.
 */
export declare function unwrapContentKey(wrappedKeyBase64: string, masterKey: Buffer): Buffer;
//# sourceMappingURL=keys.d.ts.map