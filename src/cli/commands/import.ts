import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { importSession } from '@app/importSession.js';
import { out } from '../output.js';
import { buildDeps, cookieSourceFor, fileCookieSource, NEXUS_COOKIE_DOMAIN } from '../wiring.js';

interface ImportArgs {
  from?: string;
  file?: string;
  validate: boolean;
  verbose: boolean;
}

export const importCommand: CommandModule = {
  command: 'import',
  describe: 'Import Nexus cookies from your existing browser session',
  builder: (y: Argv) =>
    y
      // No yargs `default` here: a default value would always count as "set"
      // and trip `.conflicts('file', 'from')`, making `--file` unusable. The
      // chrome fallback is applied in the handler instead.
      .option('from', {
        type: 'string',
        describe:
          'Browser to import cookies from: chrome (default), brave, edge, opera, vivaldi, arc, firefox, safari',
      })
      .option('file', {
        type: 'string',
        describe: 'Import from an exported cookie file (cookies.txt or JSON) instead of a browser',
      })
      .conflicts('file', 'from')
      .option('validate', {
        type: 'boolean',
        default: true,
        describe: 'Open a headless browser to confirm the cookies are logged in',
      }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as ImportArgs;
    const { browser, store } = buildDeps();
    try {
      const source = argv.file
        ? fileCookieSource(argv.file)
        : cookieSourceFor(argv.from ?? 'chrome');
      const session = await importSession(
        { source, browser, store },
        { domainSuffix: NEXUS_COOKIE_DOMAIN, validate: argv.validate },
      );
      out.success(
        `imported ${session.cookies.length} cookie(s) from ${source.browser}` +
          (session.username !== 'nexus-user' ? ` for ${session.username}` : ''),
      );
      process.exitCode = 0;
    } catch (e) {
      out.error(e, argv.verbose);
      process.exitCode = 1;
    }
  },
};
