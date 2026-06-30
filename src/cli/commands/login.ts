import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { importSession } from '@app/importSession.js';
import { ElectronLoginSource } from '@adapters/cookies/ElectronLoginSource.js';
import { out } from '../output.js';
import { buildDeps, NEXUS_COOKIE_DOMAIN } from '../wiring.js';

interface LoginArgs {
  validate: boolean;
  verbose: boolean;
}

export const loginCommand: CommandModule = {
  command: 'login',
  describe: 'Open a browser to log in to Nexus and save the session',
  builder: (y: Argv) =>
    y.option('validate', {
      type: 'boolean',
      default: true,
      describe: 'Confirm the captured cookies are logged in before saving',
    }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as LoginArgs;
    const { browser, store } = buildDeps();
    out.info('Opening browser window. Please log in to Nexus to continue.');
    try {
      const source = new ElectronLoginSource();
      await importSession(
        { source, browser, store },
        { domainSuffix: NEXUS_COOKIE_DOMAIN, validate: argv.validate },
      );
      out.success('Logged in.');
      process.exitCode = 0;
    } catch (e) {
      out.error(e, argv.verbose);
      process.exitCode = 1;
    }
  },
};
