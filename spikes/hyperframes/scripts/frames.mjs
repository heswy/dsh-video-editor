import { resolve } from 'node:path';
import { project, artifacts } from './paths.mjs';
import { runCli } from './cli.mjs';
const name = process.argv[2] || 'before';
if (!['before', 'after', 'ordered', 'shuffled'].includes(name)) throw new Error('Unknown capture name');
const times = name === 'shuffled' ? '4.5,0.5,3.5,1,2.5,0,4,4.9666666667' : '0,0.5,1,2.5,3.5,4,4.5,4.9666666667';
const result = await runCli(['snapshot', project, '--at', times, '--no-end', '--keep', '--describe', 'false',
  '--no-browser-gpu', '-o', resolve(artifacts, name)], `frames-${name}`);
if (result.status !== 'complete') throw new Error(JSON.stringify(result));
