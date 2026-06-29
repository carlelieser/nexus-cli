import ora, { type Ora } from 'ora';
import type { ArgumentsCamelCase, Argv, CommandModule } from 'yargs';

import { downloadCollection } from '@app/downloadCollection.js';
import { downloadMod } from '@app/downloadMod.js';
import { restoreSession } from '@app/restoreSession.js';
import { defaultOutDir } from '@config/paths.js';
import { basename } from 'node:path';
import { AuthError, CancelError, isCancel } from '@core/errors.js';
import { type DownloadReport, type ModResult, summarize } from '@core/types.js';
import { out } from '../output.js';
import { buildDeps } from '../wiring.js';

interface DownloadArgs {
  game: string;
  mod?: number;
  collection?: string;
  out?: string;
  concurrency: number;
  'dry-run': boolean;
  optional: boolean;
  headful: boolean;
  verbose: boolean;
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

export const downloadCommand: CommandModule = {
  command: 'download',
  describe: 'Download a mod or a collection',
  builder: (y: Argv) =>
    y
      .option('game', {
        type: 'string',
        demandOption: true,
        describe: 'Nexus game domain (e.g. skyrimspecialedition)',
      })
      .option('mod', { type: 'number', describe: 'Numeric mod id' })
      .option('collection', { type: 'string', describe: 'Collection slug or id' })
      .option('out', { type: 'string', describe: 'Output directory' })
      .option('concurrency', { type: 'number', default: 2 })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'List what would be downloaded without fetching',
      })
      .option('optional', {
        type: 'boolean',
        default: false,
        describe: 'For collections, also download files marked optional',
      })
      .option('headful', {
        type: 'boolean',
        default: false,
        describe: 'Show the browser window (useful for debugging)',
      })
      .conflicts('mod', 'collection')
      .check((argv) => {
        if (argv.mod === undefined && argv.collection === undefined) {
          throw new Error('one of --mod or --collection is required');
        }
        return true;
      }),
  handler: async (raw: ArgumentsCamelCase) => {
    const argv = raw as unknown as DownloadArgs;
    const outDir = argv.out ?? defaultOutDir(argv.game);
    const deps = buildDeps();

    // One spinner spans the whole run: the (slow) session restore + Cloudflare
    // warm-up, then per-file progress. ora auto-disables on non-TTY.
    const spinner = ora({ text: 'Restoring session…' }).start();

    // Ctrl+C: first press aborts gracefully (stop new work, abort the in-flight
    // file, close the browser, print a summary); a second press hard-exits in
    // case cleanup hangs. The handler is removed in `finally`.
    const controller = new AbortController();
    const onSigint = (): void => {
      if (controller.signal.aborted) {
        spinner.stop();
        out.warn('forced quit');
        process.exit(130);
      }
      controller.abort(new CancelError('cancelled by user'));
      spinner.text = 'Cancelling… (press Ctrl+C again to force quit)';
    };
    process.on('SIGINT', onSigint);

    let session;
    try {
      session = await restoreSession(deps, argv.headful);
    } catch (e) {
      spinner.stop();
      process.removeListener('SIGINT', onSigint);
      if (isCancel(e) || controller.signal.aborted) {
        out.warn('cancelled');
        process.exitCode = 130;
        return;
      }
      out.error(e, argv.verbose);
      process.exitCode = e instanceof AuthError ? 2 : 1;
      return;
    }

    // Tick once a second, independent of download events — ora only re-renders
    // text we reassign, so without this the run-elapsed clock and the per-file
    // elapsed/speed/ETA would freeze between byte/file callbacks.
    const runStart = Date.now();
    const progress = new FileProgress();
    const global = argv.collection !== undefined ? new GlobalProgress() : null;
    const ticker = setInterval(() => {
      if (argv['dry-run']) return;
      spinner.text = composeStatus(progress, global, Date.now() - runStart);
    }, 1000);
    if (typeof ticker.unref === 'function') ticker.unref();

    const signal = controller.signal;
    try {
      const report =
        argv.collection !== undefined
          ? await runCollection(
              deps,
              session,
              argv,
              outDir,
              spinner,
              progress,
              global!,
              runStart,
              signal,
            )
          : await runMod(deps, session, argv, outDir, spinner, progress, runStart, signal);

      clearInterval(ticker);
      finish(spinner, report, argv['dry-run'], Date.now() - runStart);
      process.exitCode = report.failed > 0 ? 1 : 0;
    } catch (e) {
      clearInterval(ticker);
      spinner.stop();
      if (isCancel(e) || signal.aborted) {
        out.warn('cancelled — partial downloads removed');
        process.exitCode = 130;
      } else {
        out.error(e, argv.verbose);
        process.exitCode = e instanceof AuthError ? 2 : 1;
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
      await session.close();
    }
  },
};

