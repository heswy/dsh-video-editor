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
import { agentSessionIdFromToolExec } from './sessions.js';

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
  'project.compose',
  'project.source',
  'scene.create',
  'scene.update',
  'scene.remove',
  'scene.reorder',
  'project.revise',
  'history',
  'undo',
  'redo',
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
      description: 'One to thirty-two typed text/timing/layout/style edits for an existing element.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'timing', 'layout', 'style'] },
          target: { type: 'string', description: 'Stable element id from inspect.' },
          text: { type: 'string', description: 'Replacement text for a text edit.' },
          start: { type: 'number', description: 'New start time in seconds for a timing edit.' },
          duration: { type: 'number', description: 'New duration in seconds for a timing edit.' },
          unit: { const: 'composition-px', description: 'Layout unit.' },
          box: {
            type: 'object',
            properties: {
              left: { type: 'number' },
              top: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            additionalProperties: false,
          },
          styles: {
            type: 'object',
            properties: {
              color: { type: 'string' },
              fontSize: { type: 'number' },
              fontWeight: { type: 'integer' },
              textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
            },
            additionalProperties: false,
          },
        },
        required: ['type', 'target'],
        additionalProperties: false,
      },
    },
    time: { type: 'number', description: 'Frame time in seconds (legacy single-frame form).' },
    times: {
      type: 'array',
      description:
        'One to four distinct frame times in seconds; together they render once and return a single horizontally tiled contact sheet. Provide exactly one of time or times.',
      items: { type: 'number' },
      minItems: 1,
      maxItems: 4,
    },
    wait: {
      type: 'boolean',
      description:
        'Host-side: wait for the frame job to reach a terminal state (succeeded/failed/cancelled/timed_out) before returning that status view. Capped at 30 seconds or timeoutMs, whichever is smaller; the job stays queryable with status if the wait expires.',
    },
    timeoutMs: { type: 'integer', description: 'Worker job deadline in milliseconds.' },
    sceneId: { type: 'string', description: 'Stable Scene id for scene operations.' },
    afterSceneId: { type: 'string', description: 'Insert a new Scene after this Scene id.' },
    order: { type: 'array', items: { type: 'string' }, description: 'Complete Scene order (unique ids).' },
    baseRevision: { type: 'string', description: 'AI base revision for project.revise.' },
    limit: { type: 'integer', description: 'History entry limit (1-64).' },
    html: {
      type: 'string',
      description:
        'Complete HTML composition document for project.compose (1..48 KiB UTF-8): one #main element with data-composition-id and numeric data-width/data-height/data-duration, window.__timelines.main, and no external URLs. The whole document replaces the previous version atomically.',
    },
    template: {
      type: 'object',
      description: 'Controlled product-launch-v1 Scene template; omitted optional fields fall back to template defaults.',
      properties: {
        title: { type: 'string' },
        duration: { type: 'number' },
        subtitle: { type: 'string' },
        badge: { type: 'string' },
        color: { type: 'string' },
        accent: { type: 'string' },
        logo: { type: 'string' },
        shot: { type: 'string' },
      },
      required: ['title', 'duration'],
      additionalProperties: false,
    },
  },
  required: ['action'],
  additionalProperties: false,
});

const ACTION_FIELDS = Object.freeze({
  doctor: [],
  open: ['projectId'],
  inspect: ['projectId'],
  edit: ['projectId', 'expectedRevision', 'operationId', 'ops'],
  frame: ['projectId', 'revision', 'time', 'times', 'timeoutMs', 'wait'],
  render: ['projectId', 'revision', 'timeoutMs'],
  status: ['jobId'],
  cancel: ['jobId'],
  close: ['projectId'],
  'project.compose': ['projectId', 'expectedRevision', 'operationId', 'html'],
  'project.source': ['projectId'],
  'scene.create': ['projectId', 'expectedRevision', 'operationId', 'sceneId', 'afterSceneId', 'template'],
  'scene.update': ['projectId', 'expectedRevision', 'operationId', 'sceneId', 'template'],
  'scene.remove': ['projectId', 'expectedRevision', 'operationId', 'sceneId'],
  'scene.reorder': ['projectId', 'expectedRevision', 'operationId', 'order'],
  'project.revise': ['projectId', 'baseRevision', 'expectedRevision', 'operationId', 'sceneId', 'template'],
  history: ['projectId', 'limit'],
  undo: ['projectId', 'expectedRevision', 'operationId'],
  redo: ['projectId', 'expectedRevision', 'operationId'],
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
      'Open, inspect, edit, publish a complete HTML composition, frame, render, observe, cancel, close, and operate on Scenes/history of a controlled video project configured by the Host. To create or change the video, read the current revision with inspect (and project.source for the current full HTML), then submit the complete document once with project.compose and the current expectedRevision; the left preview follows the published revision automatically. When a visual self-check is genuinely needed, call frame once with wait:true and up to 3 times (one call returns a single contact-sheet image), then read that image at most once; do not render locally or use shell/file probing tools to find frames. A succeeded wait:true frame result also carries frameImage, a workspace-relative PNG path you can pass directly to read_image (read it once). Accepts only configured project ids; never accepts paths or URLs. Never write project files with shell or file tools; report typed errors honestly instead of claiming success.',
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: boundedToolValue(value) }];
      },
    },
    async execute(args, exec) {
      const action = args && typeof args === 'object' ? args.action : undefined;
      let params;
      let agentSessionId = null;
      try {
        params = projectParams(action, args || {});
        agentSessionId = agentSessionIdFromToolExec(exec);
      } catch (error) {
        throw new Error(formatError(error));
      }
      try {
        const result = await bridge.invoke(action, params, { source: 'tool', agentSessionId });
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
