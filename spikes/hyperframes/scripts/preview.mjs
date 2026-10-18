import { runCli } from './cli.mjs';
import { project } from './paths.mjs';
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const result = await runCli(['preview', project, '--port', '4567', '--foreground', '--no-open', '--no-proxy', '--no-browser-gpu'], 'preview',
  { timeoutMs: 600000, signal: controller.signal });
console.log(JSON.stringify(result));
