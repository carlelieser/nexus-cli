import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const file = join(root, '..', 'node_modules', '@mherod', 'get-cookie', 'dist', 'index.js');

// @mherod/get-cookie expects unprotectData(buffer) but @primno/dpapi requires
// unprotectData(buffer, optionalEntropy, scope). The shim resolves both the
// wrong property path (n.unprotectData → n.Dpapi.unprotectData) and the missing
// arguments (null entropy, 'CurrentUser' scope).
const OLD = 'typeof n.unprotectData=="function")return n.unprotectData(r)';
const NEW =
  'typeof(n.unprotectData??n.Dpapi?.unprotectData)=="function")return (n.unprotectData??n.Dpapi?.unprotectData)(r,null,"CurrentUser")';

// Intermediate state from a previous (incomplete) patch run — also treated as
// something that needs re-patching.
const OLD_PARTIAL =
  'typeof(n.unprotectData??n.Dpapi?.unprotectData)=="function")return (n.unprotectData??n.Dpapi?.unprotectData)(r)';

try {
  let src = readFileSync(file, 'utf8');
  if (src.includes(NEW)) {
    process.stdout.write('patch @mherod/get-cookie: already applied\n');
    process.exit(0);
  }
  // Undo a partial patch so we can re-apply cleanly.
  if (src.includes(OLD_PARTIAL)) {
    src = src.replace(OLD_PARTIAL, OLD);
  }
  if (!src.includes(OLD)) {
    process.stdout.write('patch @mherod/get-cookie: pattern not found — skipping\n');
    process.exit(0);
  }
  writeFileSync(file, src.replace(OLD, NEW), 'utf8');
  process.stdout.write('patch @mherod/get-cookie: applied DPAPI shim\n');
} catch (e) {
  process.stderr.write(`patch @mherod/get-cookie: ${e.message}\n`);
}
