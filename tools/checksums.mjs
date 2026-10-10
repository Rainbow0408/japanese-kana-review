import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist');
const filenames = ['setup', 'portable'].map(type => `Japanese-Kana-Review-${version}-win-x64-${type}.exe`);
const lines = await Promise.all(filenames.map(async filename => {
  const data = await readFile(path.join(directory, filename));
  return `${createHash('sha256').update(data).digest('hex')}  ${filename}`;
}));
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log('SHA256SUMS.txt written for setup and portable executables.');
