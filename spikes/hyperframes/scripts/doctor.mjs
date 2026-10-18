import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, artifacts, browserPath, fontPath } from './paths.mjs';
const digest = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const version = (file, args) => execFileSync(file, args, { encoding: 'utf8' }).split('\n')[0];
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json')));
const report = { node: process.version, platform: `${process.platform}-${process.arch}`,
  ffmpeg: version('ffmpeg', ['-version']), ffprobe: version('ffprobe', ['-version']),
  browser: { path: browserPath, version: version(browserPath, ['--version']) },
  font: { path: fontPath, sha256: await digest(fontPath) },
  packages: Object.fromEntries(Object.entries(lock.packages).filter(([k]) => k).map(([k,v])=>[k, v.version])),
  ignoredInstallScripts: Object.entries(lock.packages).filter(([,v]) => v.hasInstallScript).map(([k,v]) => ({ package: k, version: v.version })),
  lockSha256: await digest(resolve(root, 'package-lock.json')) };
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, 'doctor.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
