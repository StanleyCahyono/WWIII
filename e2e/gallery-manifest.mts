/**
 * Regenerates the symbol-gallery manifest in memory (scripts/symbol-gallery.ts with its file
 * writes captured, so docs/ is not touched) and prints it to stdout. Used by e2e/visual.spec.ts.
 */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const captured = new Map<string, string>();
const realWrite = fs.writeFileSync;
const realMkdir = fs.mkdirSync;
(fs as { writeFileSync: unknown }).writeFileSync = (p: fs.PathOrFileDescriptor, d: unknown) => {
  captured.set(resolve(String(p)), String(d));
};
(fs as { mkdirSync: unknown }).mkdirSync = () => undefined;
syncBuiltinESMExports();
const origLog = console.log;
console.log = () => undefined;
try {
  await import(new URL('../scripts/symbol-gallery.ts', import.meta.url).href);
} finally {
  (fs as { writeFileSync: unknown }).writeFileSync = realWrite;
  (fs as { mkdirSync: unknown }).mkdirSync = realMkdir;
  syncBuiltinESMExports();
  console.log = origLog;
}
const key = [...captured.keys()].find((k) => k.endsWith('manifest.json'));
if (!key) throw new Error('gallery script wrote no manifest.json');
process.stdout.write(captured.get(key)!);
