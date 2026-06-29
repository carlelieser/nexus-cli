import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AuthError, NetworkError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { CookieSource } from './CookieSource.js';

const exec = promisify(execFile);

// macOS Chrome v10 cookie encryption parameters.
const SALT = 'saltysalt';
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, 0x20); // 16 spaces.
// Newer Chrome prefixes the plaintext with a 32-byte SHA-256 of the domain.
const DOMAIN_HASH_LEN = 32;

interface ChromeCookieRow {
  host_key: string;
  name: string;
  path: string;
  encrypted_value_hex: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
}

/**
 * Reads cookies from Google Chrome's store on macOS and decrypts the `v10`
 * (Keychain-AES) format. Requires Chrome's profile to exist and the Keychain
 * "Chrome Safe Storage" entry to be accessible (may prompt once).
 *
 * Note: very recent Chrome can use app-bound (`v20`) encryption that other
 * processes cannot decrypt; such values are skipped with a clear error if no
 * usable cookies remain.
 */
export class ChromeCookieSource implements CookieSource {
  readonly browser = 'Chrome';

  constructor(
    private readonly profile = 'Default',
    private readonly cookiesPath = join(
      homedir(),
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'Default',
      'Cookies',
    ),
  ) {}

  async read(domainSuffix: string): Promise<Cookie[]> {
    const key = await this.deriveKey();
    const rows = await this.queryRows(domainSuffix);

    const cookies: Cookie[] = [];
    let undecryptable = 0;
    for (const row of rows) {
      const value = this.decrypt(Buffer.from(row.encrypted_value_hex, 'hex'), key);
      if (value === null) {
        undecryptable += 1;
        continue;
      }
      cookies.push(toCookie(row, value));
    }

    if (cookies.length === 0 && undecryptable > 0) {
      throw new AuthError(
        'Chrome cookies use app-bound (v20) encryption that cannot be read by ' +
          'this tool. Export them with a cookie extension and use `nexus import --file <path>` instead.',
      );
    }
    return cookies;
  }

  /** Derive the AES key from the macOS Keychain "Chrome Safe Storage" entry. */
  private async deriveKey(): Promise<Buffer> {
    let password: string;
    try {
      const { stdout } = await exec('security', [
        'find-generic-password',
        '-w',
        '-s',
        'Chrome Safe Storage',
        '-a',
        'Chrome',
      ]);
      password = stdout.trim();
    } catch (e) {
      throw new AuthError('could not read the Chrome Safe Storage key from the macOS Keychain', {
        cause: e,
      });
    }
    return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');
  }

  /** Copy the (locked-while-running) DB to temp and read matching rows. */
  private async queryRows(domainSuffix: string): Promise<ChromeCookieRow[]> {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-cookies-'));
    const dbCopy = join(dir, 'Cookies');
    try {
      await copyFile(this.cookiesPath, dbCopy);
    } catch (e) {
      throw new AuthError(
        `could not read Chrome cookies at ${this.cookiesPath} ` +
          '(is Chrome installed and this the right profile?)',
        { cause: e },
      );
    }

    try {
      const sql =
        'SELECT host_key, name, path, hex(encrypted_value), ' +
        'expires_utc, is_secure, is_httponly, samesite FROM cookies ' +
        `WHERE host_key LIKE '%${domainSuffix.replace(/'/g, "''")}';`;
      const { stdout } = await exec('sqlite3', ['-separator', '\t', dbCopy, sql]);
      return parseRows(stdout);
    } catch (e) {
      throw new NetworkError('failed to query the Chrome cookie database', {
        cause: e,
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** AES-128-CBC decrypt a v10 value; returns null if not the v10 format. */
  private decrypt(encrypted: Buffer, key: Buffer): string | null {
    const prefix = encrypted.subarray(0, 3).toString('ascii');
    if (prefix !== 'v10') return null; // v20/app-bound — cannot decrypt.

    const body = encrypted.subarray(3);
    try {
      const decipher = createDecipheriv('aes-128-cbc', key, IV);
      decipher.setAutoPadding(true);
      let out = Buffer.concat([decipher.update(body), decipher.final()]);
      // Strip the 32-byte SHA-256 domain hash newer Chrome prepends.
      if (out.length >= DOMAIN_HASH_LEN) out = out.subarray(DOMAIN_HASH_LEN);
      return out.toString('utf8');
    } catch {
      return null;
    }
  }
}

function parseRows(stdout: string): ChromeCookieRow[] {
  const rows: ChromeCookieRow[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 8) continue;
    rows.push({
      host_key: f[0]!,
      name: f[1]!,
      path: f[2]!,
      encrypted_value_hex: f[3]!,
      expires_utc: Number(f[4]),
      is_secure: Number(f[5]),
      is_httponly: Number(f[6]),
      samesite: Number(f[7]),
    });
  }
  return rows;
}

function toCookie(row: ChromeCookieRow, value: string): Cookie {
  const cookie: Cookie = {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || '/',
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    sameSite: sameSiteOf(row.samesite),
  };
  // Chrome stores expiry in microseconds since 1601-01-01; convert to unix secs.
  if (row.expires_utc > 0) {
    cookie.expires = Math.floor(row.expires_utc / 1_000_000 - 11_644_473_600);
  }
  return cookie;
}

function sameSiteOf(v: number): 'Strict' | 'Lax' | 'None' {
  switch (v) {
    case 0:
      return 'None';
    case 2:
      return 'Strict';
    default:
      return 'Lax';
  }
}
