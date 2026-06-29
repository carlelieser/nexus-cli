import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { importSession } from '@app/importSession.js';
import { out } from '../output.js';
import { buildDeps, cookieSourceFor, NEXUS_COOKIE_DOMAIN } from '../wiring.js';

interface ImportArgs {
  from: string;
  validate: boolean;
  verbose: boolean;
}

export const importCommand: CommandModule = {
  command: 'import',
  describe: 'Import Nexus cookies from your existing browser session',
  builder: (y: Argv) =>
    y
      .option('from', {
        type: 'string',
        default: 'chrome',
        describe: 'Browser to import cookies from (chrome)',
      })
      .option('validate', {
        type: 'boolean',
        default: true,
        describe: 'Open a headless browser to confirm the cookies are logged in',
      }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as ImportArgs;
    const { browser, store } = buildDeps();
    try {
      const source = cookieSourceFor(argv.from);
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
