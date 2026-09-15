// Output primitives for the command prompt.
//
// Every builder writes user-controlled strings through `textContent`, never
// `innerHTML`. Escaping is therefore structural: a command handler has no way
// to inject markup even if it forgets to sanitise, which is what the previous
// HTML-string handlers relied on remembering at each interpolation.

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = String(textContent);
  return node;
}

/** A bright command-coloured line (the same class the echoed input uses). */
export function line(text) {
  return el("p", "terminal-line", text);
}

/**
 * The panel's resting state - what it says before anyone has typed. Built
 * from nodes rather than an HTML string for the reason given at the top of
 * this file.
 */
export function boot(lead, hint) {
  const node = el("p", "terminal-boot");
  node.appendChild(el("strong", null, lead));
  node.appendChild(document.createTextNode(` ${hint}`));
  return node;
}

/** Standard body text. */
export function text(value) {
  return el("p", "terminal-output-text", value);
}

/** An error line. */
export function err(value) {
  return el("p", "terminal-line terminal-error", value);
}

/** Preformatted block — ASCII art, column output. */
export function pre(value, extraClass) {
  const node = el("pre", `terminal-output-text${extraClass ? ` ${extraClass}` : ""}`, value);
  node.style.whiteSpace = "pre";
  return node;
}

/**
 * A `<ul class="terminal-list">`. Items may be:
 *   "plain string"
 *   ["Label", "value"]  -> <strong>Label</strong> value
 */
export function list(items) {
  const ul = el("ul", "terminal-list");
  for (const item of items) {
    const li = el("li");
    if (Array.isArray(item)) {
      li.append(el("strong", null, item[0]), document.createTextNode(` ${item[1]}`));
    } else {
      li.textContent = String(item);
    }
    ul.appendChild(li);
  }
  return ul;
}

/**
 * A definition list rendered in aligned monospace columns — used by `help`,
 * where a `<ul>` cannot keep the summaries lined up.
 */
export function columns(rows) {
  const width = rows.reduce((max, [key]) => Math.max(max, key.length), 0);
  const ul = el("ul", "terminal-list terminal-list--cols");
  for (const [key, value] of rows) {
    const li = el("li");
    li.append(el("strong", null, key.padEnd(width, " ")), document.createTextNode(`  ${value}`));
    ul.appendChild(li);
  }
  return ul;
}

/**
 * Clickable tag pills. `onPick` receives the tag label; when omitted the pills
 * are inert text rather than fake buttons.
 */
export function tags(names, onPick) {
  const wrap = el("div", "terminal-tags");
  for (const name of names) {
    if (typeof onPick === "function") {
      const btn = el("button", null, name);
      btn.type = "button";
      btn.addEventListener("click", () => onPick(name));
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(el("span", null, name));
    }
  }
  return wrap;
}

/** Combine several nodes into one fragment. */
export function frag(...nodes) {
  const f = document.createDocumentFragment();
  for (const node of nodes) {
    if (node) f.appendChild(node);
  }
  return f;
}

/** The `$ whoami` echo line shown above each result. */
export function echoLine(input) {
  const p = el("p", "terminal-line");
  p.append(el("span", "prompt", "$"), document.createTextNode(` ${input}`));
  return p;
}
