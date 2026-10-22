/** Host-only audio providers. Credentials and provider URLs never cross into Tool results. */
import {
  readFile,
  open,
  writeFile,
  mkdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BridgeError } from './errors.js';
const error = (code, message, uncertain = false) =>
  new BridgeError(code, message, { stage: 'audio', uncertain });
const digest = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function atomic(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function json(path, fallback) {
  try {
    if ((await stat(path)).size > 8 * 1024 * 1024)
      throw error('E_AUDIO_STORE', '音频记录超过上限');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw error('E_AUDIO_STORE', '音频配置或记录损坏，已保留原文件');
  }
}
export function mapAudioError(status, code) {
  if (status === 401)
    return error('E_AUDIO_AUTH', '千问云密钥无效，请重新配置');
  if (status === 403)
    return error('E_AUDIO_ENTITLEMENT', '该模型未开通，请申请权限或导入音频');
  if (status === 429)
    return error('E_AUDIO_RATE_LIMIT', '供应商限流，请稍后手动重试');
  if (/Inspection|inspection/.test(code ?? ''))
    return error('E_AUDIO_CONTENT', '生成内容未通过审核，请修改描述');
  if (status === 400)
    return error('E_AUDIO_PARAMS', '供应商不接受本次参数，请缩短或修改描述');
  return error(
    'E_AUDIO_PROVIDER',
    '供应商暂时不可用，请检查任务后手动重试',
    true,
  );
}
export class QianwenProvider {
  constructor({ getKey, fetch: fetchImpl = globalThis.fetch }) {
    this.id = 'qianwen';
    this.getKey = getKey;
    this.fetch = fetchImpl;
  }
  capabilities() {
    return {
      tts: true,
      sfx: true,
      music: 'invitation',
      voiceDesign: false,
      asr: false,
    };
  }
  async check() {
    const key = await this.getKey();
    if (!key) throw error('E_AUDIO_AUTH', '请配置千问云 API Key');
    const r = await this.fetch(
      'https://maas.qianwenaiapi.com/compatible-mode/v1/models',
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw mapAudioError(r.status);
    return {
      connected: true,
      note: '连接成功；具体音频模型权限以生成结果为准',
    };
  }
  async generate(req, { signal }) {
    const key = await this.getKey();
    if (!key) throw error('E_AUDIO_AUTH', '请配置千问云 API Key');
    const music = req.kind === 'music',
      sfx = req.kind === 'sfx';
    const body = music
      ? {
          model: 'fun-music-v1',
          input: { prompt: req.text, is_instrumental: true, format: 'wav' },
        }
      : sfx
        ? {
            model: 'qwen-audio-3.1-tts-next',
            input: {
              text_prompt: req.text,
              format: 'wav',
              sample_rate: 48000,
              channels: 2,
            },
          }
        : {
            model: 'qwen-audio-3.1-tts-flash',
            input: {
              text: req.text,
              voice: req.voice || 'longanhuan_v3.1',
              format: 'wav',
              sample_rate: 48000,
              rate: req.rate ?? 1,
            },
          };
    let r;
    try {
      r = await this.fetch(
        `https://maas.qianwenaiapi.com/api/v1/services/audio/${music ? 'music/generation' : 'tts/SpeechSynthesizer'}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch {
      throw error(
        'E_AUDIO_NETWORK',
        '连接中断；供应商可能已受理，请勿连续重试',
        true,
      );
    }
    let data;
    try {
      const text = await r.text();
      if (text.length > 4 * 1024 * 1024) throw 0;
      data = JSON.parse(text);
    } catch {
      throw error('E_AUDIO_PROVIDER', '供应商返回格式异常', true);
    }
    if (!r.ok) throw mapAudioError(r.status, data.code);
    let address = data.output?.audio?.url;
    // This provider currently emits HTTP OSS URLs; upgrade only its documented
    // artifact host to TLS, without sending credentials to the artifact server.
    try {
      const u = new URL(address);
      if (
        u.protocol === 'http:' &&
        u.hostname === 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com' &&
        !u.port
      ) {
        u.protocol = 'https:';
        address = u.href;
      }
    } catch {}
    // Only the documented HTTPS artifact domains; never follow an unchecked redirect.
    const allowed = (value) => {
      try {
        const u = new URL(value);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.port &&
          (/^[a-z0-9.-]+\.aliyuncs\.com$/.test(u.hostname) ||
            u.hostname === 'maas.qianwenaiapi.com')
        );
      } catch {
        return false;
      }
    };
    if (!allowed(address))
      throw error('E_AUDIO_DOWNLOAD', '生成结果下载地址不受信任', true);
    let url = address,
      response;
    for (let i = 0; i < 4; i++) {
      response = await this.fetch(url, { signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        url = new URL(response.headers.get('location'), url).href;
        if (!allowed(url))
          throw error('E_AUDIO_DOWNLOAD', '生成结果重定向不受信任', true);
        continue;
      }
      break;
    }
    if (!response.ok)
      throw error(
        'E_AUDIO_DOWNLOAD',
        '音频已生成，但下载失败；请勿重复生成',
        true,
      );
    const chunks = [];
    let size = 0;
    for await (const b of response.body) {
      size += b.length;
      if (size > 64 * 1024 * 1024)
        throw error('E_AUDIO_DOWNLOAD', '生成文件超过 64 MiB，未导入', true);
      chunks.push(b);
    }
    if (!size) throw error('E_AUDIO_DOWNLOAD', '供应商返回空音频', true);
    return {
      bytes: Buffer.concat(chunks),
      extension: 'wav',
      usage: {
        duration: data.usage?.duration ?? data.output?.audio?.duration ?? null,
        characters: data.usage?.characters ?? null,
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
      },
      model: body.model,
    };
  }
}
export class LocalSayProvider {
  constructor() {
    this.id = 'local';
  }
  capabilities() {
    return {
      tts: process.platform === 'darwin',
      sfx: false,
      music: false,
      voiceDesign: false,
      asr: false,
    };
  }
  async generate(req, { signal, directory }) {
    if (process.platform !== 'darwin')
      throw error(
        'E_AUDIO_UNSUPPORTED',
        '本地旁白仅支持 macOS，请使用千问云或导入',
      );
    const output = join(directory, randomUUID() + '.aiff');
    const converted = output + '.m4a';
    try {
      await new Promise((res, rej) => {
        const p = spawn(
          '/usr/bin/say',
          [
            '-v',
            ['Tingting', 'Meijia', 'Sinji'].includes(req.voice)
              ? req.voice
              : 'Tingting',
            '-r',
            String(Math.round(180 * (req.rate ?? 1))),
            '-o',
            output,
            '--',
            req.text,
          ],
          { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' }, signal },
        );
        p.on('error', () =>
          rej(error('E_AUDIO_LOCAL', '本地旁白不可用，请检查系统音色')),
        );
        p.on('exit', (code) =>
          code === 0 ? res() : rej(error('E_AUDIO_LOCAL', '本地旁白生成失败')),
        );
      });
      await new Promise((res, rej) => {
        const p = spawn(
          'ffmpeg',
          [
            '-v',
            'error',
            '-y',
            '-i',
            output,
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-ac',
            '2',
            converted,
          ],
          { stdio: 'ignore', env: { PATH: process.env.PATH }, signal },
        );
        p.on('error', () => rej(error('E_AUDIO_LOCAL', '本地音频转换不可用')));
        p.on('exit', (code) =>
          code === 0 ? res() : rej(error('E_AUDIO_LOCAL', '本地音频转换失败')),
        );
      });
      return {
        bytes: await readFile(converted),
        extension: 'm4a',
        model: 'macOS-say',
      };
    } finally {
      await unlink(output).catch(() => {});
      await unlink(converted).catch(() => {});
    }
  }
}
export class AudioService {
  constructor({
    root,
    importAudio,
    providers,
    legacySecrets,
    timeoutMs = 300000,
  }) {
    this.root = root;
    this.timeoutMs = timeoutMs;
    this.importAudio = importAudio;
    this.legacySecrets = legacySecrets;
    this.providers = new Map(
      (
        providers ?? [
          new QianwenProvider({ getKey: () => this.key() }),
          new LocalSayProvider(),
        ]
      ).map((p) => [p.id, p]),
    );
    this.running = new Map();
    this.serial = Promise.resolve();
    this.closed = false;
  }
  async prepare() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  async key() {
    const file = join(this.root, 'audio-secrets.json');
    const s = await json(file, {});
    if (Object.hasOwn(s, 'qianwen')) {
      if (((await stat(file)).mode & 0o077) !== 0)
        throw error('E_AUDIO_AUTH', '密钥文件权限必须为 0600');
      return s.qianwen;
    }
    if (this.legacySecrets) {
      try {
        const st = await stat(this.legacySecrets);
        if ((st.mode & 0o077) !== 0) return null;
        const text = await readFile(this.legacySecrets, 'utf8');
        return (
          text.match(/^QIANWEN_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1] ?? null
        );
      } catch {}
    }
    return null;
  }
  async settings() {
    await this.prepare();
    const permission = await json(
      join(this.root, 'audio-capabilities.json'),
      {},
    );
    return {
      configured: Boolean(await this.key()),
      providers: [...this.providers].map(([id, p]) => ({
        id,
        capabilities: {
          ...p.capabilities(),
          ...(id === 'qianwen' && permission.musicDenied
            ? { music: false }
            : {}),
        },
        ...(id === 'qianwen' && permission.musicDenied
          ? { note: '音乐未开通，请导入配乐；开通后测试连接可重试' }
          : {}),
      })),
      limits: { maxCharacters: 2000, dailyCalls: 20, concurrent: 1 },
      billing:
        '按供应商实际用量计费；无可靠单价时不承诺金额。取消请求可能仍计费；不自动重试。',
    };
  }
  async configure({ apiKey }) {
    await this.prepare();
    if (
      typeof apiKey !== 'string' ||
      apiKey.length > 512 ||
      /[\r\n]/.test(apiKey)
    )
      throw error('E_PARAMS', 'API Key 格式不正确');
    await atomic(join(this.root, 'audio-secrets.json'), { qianwen: apiKey });
    await atomic(join(this.root, 'audio-capabilities.json'), {});
    return this.settings();
  }
  async check() {
    const result = await this.providers.get('qianwen').check();
    await atomic(join(this.root, 'audio-capabilities.json'), {});
    return { ...result, ...(await this.settings()) };
  }
  locked(fn) {
    const result = this.serial.then(fn);
    this.serial = result.catch(() => {});
    return result;
  }
  async store() {
    await this.prepare();
    const s = await json(join(this.root, 'audio-jobs.json'), { jobs: [] });
    if (!Array.isArray(s.jobs))
      throw error('E_AUDIO_STORE', '音频任务记录损坏');
    if (
      s.jobs.some(
        (j) =>
          !j ||
          typeof j.jobId !== 'string' ||
          typeof j.projectId !== 'string' ||
          typeof j.operationId !== 'string' ||
          typeof j.createdAt !== 'string' ||
          typeof j.hash !== 'string' ||
          ![
            'queued',
            'running',
            'downloading',
            'succeeded',
            'failed',
            'cancelled',
            'timed_out',
            'interrupted',
          ].includes(j.state),
      )
    )
      throw error('E_AUDIO_STORE', '音频任务记录损坏，已保留原文件');
    for (const j of s.jobs)
      if (
        !this.running.has(j.jobId) &&
        ['queued', 'running', 'downloading'].includes(j.state)
      ) {
        j.state = 'interrupted';
        j.error = {
          code: 'E_AUDIO_INTERRUPTED',
          message: '上次生成被中断，可能已计费；不会自动重复请求',
          uncertain: true,
        };
      }
    return s;
  }
  async save(s) {
    await atomic(join(this.root, 'audio-jobs.json'), s);
  }
  async generate(req) {
    return this.locked(async () => {
      if (this.closed) throw error('E_AUDIO_CANCELLED', '音频服务已关闭');
      const {
        projectId,
        operationId,
        provider = 'qianwen',
        kind = 'tts',
        text,
        voice,
        rate,
      } = req;
      if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 2000 ||
        !['tts', 'sfx', 'music'].includes(kind) ||
        typeof operationId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(operationId)
      )
        throw error('E_PARAMS', '描述限 1–2000 字符，请提供有效任务 ID');
      const request = {
        projectId,
        operationId,
        provider,
        kind,
        text,
        voice,
        rate,
      };
      if (
        rate !== undefined &&
        (!Number.isFinite(rate) || rate < 0.5 || rate > 2)
      )
        throw error('E_PARAMS', '语速范围为 0.5–2');
      if (
        voice !== undefined &&
        (typeof voice !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(voice))
      )
        throw error('E_PARAMS', '音色格式不正确');
      const hash = digest(request),
        s = await this.store();
      const old = s.jobs.find(
        (j) => j.projectId === projectId && j.operationId === operationId,
      );
      if (old) {
        if (old.hash !== hash)
          throw error('E_OPERATION_REUSED', '任务 ID 已用于不同请求');
        return this.public(old);
      }
      if (
        provider === 'qianwen' &&
        kind === 'music' &&
        (await json(join(this.root, 'audio-capabilities.json'), {})).musicDenied
      )
        throw error(
          'E_AUDIO_ENTITLEMENT',
          '音乐未开通，请导入配乐；开通后测试连接可重试',
        );
      const p = this.providers.get(provider);
      if (!p || !p.capabilities()[kind])
        throw error('E_AUDIO_UNSUPPORTED', '供应商尚未开放此能力，请导入音频');
      if (this.running.size)
        throw error('E_AUDIO_BUSY', '已有音频生成任务，请等待或取消');
      if (
        s.jobs.filter(
          (j) =>
            j.createdAt.slice(0, 10) ===
              new Date().toISOString().slice(0, 10) && j.provider !== 'local',
        ).length >= 20 &&
        provider !== 'local'
      )
        throw error('E_AUDIO_BUDGET', '今日已达 20 次调用护栏，请明日再试');
      if (s.jobs.length >= 1000)
        throw error('E_AUDIO_LIMIT', '音频任务记录已达上限，请保留记录后维护');
      const j = {
        jobId: 'audio_' + randomUUID(),
        projectId,
        operationId,
        provider,
        kind,
        hash,
        createdAt: new Date().toISOString(),
        estimate: {
          characters: text.length,
          approxSpeechSeconds:
            kind === 'tts' ? Math.ceil(text.length / 3.3) : null,
          cny: null,
          note: '仅估算输入规模；费用以供应商账单为准',
        },
        state: 'queued',
      };
      s.jobs.push(j);
      const control = new AbortController();
      this.running.set(j.jobId, { control });
      try {
        await this.save(s);
      } catch {
        this.running.delete(j.jobId);
        throw error('E_AUDIO_STORE', '任务记录未能保存，未向供应商发送请求');
      }
      const task = this.run(j, request, p, control);
      this.running.get(j.jobId).task = task;
      return this.public(j);
    });
  }
  public(j) {
    const { hash, ...result } = j;
    return result;
  }
  async update(j, patch) {
    await this.locked(async () => {
      const s = await this.store();
      Object.assign(j, patch);
      const i = s.jobs.findIndex((x) => x.jobId === j.jobId);
      s.jobs[i] = j;
      await this.save(s);
    });
  }
  async run(j, req, p, control) {
    const timer = setTimeout(() => control.abort('timeout'), this.timeoutMs);
    let file;
    try {
      await this.update(j, { state: 'running' });
      const result = await p.generate(req, {
        signal: control.signal,
        directory: this.root,
      });
      if (control.signal.aborted) throw 0;
      await this.update(j, { state: 'downloading' });
      file = join(this.root, randomUUID() + '.' + result.extension);
      await writeFile(file, result.bytes, { mode: 0o600, flag: 'wx' });
      if (control.signal.aborted) throw 0;
      const imported = await this.importAudio(j.projectId, file, req);
      await this.update(j, {
        state: 'succeeded',
        asset: imported.asset,
        usage: result.usage ?? null,
        model: result.model ?? p.id,
      });
    } catch (e) {
      if (
        j.provider === 'qianwen' &&
        j.kind === 'music' &&
        e?.code === 'E_AUDIO_ENTITLEMENT'
      )
        await this.locked(() =>
          atomic(join(this.root, 'audio-capabilities.json'), {
            musicDenied: true,
          }),
        ).catch(() => {});
      await this.update(j, {
        state: control.signal.aborted
          ? control.signal.reason === 'timeout'
            ? 'timed_out'
            : 'cancelled'
          : 'failed',
        error: {
          code: control.signal.aborted
            ? control.signal.reason === 'timeout'
              ? 'E_AUDIO_TIMEOUT'
              : 'E_AUDIO_CANCELLED'
            : (e?.code ?? 'E_AUDIO_PROVIDER'),
          message: control.signal.aborted
            ? control.signal.reason === 'timeout'
              ? '生成超时；供应商可能已计费，不会自动重试'
              : '已取消；供应商可能仍计费'
            : e instanceof BridgeError
              ? e.message
              : '生成失败，请检查连接后重试',
          uncertain: control.signal.aborted || e?.uncertain === true,
        },
      }).catch(() => {});
    } finally {
      clearTimeout(timer);
      if (file) await unlink(file).catch(() => {});
      this.running.delete(j.jobId);
    }
  }
  async status(projectId, jobId) {
    const s = await this.store();
    if (!jobId)
      return {
        jobs: s.jobs
          .filter((j) => j.projectId === projectId)
          .slice(-20)
          .reverse()
          .map((j) => this.public(j)),
      };
    const j = s.jobs.find(
      (j) => j.jobId === jobId && j.projectId === projectId,
    );
    if (!j) throw error('E_JOB_NOT_FOUND', '音频任务不存在');
    return this.public(j);
  }
  async cancel(projectId, jobId) {
    const j = await this.status(projectId, jobId);
    this.running.get(jobId)?.control.abort();
    return { ...j, state: this.running.has(jobId) ? 'cancelling' : j.state };
  }
  async dispose() {
    this.closed = true;
    const tasks = [...this.running.values()];
    for (const r of tasks) r.control.abort();
    await Promise.allSettled(tasks.map((r) => r.task));
  }
}
