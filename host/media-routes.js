/** Authenticated, project-scoped streaming media routes. */
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Readable } from 'node:stream';

export function createMediaRoute(bridge, derived = false) {
  if(!bridge.mediaStreams)bridge.mediaStreams=new Set();
  function requireActive(){if(bridge.closing||bridge.disposed)throw Object.assign(new Error('Media service is stopping'),{code:'E_WORKER_DISPOSED'});}
  return {
    path: derived ? '/api/dsh-video/derived' : '/api/dsh-video/media',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let handle;
      try {
        requireActive();
        const url = new URL(request.url);
        const allowed = derived ? ['projectId', 'assetId', 'kind'] : ['projectId', 'assetId'];
        if (
          [...url.searchParams.keys()].length !== allowed.length ||
          allowed.some((k) => url.searchParams.getAll(k).length !== 1)
        )
          throw new Error('Invalid media query');
        const params = Object.fromEntries(url.searchParams);
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(params.projectId) ||
          !/^as_[a-f0-9]{8}$/.test(params.assetId) ||
          (derived && !['thumb', 'waveform', 'proxy'].includes(params.kind))
        )
          throw new Error('Invalid media query');
        const file = await bridge.resolveMedia(params);
        handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        requireActive();
        if (!info.isFile()) throw new Error('Media unavailable');
        const size = info.size;
        let start = 0,
          end = size - 1,
          status = 200;
        const headers = {
          'content-type': file.mediaType,
          'accept-ranges': 'bytes',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        };
        const range = request.headers.get('range');
        if (range && request.method !== 'HEAD') {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          let valid = !!match && !!(match[1] || match[2]);
          if (valid) {
            if (!match[1]) {
              const suffix = Number(match[2]);
              valid = Number.isSafeInteger(suffix) && suffix > 0;
              start = Math.max(0, size - suffix);
            } else {
              start = Number(match[1]);
              end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
            }
            valid =
              valid &&
              Number.isSafeInteger(start) &&
              Number.isSafeInteger(end) &&
              start >= 0 &&
              start < size &&
              end >= start;
          }
          if (!valid) {
            await handle.close();
            handle = null;
            return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
          }
          status = 206;
          headers['content-range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['content-length'] = String(size === 0 ? 0 : end - start + 1);
        if (request.method === 'HEAD' || size === 0) {
          await handle.close();
          handle = null;
          return new Response(null, { status, headers });
        }
        const stream = handle.createReadStream({ start, end, autoClose: true });
        handle = null;
        bridge.mediaStreams.add(stream);
        const abort = () => stream.destroy();
        request.signal?.addEventListener('abort', abort, { once: true });
        stream.once('close', () => {bridge.mediaStreams.delete(stream);request.signal?.removeEventListener('abort', abort);});
        return new Response(Readable.toWeb(stream), { status, headers });
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        const status = error.code==='E_WORKER_DISPOSED'?503:['E_ASSET_MISSING', 'ENOENT'].includes(error.code) ? 404 : 400;
        return new Response(
          request.method === 'HEAD'
            ? null
            : JSON.stringify({
                ok: false,
                error: { code: error.code || 'E_PARAMS', message: 'Media is unavailable or request is invalid' },
              }),
          { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
        );
      }
    },
  };
}