async function runMod(
  deps: ReturnType<typeof buildDeps>,
  session: Awaited<ReturnType<typeof restoreSession>>,
  argv: DownloadArgs,
  outDir: string,
  spinner: Ora,
  progress: FileProgress,
  runStart: number,
  signal: AbortSignal,
): Promise<DownloadReport> {
  const verb = argv['dry-run'] ? 'Resolving' : 'Downloading';
  progress.start(`${verb} mod ${argv.mod}`);
  spinner.text = progress.render();
  const result: ModResult = await downloadMod(deps, session, {
    game: argv.game,
    modId: argv.mod!,
    outDir,
    dryRun: argv['dry-run'],
    retryAttempts: RETRY_ATTEMPTS,
    retryBaseDelayMs: RETRY_BASE_DELAY_MS,
    signal,
    onFileProgress: (p) => {
      progress.update(p.receivedBytes, p.totalBytes);
      spinner.text = composeStatus(progress, null, Date.now() - runStart);
    },
  });
  progress.done();
  return summarize([result]);
}

async function runCollection(
  deps: ReturnType<typeof buildDeps>,
  session: Awaited<ReturnType<typeof restoreSession>>,
  argv: DownloadArgs,
  outDir: string,
  spinner: Ora,
  progress: FileProgress,
  global: GlobalProgress,
  runStart: number,
  signal: AbortSignal,
): Promise<DownloadReport> {
  spinner.text = 'Resolving collection…';
  return downloadCollection(deps, session, {
    game: argv.game,
    ref: argv.collection!,
    outDir,
    concurrency: argv.concurrency,
    dryRun: argv['dry-run'],
    includeOptional: argv.optional,
    retryAttempts: RETRY_ATTEMPTS,
    retryBaseDelayMs: RETRY_BASE_DELAY_MS,
    signal,
    // Once the full list is known, seed the global total and start its timer.
    onResolved: (members) => {
      global.setTotal(members);
      global.begin();
    },
    onStart: (member, i, total) => {
      const name = member.name ?? `mod ${member.modId}`;
      const verb = argv['dry-run'] ? 'Resolving' : 'Downloading';
      progress.start(`[${i}/${total}] ${verb} ${name}`);
      global.startFile(member.sizeBytes ?? 0);
      spinner.text = composeStatus(progress, global, Date.now() - runStart);
    },
    onFileProgress: (p) => {
      progress.update(p.receivedBytes, p.totalBytes);
      global.setCurrent(p.receivedBytes);
      spinner.text = composeStatus(progress, global, Date.now() - runStart);
    },
    // Failures persist a line above the spinner.
    onProgress: (r) => {
      progress.done();
      global.completeFile(r.ok);
      if (!r.ok) {
        const text = `mod ${r.modId} failed: ${r.error}`;
        spinner.stopAndPersist({ symbol: '✗', text });
        spinner.start();
      }
    },
  });
}

/** Stop the spinner with a final summary line and (for dry-run) the listing. */
function finish(spinner: Ora, report: DownloadReport, dryRun: boolean, elapsedMs: number): void {
  if (dryRun) {
    spinner.stop();
    for (const r of report.results) {
      out.info(`mod ${r.modId}: ${r.files.join(', ') || '(none)'}`);
    }
    out.info(`dry run — ${report.succeeded} resolvable, ${report.failed} not`);
    return;
  }

  const took = `in ${clock(elapsedMs / 1000)}`;

  // For a single mod, list the files written; for a collection, just the tally.
  if (report.results.length === 1 && report.results[0]?.ok) {
    const files = report.results[0].files.map((f) => basename(f));
    spinner.succeed(`Downloaded ${files.join(', ')} ${took}`);
    return;
  }

  const msg = `${report.succeeded} downloaded, ${report.failed} failed ${took}`;
  if (report.failed > 0) spinner.warn(msg);
  else spinner.succeed(msg);
}

/**
 * Tracks a whole collection's transfer for a global ETA: known total bytes
 * (summed from the API's reported file sizes) against bytes downloaded so far
 * (completed files + the in-flight file). ETA uses the overall average rate.
 */
class GlobalProgress {
  private startedAt = Date.now();
  private totalBytes = 0;
  private completedBytes = 0;
  private currentBytes = 0;
  /** The in-flight file's known size from the API (for skipped files). */
  private currentSize = 0;

