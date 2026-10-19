#!/usr/bin/env node
/**
 * Read-only ASAR inspector for the installed DSH Desktop app (P3-005-A).
 *
 * The Harness Desktop keeps its runtime packages inside `app.asar`, which native
 * tools (rg, ls, node fs) cannot open as a directory. This script parses the
 * ASAR header itself and only reads bytes; it never executes packaged code,
 * never writes into the app bundle and never touches a profile or session.
 *
 * Usage:
 *   node asar-read.mjs tree [prefix]
 *   node asar-read.mjs list [prefix] [--limit N]
 *   node asar-read.mjs read <path> [--max-bytes N]
 *   node asar-read.mjs grep <regex> [--prefix P] [--ext js,ts,md,json] [--max N] [--width W]
 *
 * Exit codes: 0 found/ok, 1 no match/not found, 2 usage or parse error.
 */

import { closeSync, openSync, readFileSync, readSync } from 'node:fs';

const DEFAULT_ARCHIVE = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const ARCHIVE = process.env.DSH_ASAR || DEFAULT_ARCHIVE;

function usage(message) {
  if (message) console.error(message);
  console.error('usage: asar-read.mjs tree [prefix] | list [prefix] [--limit N] | read <path> [--max-bytes N] | lines <path> <from> <to> | grep <regex> [--prefix P] [--ext js,ts,md,json] [--max N] [--width W]');
  process.exit(2);
}

function parseArchive() {
  const fd = openSync(ARCHIVE, 'r');
  try {
    // ASAR layout (Electron pickle):
    //   uint32[0] = 4 (size-pickle payload), uint32[1] = header pickle size,
    //   uint32[2] = header payload size, uint32[3] = JSON byte length,
    //   JSON starts at byte 16, file data starts after the 4-byte-aligned JSON.
    const prefix = Buffer.alloc(16);
    const prefixed = readSync(fd, prefix, 0, prefix.length, 0);
    if (prefixed !== prefix.length) throw new Error('short ASAR prefix read');
    const headerSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (headerSize < 16 || headerSize > 128 * 1024 * 1024) throw new Error(`unexpected ASAR header size ${headerSize}`);
    if (jsonLength < 8 || jsonLength > headerSize) throw new Error(`unexpected ASAR JSON length ${jsonLength} (header ${headerSize})`);
    const headerBytes = Buffer.alloc(jsonLength);
    const read = readSync(fd, headerBytes, 0, headerBytes.length, 16);
    if (read !== headerBytes.length) throw new Error('short ASAR header read');
    let header;
    try {
      header = JSON.parse(headerBytes.toString('utf8').replace(/\0+$/, ''));
    } catch (error) {
      throw new Error(`ASAR header is not JSON: ${error.message}`);
    }
    const dataOffset = Math.ceil((16 + jsonLength) / 4) * 4;
    return { fd, header, dataOffset };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function walk(node, prefix, output) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (entry.files) walk(entry, path, output);
    else output.push({ path, size: entry.size, offset: entry.offset, unpacked: entry.unpacked === true });
  }
  return output;
}

function filesUnder(tree, wanted) {
  const prefix = wanted === undefined || wanted === '' ? '' : wanted.replace(/\/+$/, '');
  return tree.filter((file) => prefix === '' || file.path === prefix || file.path.startsWith(prefix + '/'));
}

function readEntry(archive, tree, wanted) {
  const entry = tree.find((file) => file.path === wanted);
  if (!entry) throw new Error(`not found in ASAR: ${wanted}`);
  if (entry.unpacked) throw new Error(`entry is unpacked next to the ASAR, not inline: ${wanted}`);
  const bytes = Buffer.alloc(entry.size);
  const read = readSync(archive.fd, bytes, 0, bytes.length, archive.dataOffset + Number(entry.offset));
  if (read !== bytes.length) throw new Error(`short read for ${wanted}`);
  return bytes;
}

function parseOptions(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--limit' || item === '--max-bytes' || item === '--prefix' || item === '--ext' || item === '--max' || item === '--width') {
      options[item.slice(2)] = argv[index + 1];
      index += 1;
    } else if (item.startsWith('--')) usage(`unknown option ${item}`);
    else positional.push(item);
  }
  return { positional, options };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();
  const command = argv[0];
  const { positional, options } = parseOptions(argv.slice(1));
  const archive = parseArchive();
  try {
    const tree = walk(archive.header, '', []);
    if (command === 'tree') {
      const prefix = positional[0] || 'dsh/node_modules/@deepseek-ai';
      const files = filesUnder(tree, prefix);
      const directories = new Set();
      for (const file of files) {
        const rest = file.path.slice(prefix === '' ? 0 : prefix.length + 1);
        if (rest.includes('/')) directories.add(rest.split('/')[0]);
      }
      for (const directory of [...directories].sort()) console.log(`${prefix}/${directory}`);
      return;
    }
    if (command === 'list') {
      const files = filesUnder(tree, positional[0]);
      const limit = options.limit === undefined ? files.length : Number(options.limit);
      for (const file of files.slice(0, limit)) console.log(`${file.size}\t${file.path}${file.unpacked ? '\t(unpacked)' : ''}`);
      if (files.length > limit) console.error(`... ${files.length - limit} more files`);
      return;
    }
    if (command === 'read') {
      if (!positional[0]) usage('read needs an ASAR path');
      let bytes = readEntry(archive, tree, positional[0]);
      if (options['max-bytes'] !== undefined) bytes = bytes.subarray(0, Number(options['max-bytes']));
      process.stdout.write(bytes);
      return;
    }
    if (command === 'lines') {
      if (!positional[0] || positional[1] === undefined || positional[2] === undefined) usage('lines needs <path> <from> <to>');
      const from = Number(positional[1]);
      const to = Number(positional[2]);
      const lines = readEntry(archive, tree, positional[0]).toString('utf8').split('\n');
      for (let index = from - 1; index < Math.min(to, lines.length); index += 1) console.log(`${index + 1}\t${lines[index]}`);
      return;
    }
    if (command === 'grep') {
      const source = positional[0];
      if (!source) usage('grep needs a regular expression');
      const regex = new RegExp(source, 'i');
      const extensions = options.ext === undefined ? ['js', 'mjs', 'cjs', 'ts', 'tsx', 'd.ts', 'md', 'json', 'css', 'yaml', 'yml'] : options.ext.split(',');
      const max = options.max === undefined ? 200 : Number(options.max);
      const width = options.width === undefined ? 300 : Number(options.width);
      const files = filesUnder(tree, options.prefix).filter((file) => extensions.some((extension) => file.path.endsWith(`.${extension}`)) && file.unpacked !== true);
      let matches = 0;
      for (const file of files) {
        let text;
        try {
          text = readEntry(archive, tree, file.path).toString('utf8');
        } catch (_error) {
          continue;
        }
        if (text.includes('\0')) continue;
        const lines = text.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
          if (regex.test(lines[index])) {
            console.log(`${file.path}:${index + 1}: ${lines[index].slice(0, width)}`);
            matches += 1;
            if (matches >= max) {
              console.error(`... stopped at --max ${max}`);
              process.exitCode = 0;
              return;
            }
          }
        }
      }
      if (matches === 0) {
        console.error('no match');
        process.exitCode = 1;
      }
      return;
    }
    usage(`unknown command ${command}`);
  } finally {
    closeSync(archive.fd);
  }
}

try {
  main();
} catch (error) {
  console.error(`asar-read failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
