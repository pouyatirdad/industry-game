// Runs the suite under Node.
//
//   node tools/test.js            whole suite
//   node tools/test.js market     only tests whose name contains "market"
//
// The repo deliberately has no package.json, so Node would read test/run.js as
// CommonJS and choke on its `import`s. This writes the one-line ESM marker for
// the length of the run and removes it again — including on failure, so a red
// suite never leaves a stray file behind.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'package.json');
const existed = fs.existsSync(marker);
if (!existed) fs.writeFileSync(marker, '{"type":"module"}\n');

try {
  const run = spawnSync(process.execPath, [path.join(root, 'test', 'run.js'), process.argv[2] ?? ''],
    { cwd: root, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  if (!existed) fs.unlinkSync(marker);
}
