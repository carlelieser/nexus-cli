import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { AuthError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { CookieSource } from './CookieSource.js';

const require = createRequire(import.meta.url);

interface ElectronCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

const SAME_SITE: Record<string, Cookie['sameSite']> = {
  no_restriction: 'None',
  lax: 'Lax',
  strict: 'Strict',
};

export class ElectronLoginSource implements CookieSource {
  readonly browser = 'browser login';

  async read(): Promise<Cookie[]> {
    const electronPath = resolveElectronBinary();
    const script = fileURLToPath(
      new URL(/* @vite-ignore */ '../../electron/login.cjs', import.meta.url),
    );

    const raw = await runElectron(electronPath, script);
    let parsed: ElectronCookie[];
    try {
      parsed = JSON.parse(raw) as ElectronCookie[];
    } catch (e) {
      throw new AuthError('login window returned no usable cookies', { cause: e });
    }
    return parsed.map(toCookie);
  }
}

function resolveElectronBinary(): string {
  let path: unknown;
  try {
    path = require('electron');
  } catch (e) {
    throw new AuthError('the login command needs Electron — install it with `npm i electron`', {
      cause: e,
    });
  }
  if (typeof path !== 'string') {
    throw new AuthError('could not locate the Electron binary');
  }
  return path;
}

function runElectron(electronPath: string, script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (e) =>
      reject(new AuthError('failed to launch the login window', { cause: e })),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new AuthError(`login window exited with code ${code ?? 'null'}`, {
            cause: stderr.trim() || undefined,
          }),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function toCookie(c: ElectronCookie): Cookie {
  const cookie: Cookie = {
    name: c.name,
    value: c.value,
    domain: c.domain ?? '',
    path: c.path ?? '/',
  };
  if (c.secure !== undefined) cookie.secure = c.secure;
  if (c.httpOnly !== undefined) cookie.httpOnly = c.httpOnly;
  if (c.expirationDate !== undefined) cookie.expires = Math.floor(c.expirationDate);
  const ss = c.sameSite ? SAME_SITE[c.sameSite] : undefined;
  if (ss) cookie.sameSite = ss;
  return cookie;
}
