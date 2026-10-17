/**
 * `video_engine` Tool definition.
 *
 * The Tool deliberately has the same actions and typed parameters as the Fetch
 * dispatcher; both call VideoBridge.invoke(). It returns a bounded structured
 * result and a concise text rendering, never an artifact attachment, raw engine
 * log, stderr or Host path. Every uncertainty flag survives into the model-facing
 * error message.
 */

import { BridgeError, toPublicError } from './errors.js';
import { TOOL_RESULT_BYTES } from './limits.js';

export const TOOL_NAME = 'video_engine';

const ACTIONS = Object.freeze([
  'doctor',
  'open',
  'inspect',
  'edit',
  'frame',
  'render',
  'status',
  'cancel',
  'close',
]);

const TOOL_PARAMETERS = Object.freeze({
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description: 'The video operation to perform on the configured controlled project.',
    },
    projectId: {
      type: 'string',
      description: 'A project id from the Host-configured allowlist. Paths and URLs are never accepted.',
    },
    jobId: {
      type: 'string',
      description: 'A job id returned by frame or render in this Host plugin lifetime.',
    },
    revision: {
      type: 'string',
      description: 'The exact 64-character lowercase SHA-256 project revision to render.',
    },
    expectedRevision: {
      type: 'string',
      description: 'The revision the edit expects; a mismatch is returned as a conflict.',
    },
    operationId: {
      type: 'string',
      description: 'Caller-generated idempotency key for one edit.',
    },
    ops: {
      type: 'array',
      description: 'One to thirty-two typed text/timing edits for an existing element.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'timing'] },
          target: { type: 'string', description: 'Stable element id from inspect.' },
          text: { type: 'string', description: 'Replacement text for a text edit.' },
          start: { type: 'number', description: 'New start time in seconds for a timing edit.' },
          duration: { type: 'number', description: 'New duration in seconds for a timing edit.' },
        },
        required: ['type', 'target'],
        additionalProperties: false,
      },
    },
    time: { type: 'number', description: 'Frame time in seconds.' },
    timeoutMs: { type: 'integer', description: 'Worker job deadline in milliseconds.' },
  },
  required: ['action'],
  additionalProperties: false,
});

const ACTION_FIELDS = Object.freeze({
  doctor: [],
  open: ['projectId'],
  inspect: ['projectId'],
  edit: ['projectId', 'expectedRevision', 'operationId', 'ops'],
  frame: ['projectId', 'revision', 'time', 'timeoutMs'],
  render: ['projectId', 'revision', 'timeoutMs'],
  status: ['jobId'],
  cancel: ['jobId'],
  close: ['projectId'],
});

function formatError(error) {
  const publicError = toPublicError(error).error;
  const flags = [
    publicError.code,
    publicError.stage,
    publicError.uncertain === true ? 'uncertain=true' : null,
    publicError.jobUnknown === true ? 'jobUnknown=true' : null,
  ].filter((part) => typeof part === 'string' && part.length > 0);
  return `${publicError.message} [${flags.join(', ')}]`.slice(0, 600);
}

function projectParams(action, args) {
  const fields = ACTION_FIELDS[action];
  if (fields === undefined) throw new BridgeError('E_METHOD', 'Unknown video action', { stage: 'params' });
  const params = {};
  for (const field of fields) {
    if (args[field] !== undefined) params[field] = args[field];
  }
  const extras = Object.keys(args).filter((key) => key !== 'action' && fields.includes(key) === false);
  if (extras.length > 0) throw new BridgeError('E_PARAMS', `Unexpected parameter for "${action}": ${extras.join(', ')}`, { stage: 'params' });
  return params;
}

/** Serialize once and enforce the shared raw UTF-8 budget; never truncate. */
function boundedToolValue(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (_error) {
    throw new BridgeError('E_RESULT_LIMIT', 'The tool result is not bounded JSON', { stage: 'result' });
  }
  if (typeof text !== 'string') {
    throw new BridgeError('E_RESULT_LIMIT', 'The tool result is not bounded JSON', { stage: 'result' });
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > TOOL_RESULT_BYTES) {
    throw new BridgeError('E_RESULT_LIMIT', `The tool result exceeds ${TOOL_RESULT_BYTES} UTF-8 bytes`, { stage: 'result' });
  }
  return text;
}

/** Create the Tool definition; the Tool calls exactly the same bridge dispatcher. */
export function createVideoTool(bridge) {
  return {
    name: TOOL_NAME,
    description:
      'Open, inspect, edit, frame, render, observe, cancel and close a controlled video project configured by the Host. Accepts only configured project ids and locally registered job ids; never accepts paths or URLs.',
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: boundedToolValue(value) }];
      },
    },
    async execute(args, _exec) {
      const action = args && typeof args === 'object' ? args.action : undefined;
      let params;
      try {
        params = projectParams(action, args || {});
      } catch (error) {
        throw new Error(formatError(error));
      }
      try {
        const result = await bridge.invoke(action, params, { source: 'tool' });
        const value = { action, result };
        // Validate the complete wrapper, not just the inner result: execute must
        // fail loudly before a later renderer could silently shorten it.
        boundedToolValue(value);
        return value;
      } catch (error) {
        throw new Error(formatError(error));
      }
    },
  };
}
