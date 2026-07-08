import ora from 'ora';
import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { getMod, getModDependents, getModRequirements } from '@app/getMod.js';
import { restoreSession } from '@app/restoreSession.js';
import { AuthError, isCancel } from '@core/errors.js';
import type { ModDependent, ModDetails, ModRequirement, Page } from '@core/types.js';
import { parseNexusUrl } from '@adapters/nexus/parseNexusUrl.js';
import { out } from '../output.js';
import { buildDeps } from '../wiring.js';

interface GetArgs {
  target?: string;
  game: string;
  mod: number;
  requirements: boolean;
  dependents: boolean;
  page: number;
  limit: number;
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
      .option('requirements', {
        type: 'boolean',
        default: false,
        describe: "List the mod's own requirements (paginated) instead of its details",
      })
      .option('dependents', {
        type: 'boolean',
        default: false,
        describe: 'List mods that depend on this mod (paginated) instead of its details',
      })
      .option('page', {
        type: 'number',
        default: 1,
        describe: 'Page number for --requirements/--dependents (1-indexed)',
      })
      .option('limit', {
        type: 'number',
        default: 10,
        describe: 'Results per page for --requirements/--dependents',
      })
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
        if (argv.requirements && argv.dependents) {
          throw new Error('use only one of --requirements or --dependents at a time');
        }
        if (argv.page < 1) {
          throw new Error('--page must be 1 or greater');
        }
        if (argv.limit < 1) {
          throw new Error('--limit must be 1 or greater');
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
      if (argv.requirements || argv.dependents) {
        const kind = argv.requirements ? 'requirements' : 'dependents';
        spinner.text = `Fetching ${kind}…`;
        const offset = (argv.page - 1) * argv.limit;
        const pageParams = { game: argv.game, modId: argv.mod, count: argv.limit, offset };
        const page =
          kind === 'requirements'
            ? await getModRequirements(deps, session, pageParams)
            : await getModDependents(deps, session, pageParams);
        spinner.stop();
        printPage(kind, page, argv.page, argv.limit, argv.json);
        process.exitCode = 0;
      } else {
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
    for (const r of d.requirements) out.info(`  ${requirementLine(r)}`);
  }
}

function requirementLine(r: ModRequirement | ModDependent): string {
  const ref = r.game && r.modId ? `  ${r.game}/${r.modId}` : r.url ? `  ${r.url}` : '';
  const notes = r.notes ? ` — ${r.notes}` : '';
  const dlc = 'dlc' in r && r.dlc ? ' (DLC)' : '';
  return `${r.name}${dlc}${ref}${notes}`;
}

function printPage(
  kind: 'requirements' | 'dependents',
  page: Page<ModRequirement> | Page<ModDependent>,
  pageNum: number,
  limit: number,
  json: boolean,
): void {
  const totalPages = Math.max(1, Math.ceil(page.totalCount / limit));

  if (json) {
    out.info(
      JSON.stringify({
        total: page.totalCount,
        page: pageNum,
        totalPages,
        limit,
        items: page.items,
      }),
    );
    return;
  }

  if (page.items.length === 0) {
    out.info(`no ${kind}`);
    return;
  }

  out.info(`${kind}:`);
  for (const item of page.items) out.info(`  ${requirementLine(item)}`);

  const offset = (pageNum - 1) * limit;
  out.info(
    `page ${pageNum} of ${totalPages} — showing ${offset + 1}-${offset + page.items.length} of ${page.totalCount}`,
  );
}
