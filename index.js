import { releaseConfig } from './host/release-runtime.js';
import { PluginUpdates, createUpdateRoute } from './host/updates.js';
import { createMediaRoute } from './host/media-routes.js';
/**
 * dsh-video — Host half.
 *
 * One plugin-local VideoBridge serves both exact Fetch routes and the
 * `video_engine` Tool. Import and `apply` register resources only; the worker is
 * started lazily by the first explicit business request and is owned by this
 * plugin fiber. Disabling the plugin refuses new work and awaits one teardown.
 *
 * Configuration is trusted deployment data (see README): a real Node executable,
 * a prepared controlled registry/output root, a private worker cwd and a non-empty
 * project allowlist. Missing configuration keeps the shell alive and returns
 * E_CONFIGURATION from business requests rather than guessing paths.
 */

import { VideoBridge } from './host/bridge.js';
import { createArtifactRoute, createRequestRoute } from './host/routes.js';
import { createVideoTool } from './host/tool.js';

export const inject = ['connection', 'tools', 'subprocess'];

function report(ctx, code, error) {
  try {
    const logger = ctx && ctx.logger;
    if (logger && typeof logger.warn === 'function') logger.warn(`dsh-video: ${code}`, error === undefined ? '' : error);
  } catch (_ignored) {
    /* diagnostics must not break activation */
  }
}

function safeDispose(disposer, ctx, code) {
  if (typeof disposer !== 'function') return;
  try {
    const result = disposer();
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      result.catch((error) => report(ctx, code, error));
    }
  } catch (error) {
    report(ctx, code, error);
  }
}

/** Cordis plugin body. */
export function apply(ctx, config) {
  const bridge = new VideoBridge({ ctx, rawConfig: releaseConfig(config) });
  const disposers = [];
  let manager;try{manager=ctx.get?.('pluginManager');}catch{}
  const updates=new PluginUpdates({manager,beforeInstall:async()=>{
    for(const [jobId,job] of bridge.jobs){const result=await bridge.callClient('status',{jobId});if(!['succeeded','failed','cancelled','timed_out'].includes(result.state))throw new Error('Render in progress');}
  }});

  ctx.effect(
    function hostBridgeResources() {
      try{disposers.push(ctx.connection.fetch.register(createUpdateRoute(updates)));}catch(error){report(ctx,'update-route-registration-failed',error);}
      try {
        disposers.push(ctx.connection.fetch.register(createRequestRoute(bridge)));
      } catch (error) {
        report(ctx, 'request-route-registration-failed', error);
      }
      try {
        disposers.push(ctx.connection.fetch.register(createArtifactRoute(bridge)));
        disposers.push(ctx.connection.fetch.register(createMediaRoute(bridge)));
        disposers.push(ctx.connection.fetch.register(createMediaRoute(bridge,true)));
      } catch (error) {
        report(ctx, 'artifact-route-registration-failed', error);
      }
      try {
        disposers.push(ctx.tools.register(createVideoTool(bridge)));
      } catch (error) {
        report(ctx, 'tool-registration-failed', error);
      }
      try {
        disposers.push(bridge.installAssetRoute());
      } catch (error) {
        report(ctx, 'asset-route-registration-failed', error);
      }

      return async function disposeHostBridge() {
        updates.dispose();
        for (const disposer of disposers.splice(0).reverse()) {
          safeDispose(disposer, ctx, 'host-resource-cleanup-failed');
        }
        try {
          await bridge.dispose();
        } catch (error) {
          report(ctx, 'bridge-dispose-failed', error);
        }
      };
    },
    'dsh-video: host bridge'
  );
}
