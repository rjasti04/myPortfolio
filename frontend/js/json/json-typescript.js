/**
 * TypeScript Interface Generator (`json-typescript.js`)
 *
 * `toTypeScript(value, rootName)` infers a set of interfaces from a sample
 * document.
 *
 * Inference happens in two passes rather than one, because the interesting
 * information only exists across siblings. The first pass unifies every value
 * that reaches a position into one schema node: an array of objects where the
 * third element lacks `nickname` records that `nickname` was seen 2 times out of
 * 3, which is what makes it `nickname?: string` instead of a second interface.
 * The second pass emits, de-duplicating structurally identical shapes so five
 * copies of the same object become one named interface used five times.
 *
 * One-way by design. Generating a sample document *from* a TypeScript
 * declaration is a second grammar and a separate feature.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

const MAX_DEPTH = 60;
const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function newSchema() {
  return {
    kinds: new Set(),
    props: new Map(),
    objectCount: 0,
    items: null,
    arrayCount: 0,
    emptyArray: false,
  };
}

/** Fold one value into a schema node, merging with everything seen before. */
function absorb(schema, value, depth) {
  if (depth > MAX_DEPTH) {
    schema.kinds.add("unknown");
    return;
  }
  if (value === null) {
    schema.kinds.add("null");
    return;
  }
  if (Array.isArray(value)) {
    schema.arrayCount += 1;
    if (value.length === 0) {
      schema.emptyArray = true;
      return;
    }
    if (!schema.items) schema.items = newSchema();
    for (const item of value) absorb(schema.items, item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    schema.objectCount += 1;
    for (const key of Object.keys(value)) {
      let entry = schema.props.get(key);
      if (!entry) {
        entry = { schema: newSchema(), seen: 0 };
        schema.props.set(key, entry);
      }
      entry.seen += 1;
      absorb(entry.schema, value[key], depth + 1);
    }
    return;
  }
  const kind = typeof value;
  schema.kinds.add(kind === "string" || kind === "number" || kind === "boolean" ? kind : "unknown");
}

function pascalCase(text) {
  const cleaned = String(text)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (cleaned === "") return "Item";
  const name = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(name) ? `N${name}` : name;
}

/** Crude singularisation, enough to turn `users` into `User`. */
function singular(text) {
  if (/ies$/i.test(text)) return `${text.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(text)) return text.slice(0, -2);
  if (/[^s]s$/i.test(text)) return text.slice(0, -1);
  return text;
}

export function toTypeScript(value, rootName = "Root") {
  if (value === undefined) return "";

  const root = newSchema();
  absorb(root, value, 0);

  /** Emitted interface bodies, keyed by structural signature for reuse. */
  const bySignature = new Map();
  const used = new Set();
  const declarations = [];

  function uniqueName(hint) {
    const base = pascalCase(hint) || "Item";
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base}${n}`)) n += 1;
    const name = `${base}${n}`;
    used.add(name);
    return name;
  }

  function typeOf(schema, hint, depth) {
    const parts = [];

    if (schema.objectCount > 0) {
      if (schema.props.size === 0) {
        parts.push("Record<string, unknown>");
      } else if (depth > MAX_DEPTH) {
        parts.push("unknown");
      } else {
        const members = [];
        for (const [key, entry] of schema.props) {
          const optional = entry.seen < schema.objectCount;
          const label = VALID_IDENTIFIER.test(key) ? key : JSON.stringify(key);
          const memberType = typeOf(entry.schema, singular(key), depth + 1);
          members.push(`  ${label}${optional ? "?" : ""}: ${memberType};`);
        }
        const body = members.join("\n");
        const existing = bySignature.get(body);
        if (existing) {
          parts.push(existing);
        } else {
          const name = uniqueName(hint);
          bySignature.set(body, name);
          // Registered before the body is pushed so a self-referencing shape
          // resolves to its own name rather than recursing forever.
          declarations.push(`export interface ${name} {\n${body}\n}`);
          parts.push(name);
        }
      }
    }

    if (schema.arrayCount > 0) {
      if (!schema.items) {
        parts.push("unknown[]");
      } else {
        const inner = typeOf(schema.items, hint, depth + 1);
        parts.push(inner.includes("|") ? `(${inner})[]` : `${inner}[]`);
      }
    }

    for (const kind of ["string", "number", "boolean", "null", "unknown"]) {
      if (schema.kinds.has(kind)) parts.push(kind);
    }

    if (parts.length === 0) return "unknown";
    // Stable order, de-duplicated: `string | number` never flips between runs.
    return [...new Set(parts)].join(" | ");
  }

  const rootType = typeOf(root, rootName, 0);
  const header = `// Generated from a sample document — verify optionality before relying on it.`;

  // A root that is not an object has no interface of its own, so it gets an alias.
  if (!declarations.some((d) => d.includes(`interface ${pascalCase(rootName)} `)) && root.objectCount === 0) {
    return `${header}\n\n${declarations.join("\n\n")}${declarations.length ? "\n\n" : ""}export type ${pascalCase(rootName)} = ${rootType};\n`;
  }
  return `${header}\n\n${declarations.join("\n\n")}\n`;
}
