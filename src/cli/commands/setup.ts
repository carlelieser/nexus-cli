import { CamoufoxFetcher, installedVerStr } from 'camoufox-js/dist/pkgman.js';
import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { out } from '../output.js';

interface SetupArgs {
  force: boolean;
  verbose: boolean;
}

/**
 * Run by the install script (and re-runnable if the browser cache is wiped) so
 * the first real `download` never stalls on a ~150 MB fetch or fails with a
 * cryptic "browser not found".
 */
export const setupCommand: CommandModule = {
  command: 'setup',
  describe: 'Download the bundled browser nexus needs (run once after install)',
  builder: (y: Argv) =>
    y.option('force', {
      type: 'boolean',
      default: false,
      describe: 'Re-download even if a browser is already installed',
    }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as SetupArgs;
    try {
      if (!argv.force) {
        const installed = currentVersion();
        if (installed) {
          out.success(`browser already installed (${installed}); nothing to do`);
          process.exitCode = 0;
          return;
        }
      }
      out.info('downloading browser (~150 MB, one time)…');
      const fetcher = new CamoufoxFetcher();
      await fetcher.init();
      await fetcher.fetchLatest();
      out.success(`browser installed (${fetcher.verstr})`);
      process.exitCode = 0;
    } catch (e) {
      out.error(e, argv.verbose);
      process.exitCode = 1;
    }
  },
};

/** Installed Camoufox version string, or null when none is present. */
function currentVersion(): string | null {
  try {
    return installedVerStr();
  } catch {
    return null;
  }
}
