/** Resolve installed dependencies through Node, including pnpm and parent layouts. */
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function dependencyManifest(name) {
  // The pinned SDK exposes its ESM entry but not package.json.
  const url = name === '@hyperframes/sdk'
    ? new URL('../package.json', import.meta.resolve('@hyperframes/sdk')).href
    : import.meta.resolve(name + '/package.json');
  return fileURLToPath(url);
}

export function dependencyFile(name, path) {
  return resolve(dirname(dependencyManifest(name)), path);
}
