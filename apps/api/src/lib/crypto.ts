import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const CIPHERTEXT_VERSION = 'v1';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Parses the base64 encryption key from config; it must decode to exactly 32 bytes. */
export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes, base64-encoded');
  return key;
}

/**
 * Encrypts a secret with AES-256-GCM. `context` (for example a workspace id) is
 * authenticated but not stored, so a ciphertext copied to another tenant's row
 * fails to decrypt.
 */
export function encryptSecret(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [CIPHERTEXT_VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(':');
}

export function decryptSecret(key: Buffer, payload: string, context: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== CIPHERTEXT_VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Unrecognised ciphertext format');
  }
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
