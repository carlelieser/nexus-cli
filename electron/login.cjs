'use strict';

const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { app, BrowserWindow } = require('electron');
const { randomUUID } = require('node:crypto');

const SIGN_IN_URL = process.argv[process.argv.length - 2];
const DOMAIN_SUFFIX = process.argv[process.argv.length - 1];

app.setPath('userData', mkdtempSync(join(tmpdir(), `nexus-login-${randomUUID()}`)));

function matchesDomain(domain) {
  return domain.replace(/^\./, '').endsWith(DOMAIN_SUFFIX);
}

async function getCookies(ses) {
  const all = await ses.cookies.get({});
  return all.filter((c) => matchesDomain(c.domain));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 800 });
  const ses = win.webContents.session;

  let done = false;

  const finish = (cookies, code, message) => {
    if (done) return;
    done = true;
    if (message) process.stderr.write(message);
    process.stdout.write(JSON.stringify(cookies ?? []));
    app.exit(code);
  };

  win.webContents.on('did-navigate', async (_e, url) => {
    if (new URL(url).pathname === '/account/security') {
      finish(await getCookies(ses), 0);
    }
  });

  win.on('closed', async () => {
    try {
      finish(await getCookies(ses), 0);
    } catch (e) {
      finish([], 1, String((e && e.message) || e));
    }
  });

  await win.loadURL(SIGN_IN_URL);
});
