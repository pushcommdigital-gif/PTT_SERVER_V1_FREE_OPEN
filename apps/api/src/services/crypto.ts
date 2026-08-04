// AES-256-GCM encryption for secrets at rest — e.g. the customer's TomTom (and
// later AI) API keys stored in app_config. The key is derived from JWT_SECRET via
// SHA-256, so there is nothing extra for the customer to configure. Format:
//   v1:<iv b64>:<authTag b64>:<ciphertext b64>
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const KEY = createHash('sha256').update(config.jwt.secret).digest(); // 32 bytes

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string | null {
  try {
    const [v, ivB, tagB, ctB] = enc.split(':');
    if (v !== 'v1' || !ivB || !tagB || !ctB) return null;
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
