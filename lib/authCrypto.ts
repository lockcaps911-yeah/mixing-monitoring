import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  const [algorithm, saltHex, keyHex] = encoded?.split('$') ?? [];
  const salt = algorithm === 'scrypt' && /^[a-f0-9]{32}$/i.test(saltHex ?? '')
    ? Buffer.from(saltHex, 'hex')
    : Buffer.from('b54c7b412d39b28f857a608b992a1641', 'hex');
  const expected = algorithm === 'scrypt' && /^[a-f0-9]{128}$/i.test(keyHex ?? '')
    ? Buffer.from(keyHex, 'hex')
    : Buffer.alloc(64);
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, expected) && Boolean(encoded && algorithm === 'scrypt');
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}
