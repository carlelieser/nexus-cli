import { isNexusError } from '@core/errors.js';

/** Minimal user-facing output. Errors render as one line unless verbose. */
export const out = {
  info(msg: string): void {
    process.stdout.write(`${msg}\n`);
  },
  success(msg: string): void {
    process.stdout.write(`✓ ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`! ${msg}\n`);
  },
  error(e: unknown, verbose: boolean): void {
    if (verbose && e instanceof Error && e.stack) {
      process.stderr.write(`${e.stack}\n`);
      return;
    }
    const prefix = isNexusError(e) ? `${e.kind} error` : 'error';
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`✗ ${prefix}: ${msg}\n`);
  },
};
