import { spawn, execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { owned, root, toolEnv } from './paths.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/);
    return m && { pid: Number(m[1]), ppid: Number(m[2]), started: m[3], command: m[4] };
  }).filter(Boolean);
}
export async function runOwned(argv, { temp, signal, timeoutMs = 120000, onOutput = () => {}, beforeCleanup = () => {} } = {}) {
  if (process.platform === 'win32') throw new Error('Process ownership spike supports POSIX only');
  temp = owned(temp);
  if (signal?.aborted) { await rm(temp, { recursive: true, force: true }); return { status: 'cancelled', pid: null }; }
  const child = spawn(argv[0], argv.slice(1), { cwd: root, env: toolEnv(temp), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const identities = new Map();
  // Track ancestry while parents are alive, including detached Chrome groups.
  // A private per-job temp path also identifies reparented Chrome helpers.
  function scan() {
    const rows = processes();
    let changed;
    do {
      changed = false;
      for (const row of rows) {
        if (!identities.has(row.pid) && (row.pid === child.pid || identities.has(row.ppid) || row.command.includes(temp + '/'))) {
          identities.set(row.pid, row); changed = true;
        }
      }
    } while (changed);
    return rows.filter(row => {
      const id = identities.get(row.pid);
      return id && id.started === row.started && id.command === row.command;
    });
  }
  function killOwned(sig) {
    const rows = scan().reverse();
    for (const row of rows) {
      try { process.kill(row.pid, sig); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  let reason, stopping, output = '';
  const stop = why => {
    if (stopping) return;
    reason = why;
    stopping = (async () => { killOwned('SIGTERM'); await delay(1400); killOwned('SIGKILL'); })();
  };
  const abort = () => stop('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  const tracker = setInterval(scan, 100);
  const timer = setTimeout(() => stop('timed_out'), timeoutMs);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { const s = b.toString(); output += s; onOutput(s); });
  try {
    scan();
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await stopping;
    killOwned('SIGKILL');
    for (let i = 0; i < 20 && scan().length; i++) await delay(100);
    const survivors = scan();
    if (survivors.length) throw new Error(`Owned processes survived: ${survivors.map(r=>r.pid)}`);
    return { status: reason || (exit.code === 0 ? 'complete' : 'failed'), pid: child.pid, ...exit,
      ownedPids: [...identities.keys()], survivors: [], output };
  } finally {
    clearTimeout(timer); clearInterval(tracker);
    signal?.removeEventListener('abort', abort);
    killOwned('SIGKILL');
    try { await beforeCleanup(); } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
