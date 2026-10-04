import crypto from 'crypto';

const SECRET_PREFIX = 'enc:v1:';

function getEncryptionMaterial(): string {
  const dedicated = process.env.AI_CONFIG_ENCRYPTION_KEY;
  if (dedicated) return dedicated;

  console.warn('[SECURITY] AI_CONFIG_ENCRYPTION_KEY not set — falling back to SUPABASE_JWT_SECRET. Set a dedicated key in production.');
  const fallback = process.env.SUPABASE_JWT_SECRET;
  if (fallback) return fallback;

  throw new Error('AI_CONFIG_ENCRYPTION_KEY is required. Set it in the environment.');
}

function getKey(): Buffer {
  return crypto.createHash('sha256').update(getEncryptionMaterial()).digest();
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(plainText: string): string {
  const value = plainText.trim();
  if (!value) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_PREFIX.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptSecret(storedValue: string): string {
  if (!isEncryptedSecret(storedValue)) return storedValue;

  const [, version, ivText, tagText, encryptedText] = storedValue.split(':');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new Error('Invalid encrypted secret format');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
