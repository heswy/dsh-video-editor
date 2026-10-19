import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const artifacts = resolve(root, 'artifacts');
export const project = resolve(artifacts, 'project');
export const cli = resolve(root, 'node_modules/hyperframes/dist/cli.js');
export const browserPath = process.env.SPIKE_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const fontPath = process.env.SPIKE_FONT_PATH || '/System/Library/Fonts/STHeiti Medium.ttc';
export function owned(path) {
  const result = resolve(path);
  const rel = relative(artifacts, result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path must be below spike artifacts');
  return result;
}
export function toolEnv(temp = resolve(artifacts, 'tmp')) {
  mkdirSync(temp, { recursive: true });
  return { ...process.env, TMPDIR: temp, HYPERFRAMES_BROWSER_PATH: browserPath,
    PRODUCER_BROWSER_GPU_MODE: 'software', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1',
    HEYGEN_CONFIG_DIR: resolve(artifacts, 'heygen'), XDG_STATE_HOME: resolve(artifacts, 'state'),
    HYPERFRAMES_FONT_CACHE_DIR: resolve(artifacts, 'fonts'), HYPERFRAMES_EXTRACT_CACHE_DIR: 'off' };
}
