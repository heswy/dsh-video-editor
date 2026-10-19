/**
 * Exact Fetch routes for the Host bridge.
 *
 * Both routes live under Connection's authenticated `/api` fence and use the
 * document-relative URL shape the shipped Web Client uses. The request route is
 * a single typed dispatcher; the artifact route serves only a worker-recorded,
 * re-verified succeeded file for a job this bridge instance started.
 */

import { BridgeError, toPublicError } from './errors.js';

const REQUEST_PATH = '/api/dsh-video/request';
const ARTIFACT_PATH = '/api/dsh-video/artifact';
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
const ARTIFACT_HEADERS = Object.freeze({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** HTTP status for one public bridge error; the JSON error body stays the same. */
export function statusForError(error) {
  if (error instanceof BridgeError === false) return 500;
  switch (error.code) {
    case 'E_REQUEST_LIMIT':
    case 'E_RESULT_LIMIT':
    case 'E_ARTIFACT_LIMIT':
    case 'E_LIMIT':
    case 'E_PREVIEW_LIMIT':
      return 413;
    case 'E_PARAMS':
    case 'E_METHOD':
      return 400;
    case 'E_CONTENT_TYPE':
      return 415;
    case 'E_PROJECT_NOT_FOUND':
    case 'E_JOB_NOT_FOUND':
    case 'E_PREVIEW_NOT_FOUND':
      return 404;
    case 'E_PREVIEW_DENIED':
      return 403;
    case 'E_PREVIEW_UNSUPPORTED':
      return 415;
    case 'E_ARTIFACT_NOT_READY':
    case 'E_PROJECT_CLOSING':
    case 'E_PROJECT_NOT_OPEN':
    case 'E_REVISION_CONFLICT':
    case 'E_OPERATION_REUSED':
    case 'E_UNSUPPORTED_EDIT':
    case 'E_PERSIST':
    case 'E_PROJECT':
      return 409;
    case 'E_ARTIFACT_INTEGRITY':
    case 'E_INTERNAL':
    case 'E_WORKER_RESPONSE':
      return 500;
    default:
      return 503;
  }
}

function publicBody(error) {
  return { ok: false, error: toPublicError(error).error };
}

async function readJsonRequest(request, maxBytes) {
  const contentType = request.headers.get('content-type');
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new BridgeError('E_CONTENT_TYPE', 'Expected application/json', { stage: 'request' });
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BridgeError('E_REQUEST_LIMIT', 'Request exceeds the body size limit', { stage: 'request' });
  }
  let raw;
  try {
    raw = await request.text();
  } catch (_error) {
    throw new BridgeError('E_PARAMS', 'Request body could not be read', { stage: 'request' });
  }
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new BridgeError('E_REQUEST_LIMIT', 'Request exceeds the body size limit', { stage: 'request' });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (_error) {
    throw new BridgeError('E_PARAMS', 'Request body must be JSON', { stage: 'request' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BridgeError('E_PARAMS', 'Request body must be an object', { stage: 'request' });
  }
  const keys = Object.keys(body);
  if (keys.length !== 2 || keys.includes('method') === false || keys.includes('params') === false) {
    throw new BridgeError('E_PARAMS', 'Expected exactly {method, params}', { stage: 'request' });
  }
  if (typeof body.method !== 'string' || body.method.length === 0 || body.method.length > 64) {
    throw new BridgeError('E_PARAMS', 'Invalid method', { stage: 'request' });
  }
  if (body.params === null || typeof body.params !== 'object' || Array.isArray(body.params)) {
    throw new BridgeError('E_PARAMS', 'params must be an object', { stage: 'request' });
  }
  return body;
}

/** Create the POST request dispatcher for one bridge instance. */
export function createRequestRoute(bridge) {
  return {
    path: REQUEST_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const config = bridge.requireConfig();
        const body = await readJsonRequest(request, config.maxRequestBytes);
        const result = await bridge.invoke(body.method, body.params, { source: 'http' });
        return jsonResponse({ ok: true, result }, 200);
      } catch (error) {
        return jsonResponse(publicBody(error), statusForError(error));
      }
    },
  };
}

function artifactJobId(url) {
  const params = [...url.searchParams.entries()];
  if (params.length !== 1 || params[0][0] !== 'jobId') {
    throw new BridgeError('E_PARAMS', 'Expected exactly one jobId query parameter', { stage: 'request' });
  }
  return params[0][1];
}

/** Create the GET/HEAD artifact route for one bridge instance. */
export function createArtifactRoute(bridge) {
  return {
    path: ARTIFACT_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let artifact;
      try {
        artifact = await bridge.readArtifact(artifactJobId(new URL(request.url)));
      } catch (error) {
        if (request.method === 'HEAD') {
          return new Response(null, { status: statusForError(error), headers: { 'cache-control': 'no-store' } });
        }
        return jsonResponse(publicBody(error), statusForError(error));
      }
      const headers = {
        'content-type': artifact.mediaType,
        'content-length': String(artifact.size),
        'content-disposition': `inline; filename="${artifact.filename}"`,
        'x-content-sha256': artifact.hash,
        ...ARTIFACT_HEADERS,
      };
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(artifact.bytes, { status: 200, headers });
    },
  };
}

export const HOST_ROUTES = Object.freeze({ REQUEST_PATH, ARTIFACT_PATH });
