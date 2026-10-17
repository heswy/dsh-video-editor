/**
 * dsh-video — Host half.
 *
 * P0-B deliberately ships an empty Host plugin: the mode switch and the empty
 * video workspace are pure browser UI. There are no business routes, no Tools,
 * no session events and no storage writes yet; project persistence is a later
 * phase (see docs/DECISIONS.md D010).
 *
 * The row still needs a valid Host module so the bundle can be installed and so
 * `dsh.client` activates against an enabled Loader entry. Every future Host
 * resource must be registered inside `ctx.effect` / `ctx.on` and return its
 * cleanup.
 */

/** Cordis plugin body. No dependencies, no side effects. */
export function apply() {}
