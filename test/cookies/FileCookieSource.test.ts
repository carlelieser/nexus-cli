import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileCookieSource } from '@adapters/cookies/FileCookieSource.js';
import { AuthError } from '@core/errors.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexus-file-cookies-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fileWith(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('FileCookieSource — JSON', () => {
  const json = JSON.stringify([
    {
      name: 'sid',
      value: 'abc123',
      domain: '.nexusmods.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1799999999.5,
    },
    { name: 'other', value: 'x', domain: '.example.com', path: '/' },
  ]);

  it('parses a Cookie-Editor JSON array and filters by domain', async () => {
    const src = new FileCookieSource(await fileWith('c.json', json));
    const cookies = await src.read('nexusmods.com');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'sid',
      value: 'abc123',
      domain: '.nexusmods.com',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: 1799999999, // floored
    });
  });

  it('accepts a { cookies: [...] } wrapper', async () => {
    const wrapped = JSON.stringify({ cookies: JSON.parse(json) });
    const src = new FileCookieSource(await fileWith('w.json', wrapped));
    expect(await src.read('nexusmods.com')).toHaveLength(1);
  });

  it('maps no_restriction to sameSite None', async () => {
    const src = new FileCookieSource(
      await fileWith(
        'n.json',
        JSON.stringify([
          { name: 'a', value: 'b', domain: 'nexusmods.com', sameSite: 'no_restriction' },
        ]),
      ),
    );
    const [c] = await src.read('nexusmods.com');
    expect(c?.sameSite).toBe('None');
  });

  it('throws AuthError on malformed JSON', async () => {
    const src = new FileCookieSource(await fileWith('bad.json', '[not json'));
    await expect(src.read('nexusmods.com')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('FileCookieSource — Netscape', () => {
  const txt = [
    '# Netscape HTTP Cookie File',
    '.nexusmods.com\tTRUE\t/\tTRUE\t1799999999\tsid\tabc123',
    '#HttpOnly_.nexusmods.com\tTRUE\t/\tTRUE\t0\thid\tsecret',
    '.example.com\tTRUE\t/\tFALSE\t0\tnope\tx',
    '', // blank line ignored
  ].join('\n');

  it('parses tab-delimited cookies, honours #HttpOnly_, and filters by domain', async () => {
    const src = new FileCookieSource(await fileWith('cookies.txt', txt));
    const cookies = await src.read('nexusmods.com');
    expect(cookies.map((c) => c.name).sort()).toEqual(['hid', 'sid']);

    const sid = cookies.find((c) => c.name === 'sid');
    expect(sid).toMatchObject({ value: 'abc123', secure: true, expires: 1799999999 });

    const hid = cookies.find((c) => c.name === 'hid');
    expect(hid?.httpOnly).toBe(true);
    expect(hid?.expires).toBeUndefined(); // 0 → session cookie, no expiry
  });
});

describe('FileCookieSource — errors', () => {
  it('throws AuthError when the file is missing', async () => {
    const src = new FileCookieSource(join(dir, 'nope.txt'));
    await expect(src.read('nexusmods.com')).rejects.toBeInstanceOf(AuthError);
  });
});
