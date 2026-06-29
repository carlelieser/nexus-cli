import type { CommandModule } from 'yargs';

import { out } from '../output.js';
import { buildDeps } from '../wiring.js';

export const logoutCommand: CommandModule = {
  command: 'logout',
  describe: 'Clear the imported session',
  handler: async () => {
    const { store } = buildDeps();
    const existing = await store.load();
    await store.clear();
    if (existing) {
      out.success(`logged out (${existing.username})`);
    } else {
      out.info('no session to clear');
    }
    process.exitCode = 0;
  },
};
