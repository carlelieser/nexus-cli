import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { downloadCommand } from './commands/download.js';
import { getCommand } from './commands/get.js';
import { importCommand } from './commands/import.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { searchCommand } from './commands/search.js';

await yargs(hideBin(process.argv))
  .scriptName('nexus')
  .usage('$0 <command> [options]')
  .option('verbose', {
    type: 'boolean',
    default: false,
    describe: 'Print full stack traces on error',
    global: true,
  })
  .command(loginCommand)
  .command(importCommand)
  .command(logoutCommand)
  .command(downloadCommand)
  .command(searchCommand)
  .command(getCommand)
  .demandCommand(1, 'a command is required')
  .strict()
  .help()
  .parseAsync();
