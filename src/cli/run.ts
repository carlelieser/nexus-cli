import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { downloadCommand } from './commands/download.js';
import { importCommand } from './commands/import.js';
import { logoutCommand } from './commands/logout.js';

export async function run(argv: string[] = process.argv): Promise<void> {
  await yargs(hideBin(argv))
    .scriptName('nexus')
    .usage('$0 <command> [options]')
    .option('verbose', {
      type: 'boolean',
      default: false,
      describe: 'Print full stack traces on error',
      global: true,
    })
    .command(importCommand)
    .command(logoutCommand)
    .command(downloadCommand)
    .demandCommand(1, 'a command is required')
    .strict()
    .help()
    .parseAsync();
}