  /** Set the known total from the resolved member list. */
  setTotal(members: { sizeBytes?: number }[]): void {
    this.totalBytes = members.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);
  }

  /** Begin the timer once downloading actually starts. */
  begin(): void {
    this.startedAt = Date.now();
  }

  /** Note the file about to download and its known size. */
  startFile(sizeBytes: number): void {
    this.currentBytes = 0;
    this.currentSize = sizeBytes;
  }

  /** Update the in-flight file's streamed byte count. */
  setCurrent(bytes: number): void {
    this.currentBytes = bytes;
  }

  /**
   * Settle the in-flight file. On success, credit its bytes toward the total —
   * the streamed amount, or the known size when nothing streamed (a file that
   * already existed and was skipped). On failure, discard it: a file that
   * errored out must not count as downloaded.
   */
  completeFile(ok: boolean): void {
    if (ok) {
      this.completedBytes += Math.max(this.currentBytes, this.currentSize);
    }
    this.currentBytes = 0;
    this.currentSize = 0;
  }

  /**
   * Render the secondary line:
   *   total  18%  240 MB/1.3 GB  elapsed 02:15  ETA 48:30
   * `elapsedMs` is the whole-run elapsed (so both ETAs share one clock source).
   */
  render(runElapsedMs: number): string {
    if (this.totalBytes <= 0) return '';
    const done = this.completedBytes + this.currentBytes;
    const elapsedMs = Math.max(Date.now() - this.startedAt, 1);
    const rate = done / (elapsedMs / 1000);
    const pct = Math.floor((done / this.totalBytes) * 100);

    const cols = [
      'total',
      `${pct}%`,
      `${size(done)}/${size(this.totalBytes)}`,
      `elapsed ${clock(runElapsedMs / 1000)}`,
    ];
    if (rate > 0 && done > 0) {
      cols.push(`ETA ${clock((this.totalBytes - done) / rate)}`);
    }
    return cols.join('  ');
  }
}

/**
 * Tracks one file's transfer and renders the primary status line:
 *   [3/476] SkyUI  47%  1.2/2.6 MB  3.4 MB/s  ETA 00:04
 * Speed/ETA use the overall average (received ÷ elapsed) — stable, unlike
 * instantaneous chunk-to-chunk rates.
 */
class FileProgress {
  private startedAt = 0;
  private received = 0;
  private total = 0;
  private label = '';
  private active = false;

  /** Reset for a new file. `label` is the position + name, e.g. "[3/476] SkyUI". */
  start(label: string): void {
    this.startedAt = Date.now();
    this.received = 0;
    this.total = 0;
    this.label = label;
    this.active = true;
  }

  /** Record the latest byte counts (called from the download callback). */
  update(received: number, total: number): void {
    this.received = received;
    this.total = total;
    this.active = true;
  }

  /** Render the file line against *now* so elapsed/speed/ETA advance live. */
  render(): string {
    if (!this.label) return '';
    if (!this.active || this.received === 0) return this.label; // resolving…

    const elapsedMs = Math.max(Date.now() - this.startedAt, 1);
    const rate = this.received / (elapsedMs / 1000);
    const cols: string[] = [this.label];

    if (this.total > 0) {
      cols.push(`${Math.floor((this.received / this.total) * 100)}%`);
      cols.push(`${size(this.received)}/${size(this.total)}`);
    } else {
      cols.push(size(this.received));
    }
    cols.push(`${size(rate)}/s`);
    if (this.total > 0 && rate > 0) {
      cols.push(`ETA ${clock((this.total - this.received) / rate)}`);
    }
    return cols.join('  ');
  }

  /** Mark the file finished so the ticker stops rendering its line. */
  done(): void {
    this.active = false;
  }
}

/**
 * Compose the spinner status: the file line, and (for collections) a second
 * "total" line below it. The spinner glyph prefixes the first line.
 */
function composeStatus(
  progress: FileProgress,
  global: GlobalProgress | null,
  runElapsedMs: number,
): string {
  const fileLine = progress.render();
  const totalLine = global?.render(runElapsedMs) ?? '';
  // Indent the second line to align under the first (past the spinner glyph).
  return totalLine ? `${fileLine}\n  ${totalLine}` : fileLine;
}

/** Auto-scale bytes to KB/MB/GB with one decimal, e.g. "1.3 GB". */
function size(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Format seconds as zero-padded HH:MM:SS. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}
