import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runCli } from './cli.mjs';
import { project, artifacts } from './paths.mjs';
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const result = await runCli(['render', project, '-o', resolve(artifacts, 'edited.mp4'), '--fps', '30',
  '--format', 'mp4', '--quality', 'standard', '--workers', '1', '--no-browser-gpu'], 'render',
  { timeoutMs: 180000, signal: controller.signal });
await writeFile(resolve(artifacts, 'render-result.json'), JSON.stringify(result, null, 2));
if (result.status !== 'complete') process.exitCode = 1;
