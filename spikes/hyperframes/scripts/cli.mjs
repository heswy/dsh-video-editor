import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, artifacts } from './paths.mjs';
import { runOwned } from './process.mjs';
export async function runCli(args, name, options = {}) {
  await mkdir(artifacts, { recursive: true });
  const temp = await mkdtemp(resolve(artifacts, `${name}-tmp-`));
  const result = await runOwned([process.execPath, cli, ...args], { temp, ...options, onOutput: s => { process.stdout.write(s); options.onOutput?.(s); } });
  await writeFile(resolve(artifacts, `${name}.log`), result.output);
  return { ...result, output: undefined };
}
