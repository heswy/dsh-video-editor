/**
 * Stage-time bundle version admission (P2-007).
 *
 * `scripts/stage-dev.mjs` must never guess which root bundle version was
 * reviewed. The operator declares it explicitly with `--bundle-version <semver>`
 * and the value must equal the version in the committed root package.json of
 * the exact commit being staged (the pinned manifest source). A malformed value
 * or a mismatch is rejected before the output directory is created or any
 * dependency install runs.
 *
 * These helpers are pure and side-effect free so `scripts/test-stage-version.mjs`
 * can prove the behavior without creating a staging snapshot or installing
 * anything. Full staging success is separate delivery evidence, not asserted
 * here.
 */

// Semver 2.0.0 grammar, including prerelease and build metadata. Source:
// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Parse one declared or committed bundle version.
 * Accepts only a complete semver string; rejects partial, prefixed, padded or
 * otherwise ambiguous values instead of coercing them.
 */
export function parseBundleVersion(value, label) {
  const name = typeof label === 'string' && label.length > 0 ? label : 'bundle version';
  if (typeof value !== 'string' || SEMVER.test(value) === false) {
    throw new Error(`invalid ${name} ${JSON.stringify(value)}; expected a strict semver (for example 0.2.2)`);
  }
  return value;
}

/**
 * Admit the explicitly declared expected version only when it equals the
 * pinned committed manifest version. Exact string equality is intentional: the
 * gate answers "is this the reviewed version of this exact commit", not semver
 * precedence.
 */
export function admitBundleVersion(options) {
  const expected = parseBundleVersion(options.expectedVersion, '--bundle-version');
  const manifest = parseBundleVersion(options.manifestVersion, 'committed root package.json version');
  if (expected !== manifest) {
    throw new Error(`root bundle version is ${manifest}, expected ${expected}; update --bundle-version or stage the reviewed commit`);
  }
  return { expectedVersion: expected, manifestVersion: manifest };
}
