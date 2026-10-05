import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './crypto';

const key = randomBytes(32);

describe('secret encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const payload = encryptSecret(key, 'sk-very-secret', 'ws-1');
    expect(payload).not.toContain('sk-very-secret');
    expect(decryptSecret(key, payload, 'ws-1')).toBe('sk-very-secret');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret(key, 'same', 'ws-1')).not.toBe(encryptSecret(key, 'same', 'ws-1'));
  });

  it('refuses to decrypt under another workspace (ciphertext copied across tenants)', () => {
    const payload = encryptSecret(key, 'sk-very-secret', 'ws-1');
    expect(() => decryptSecret(key, payload, 'ws-2')).toThrow();
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct = ''] = encryptSecret(key, 'sk-very-secret', 'ws-1').split(':');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = [v, iv, tag, flipped.toString('base64url')].join(':');
    expect(() => decryptSecret(key, tampered, 'ws-1')).toThrow();
  });

  it('fails with the wrong key', () => {
    const payload = encryptSecret(key, 'sk-very-secret', 'ws-1');
    expect(() => decryptSecret(randomBytes(32), payload, 'ws-1')).toThrow();
  });

  it('only accepts 32-byte keys', () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow();
    expect(parseEncryptionKey(key.toString('base64'))).toHaveLength(32);
  });
});
