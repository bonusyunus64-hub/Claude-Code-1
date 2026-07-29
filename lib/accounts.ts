import crypto from 'crypto';
import { getRedis, isKvConfigured, STATE_KEY } from '@/lib/kv';

export const ACCOUNTS_KEY = 'trackpitch:accounts';

/** The localStorage/settings key that used to hold accounts — including plaintext passwords. */
const LEGACY_STATE_FIELD = 'tp_email_accounts';

export interface StoredAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

/** What the browser is allowed to see: everything except the password. */
export type PublicAccount = Omit<StoredAccount, 'smtpPass'>;

export function toPublic(account: StoredAccount): PublicAccount {
  const { smtpPass: _smtpPass, ...rest } = account;
  return rest;
}

// SMTP passwords are encrypted before they touch Redis, so a leaked database
// dump or an over-broad Upstash token isn't immediately a working mailbox login.
// ACCOUNTS_SECRET is the proper key; SITE_PASSWORD is a fallback so this works
// without new env setup — but note that changing SITE_PASSWORD then makes
// existing accounts undecryptable and they have to be re-entered.
function encryptionKey(): Buffer | null {
  const secret = process.env.ACCOUNTS_SECRET || process.env.SITE_PASSWORD;
  if (!secret) return null;
  return crypto.scryptSync(secret, 'trackpitch-account-encryption', 32);
}

// Exported so the round trip (and its failure modes) can be unit tested without
// needing a live Redis instance behind getAccount/saveAccount.
export function encrypt(plaintext: string): string {
  const key = encryptionKey();
  if (!key) throw new Error('Cannot store an email account: set ACCOUNTS_SECRET or SITE_PASSWORD.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/** Returns null rather than throwing when the ciphertext can't be read — a rotated
 *  secret shouldn't take down the whole account list, just that one account. */
export function decrypt(payload: string): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

interface AccountRecord extends Omit<StoredAccount, 'smtpPass'> {
  encryptedPass: string;
}

function parseRecord(raw: unknown): AccountRecord | null {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!value || typeof value !== 'object') return null;
  const rec = value as Partial<AccountRecord>;
  if (!rec.id || typeof rec.encryptedPass !== 'string') return null;
  return {
    id: rec.id,
    name: rec.name ?? '',
    email: rec.email ?? '',
    smtpHost: rec.smtpHost || 'smtp.zoho.com',
    smtpPort: Number(rec.smtpPort) || 465,
    smtpUser: rec.smtpUser ?? '',
    encryptedPass: rec.encryptedPass,
  };
}

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

async function readAll(): Promise<AccountRecord[]> {
  if (!isKvConfigured()) return [];
  await migrateLegacyAccounts();
  const raw = (await getRedis().hgetall<Record<string, unknown>>(ACCOUNTS_KEY)) ?? {};
  return Object.values(raw).map(parseRecord).filter((r): r is AccountRecord => r !== null);
}

export async function listAccounts(): Promise<PublicAccount[]> {
  const records = await readAll();
  return records.map(({ encryptedPass: _encryptedPass, ...rest }) => rest);
}

/** Full account including the decrypted password. Server-side only — never serialise this to a response. */
export async function getAccount(id: string): Promise<StoredAccount | null> {
  const records = await readAll();
  const record = records.find(r => r.id === id);
  if (!record) return null;
  const smtpPass = decrypt(record.encryptedPass);
  if (smtpPass === null) return null;
  const { encryptedPass: _encryptedPass, ...rest } = record;
  return { ...rest, smtpPass };
}

export async function saveAccount(account: StoredAccount): Promise<PublicAccount> {
  const record: AccountRecord = {
    id: account.id,
    name: account.name,
    email: account.email,
    smtpHost: account.smtpHost || 'smtp.zoho.com',
    smtpPort: Number(account.smtpPort) || 465,
    smtpUser: account.smtpUser,
    encryptedPass: encrypt(account.smtpPass),
  };
  await getRedis().hset(ACCOUNTS_KEY, { [record.id]: JSON.stringify(record) });
  const { encryptedPass: _encryptedPass, ...rest } = record;
  return rest;
}

export async function deleteAccount(id: string): Promise<void> {
  await getRedis().hdel(ACCOUNTS_KEY, id);
}

// One-time move of accounts out of the plaintext settings blob and into the
// encrypted store. Runs server-side so the plaintext copy is purged from Redis
// even if the browser that originally wrote it never loads the app again.
let migrationDone = false;

async function migrateLegacyAccounts(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  try {
    const redis = getRedis();
    const legacy = await redis.hget<unknown>(STATE_KEY, LEGACY_STATE_FIELD);
    if (legacy == null) return;

    const parsed = typeof legacy === 'string' ? safeParse(legacy) : legacy;
    if (Array.isArray(parsed)) {
      for (const entry of parsed as Partial<StoredAccount>[]) {
        if (!entry?.id || !entry.smtpUser || !entry.smtpPass) continue;
        const existing = await redis.hget(ACCOUNTS_KEY, entry.id);
        if (existing) continue; // already migrated; don't clobber a newer edit
        await saveAccount({
          id: entry.id,
          name: entry.name ?? '',
          email: entry.email ?? '',
          smtpHost: entry.smtpHost || 'smtp.zoho.com',
          smtpPort: Number(entry.smtpPort) || 465,
          smtpUser: entry.smtpUser,
          smtpPass: entry.smtpPass,
        });
      }
    }
    // Purge the plaintext regardless of whether anything parsed — leaving it is the bug.
    await redis.hdel(STATE_KEY, LEGACY_STATE_FIELD);
  } catch {
    migrationDone = false; // transient Redis failure: let the next request retry
  }
}
