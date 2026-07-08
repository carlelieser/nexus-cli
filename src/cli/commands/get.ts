import ora from 'ora';
import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { getMod } from '@app/getMod.js';
import { restoreSession } from '@app/restoreSession.js';
import { AuthError, isCancel } from '@core/errors.js';
import type { ModDetails } from '@core/types.js';
import { parseNexusUrl } from '@adapters/nexus/parseNexusUrl.js';
import { out } from '../output.js';
import { buildDeps } from '../wiring.js';

interface GetArgs {
  target?: string;
  game: string;
  mod: number;
  json: boolean;
  headful: boolean;
  verbose: boolean;
}

export const getCommand: CommandModule = {
  command: 'get [target]',
  describe: 'Show details for a mod',
  builder: (y: Argv) =>
    y
      .positional('target', {
        type: 'string',
        describe: 'A nexusmods.com mod URL (or use --game with --mod)',
      })
      .option('game', {
        type: 'string',
        describe: 'Nexus game domain (e.g. skyrimspecialedition)',
      })
      .option('mod', { type: 'number', describe: 'Numeric mod id' })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print details as JSON',
      })
      .option('headful', {
        type: 'boolean',
        default: false,
        describe: 'Show the browser window (useful for debugging)',
      })
      .check((argv) => {
        // A URL positional supplies game + mod; resolve it into the same
        // fields the flags use so the handler reads one shape.
        if (typeof argv.target === 'string') {
          const ref = parseNexusUrl(argv.target);
          if (!ref || !('modId' in ref)) {
            throw new Error(`not a recognised Nexus mod URL: ${argv.target}`);
          }
          argv.game = ref.game;
          argv.mod = ref.modId;
        }
        if (argv.game === undefined || argv.mod === undefined) {
          throw new Error('provide a Nexus mod URL, or --game with --mod');
        }
        return true;
      }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as GetArgs;
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
      spinner.text = 'Fetching mod details…';
      const details = await getMod(deps, session, { game: argv.game, modId: argv.mod });
      spinner.stop();

      if (details === null) {
        out.warn(`no mod ${argv.mod} in ${argv.game}`);
        process.exitCode = 1;
      } else if (argv.json) {
        out.info(
          JSON.stringify({ ...details, url: deps.site.modUrl(details.game, details.modId) }),
        );
        process.exitCode = 0;
      } else {
        print(details, deps.site.modUrl(details.game, details.modId));
        process.exitCode = 0;
      }
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

function print(d: ModDetails, url: string): void {
  out.info(d.name);
  out.info(`${d.game}/${d.modId}  ${url}`);
  if (d.version) out.info(`version ${d.version}`);
  if (d.author || d.uploader) {
    const by = d.author ?? d.uploader!;
    const uploaded = d.uploader && d.uploader !== d.author ? ` (uploaded by ${d.uploader})` : '';
    out.info(`by ${by}${uploaded}`);
  }
  if (d.downloads !== undefined || d.endorsements !== undefined) {
    const stats = [
      ...(d.downloads !== undefined ? [`${d.downloads.toLocaleString('en-US')} downloads`] : []),
      ...(d.endorsements !== undefined
        ? [`${d.endorsements.toLocaleString('en-US')} endorsements`]
        : []),
    ];
    out.info(stats.join('  '));
  }
  if (d.updatedAt) out.info(`updated ${d.updatedAt.slice(0, 10)}`);
  if (d.adultContent) out.info('adult content');
  if (d.summary) out.info(d.summary);
  if (d.requirements?.length) {
    out.info('requirements:');
    for (const r of d.requirements) {
      const ref = r.game && r.modId ? `  ${r.game}/${r.modId}` : r.url ? `  ${r.url}` : '';
      const notes = r.notes ? ` — ${r.notes}` : '';
      out.info(`  ${r.name}${r.dlc ? ' (DLC)' : ''}${ref}${notes}`);
    }
  }
}
