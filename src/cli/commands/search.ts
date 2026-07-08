import ora from 'ora';
import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { restoreSession } from '@app/restoreSession.js';
import { searchMods } from '@app/searchMods.js';
import { AuthError, isCancel } from '@core/errors.js';
import { out } from '../output.js';
import { buildDeps } from '../wiring.js';

interface SearchArgs {
  term: string;
  game?: string;
  limit: number;
  json: boolean;
  headful: boolean;
  verbose: boolean;
}

export const searchCommand: CommandModule = {
  command: 'search <term>',
  describe: 'Search Nexus Mods for mods by name',
  builder: (y: Argv) =>
    y
      .positional('term', {
        type: 'string',
        demandOption: true,
        describe: 'Search term (matched against mod names)',
      })
      .option('game', {
        type: 'string',
        describe: 'Restrict to a Nexus game domain (e.g. skyrimspecialedition)',
      })
      .option('limit', {
        type: 'number',
        default: 10,
        describe: 'Maximum results to print',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print results as JSON',
      })
      .option('headful', {
        type: 'boolean',
        default: false,
        describe: 'Show the browser window (useful for debugging)',
      }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as SearchArgs;
    const deps = buildDeps();

    // discardStdin:false is REQUIRED: ora's default stdin discarder puts the TTY
    // in raw mode, which disables the terminal's SIGINT generation — Ctrl+C then
    // never reaches our handler and the run can't be cancelled.
    const spinner = ora({ text: 'Restoring session…', discardStdin: false }).start();

    const onSigint = (): void => {
      spinner.stop();
      out.warn('cancelled');
      process.exit(130);
    };
    process.on('SIGINT', onSigint);

    let session;
    try {
      session = await restoreSession(deps, argv.headful);
    } catch (e) {
      spinner.stop();
      process.removeListener('SIGINT', onSigint);
      if (isCancel(e)) {
        out.warn('cancelled');
        process.exitCode = 130;
        return;
      }
      out.error(e, argv.verbose);
      process.exitCode = e instanceof AuthError ? 2 : 1;
      return;
    }

    try {
      spinner.text = 'Searching…';
      const search = await searchMods(deps, session, {
        term: argv.term,
        ...(argv.game ? { game: argv.game } : {}),
        limit: argv.limit,
      });
      spinner.stop();

      if (argv.json) {
        const results = search.results.map((r) => ({
          game: r.game,
          modId: r.modId,
          name: r.name,
          url: deps.site.modUrl(r.game, r.modId),
        }));
        out.info(JSON.stringify({ totalCount: search.totalCount, results }));
      } else if (search.results.length === 0) {
        out.info(`no mods matched "${argv.term}"`);
      } else {
        for (const r of search.results) {
          out.info(`${r.name}  ${r.game}/${r.modId}  ${deps.site.modUrl(r.game, r.modId)}`);
        }
        out.info(
          `showing ${search.results.length} of ${search.totalCount} — download with: nexus download <url>`,
        );
      }
      process.exitCode = 0;
    } catch (e) {
      spinner.stop();
      out.error(e, argv.verbose);
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', onSigint);
      await session.close();
    }
  },
};
