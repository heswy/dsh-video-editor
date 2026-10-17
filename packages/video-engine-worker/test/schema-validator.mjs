// Minimal JSON Schema draft 2020-12 subset validator, used only by the
// protocol contract tests. The worker has no runtime schema dependency; this
// file exists so schema drift breaks `npm test` instead of users.
//
// Supported keywords: $ref (local pointers), oneOf, anyOf, allOf, type,
// const, enum, required, properties, additionalProperties (boolean), items,
// minItems, maxItems, uniqueItems, minLength, maxLength, pattern, minimum,
// maximum. Unsupported keywords are an error, not silently ignored, so a new
// schema feature cannot quietly stop being validated.

function resolveRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/"))
    throw new Error(`Unsupported $ref ${JSON.stringify(ref)}`);
  let node = root;
  for (const raw of ref.slice(2).split("/")) {
    const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !(part in node))
      throw new Error(`Unresolved $ref ${ref}`);
    node = node[part];
  }
  return node;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    default:
      throw new Error(`Unsupported type ${JSON.stringify(type)}`);
  }
}

const SUPPORTED = new Set([
  // Schema-document metadata/annotations (no validation semantics).
  "$schema",
  "$id",
  "title",
  "$comment",
  "x-methods",
  "$defs",
  "$ref",
  "oneOf",
  "anyOf",
  "allOf",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
]);

function walk(value, schema, root, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema))
    throw new Error(`Invalid schema node at ${path}`);
  for (const key of Object.keys(schema))
    if (!SUPPORTED.has(key))
      throw new Error(`Unsupported schema keyword ${key} at ${path}`);
  if ("$ref" in schema) {
    walk(value, resolveRef(root, schema.$ref), root, path, errors);
    return;
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const))
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (Array.isArray(schema.enum)) {
    const matches = schema.enum.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
    );
    if (!matches)
      errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validate(value, candidate, root, path).length === 0,
    ).length;
    if (matches !== 1) errors.push(`${path}: oneOf matched ${matches} branches`);
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some(
      (candidate) => validate(value, candidate, root, path).length === 0,
    );
    if (!ok) errors.push(`${path}: anyOf matched no branch`);
  }
  if (Array.isArray(schema.allOf))
    for (const candidate of schema.allOf)
      errors.push(...validate(value, candidate, root, path));
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(
        `${path}: expected type ${types.join("|")}, got ${typeOf(value)} (${JSON.stringify(value)})`,
      );
      return;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length)
        errors.push(`${path}: items are not unique`);
    }
    if (schema.items !== undefined)
      value.forEach((item, index) =>
        errors.push(...validate(item, schema.items, root, `${path}[${index}]`)),
      );
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required))
      for (const name of schema.required)
        if (!(name in value)) errors.push(`${path}: missing required ${name}`);
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value))
        if (!(name in properties))
          errors.push(`${path}: unexpected property ${name}`);
    }
    for (const [name, propertySchema] of Object.entries(properties))
      if (name in value)
        errors.push(
          ...validate(value[name], propertySchema, root, `${path}.${name}`),
        );
  }
}

/**
 * Validate `value` against `schema` (resolving local `$ref` against `root`).
 * An empty error list means the value matches.
 */
export function validate(value, schema, root = schema, path = "$") {
  const errors = [];
  walk(value, schema, root, path, errors);
  return errors;
}

/** Collect every local `$ref` string in the schema, for resolution tests. */
export function collectRefs(node, refs = new Set()) {
  if (node === null || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
    return refs;
  }
  if (typeof node.$ref === "string") refs.add(node.$ref);
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref") continue;
    collectRefs(value, refs);
  }
  return refs;
}

export { resolveRef };
