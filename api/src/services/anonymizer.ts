/**
 * Anonymization service for research data exports.
 *
 * Uses SHA-256 hash of (userId + salt) truncated to 8 hex chars as anonymous ID.
 * Each space has a persistent salt stored in spaces.export_salt.
 */

import { createHash, randomBytes } from 'crypto';
import { supabase } from '../config/supabase';

/**
 * Generate a deterministic anonymous ID from a user ID and salt.
 * Returns first 8 hex chars of SHA-256(userId + salt).
 */
export function anonymizeId(userId: string, salt: string): string {
  if (!userId) return '';
  return createHash('sha256')
    .update(userId + salt)
    .digest('hex')
    .slice(0, 8);
}

/**
 * Get or generate the export salt for a space.
 * The salt is persisted to spaces.export_salt so the same anonymous IDs
 * are generated across multiple exports for the same space.
 */
export async function getExportSalt(spaceId: string): Promise<string> {
  // Try to get existing salt
  const { data } = await supabase
    .from('spaces')
    .select('export_salt')
    .eq('id', spaceId)
    .single();

  if (data?.export_salt) return data.export_salt;

  // Generate and persist a new salt
  const newSalt = randomBytes(32).toString('hex');
  await supabase
    .from('spaces')
    .update({ export_salt: newSalt })
    .eq('id', spaceId);

  return newSalt;
}

/**
 * Anonymize a data row:
 * - idFields: field names containing user IDs → replaced with anonymized hashes
 * - stripFields: field names to remove entirely (e.g., session_id)
 */
export function anonymizeRow(
  row: Record<string, any>,
  salt: string,
  idFields: string[],
  stripFields: string[],
): Record<string, any> {
  const result = { ...row };

  for (const field of idFields) {
    if (result[field]) {
      result[field] = anonymizeId(result[field], salt);
    }
  }

  for (const field of stripFields) {
    delete result[field];
  }

  // Also strip known PII fields regardless
  delete result.email;
  delete result.name;
  delete result.full_name;
  delete result.avatar;

  return result;
}
