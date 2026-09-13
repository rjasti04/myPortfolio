/**
 * Tree Renderer (`json-tree.js`)
 *
 * A collapsible view of a parsed document, built lazily.
 *
 * **Laziness is the whole design.** A 5 MB document expanded in one pass is a
 * few hundred thousand DOM nodes, and the tab stops responding — on a portfolio
 * site the visitor's takeaway is "this page froze", not "what a nice tool". So
 * children are built on first expand and cached, collapsing hides rather than
 * destroys, and any single node renders at most `CHILD_PAGE_SIZE` children
 * before offering a "show more" control.
 *
 * **Every string that comes from the document is written with `textContent`.**
 * There is no `innerHTML` in this file. A document containing
 * `<img src=x onerror=alert(1)>` as a key renders as those characters, which is
 * why the page needs no sanitiser: no HTML string is ever constructed to need
 * cleaning.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { formatPath } from "./json-query.js";

/** Children rendered per node before a "show more" control appears. */
export const CHILD_PAGE_SIZE = 200;

/** Expanding everything is refused past this many nodes. */
const EXPAND_ALL_LIMIT = 5000;

/** Longest scalar preview before it is cut with an ellipsis. */
const PREVIEW_LIMIT = 120;

export function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function childCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function isBranch(value) {
  return value !== null && typeof value === "object";
}

/** A short, non-HTML summary of a value for the collapsed row. */
export function previewOf(value) {
  const kind = typeOf(value);
  if (kind === "array") return value.length === 0 ? "[]" : `[ ${value.length} ${value.length === 1 ? "item" : "items"} ]`;
  if (kind === "object") {
    const n = Object.keys(value).length;
    return n === 0 ? "{}" : `{ ${n} ${n === 1 ? "key" : "keys"} }`;
  }
  if (kind === "string") {
    const text = value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}…` : value;
    return JSON.stringify(text);
  }
  return String(value);
}

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  return Object.keys(value).map((key) => [key, value[key]]);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render `value` into `container`.
 *
 * @param {HTMLElement} container
 * @param {unknown} value
 * @param {{ onSelect?: (info: {path: Array, value: unknown}) => void }} [options]
 * @returns {{ expandAll: () => string|null, collapseAll: () => void, totalNodes: number }}
 */
export function renderTree(container, value, options = {}) {
  const onSelect = typeof options.onSelect === "function" ? options.onSelect : null;
  container.textContent = "";
  container.setAttribute("role", "tree");

  let selectedRow = null;
  const allNodes = [];

  function select(row, path, nodeValue) {
    if (selectedRow) selectedRow.classList.remove("is-selected");
    row.classList.add("is-selected");
    selectedRow = row;
    if (onSelect) onSelect({ path, value: nodeValue });
  }

  /**
   * Build one row plus its (initially empty) children container.
   * `label` is null for the synthetic root.
   */
  function buildNode(label, nodeValue, path, depth) {
    const wrap = el("div", "tree-node");
    const row = el("div", "tree-row");
    row.setAttribute("role", "treeitem");
    row.tabIndex = -1;
    row.style.setProperty("--depth", String(depth));

    const branch = isBranch(nodeValue);
    const count = childCount(nodeValue);
    const expandable = branch && count > 0;

    const toggle = el("button", "tree-toggle");
    toggle.type = "button";
    if (expandable) {
      const icon = el("i", "fas fa-chevron-right");
      icon.setAttribute("aria-hidden", "true");
      toggle.appendChild(icon);
      toggle.setAttribute("aria-label", `Expand ${label === null ? "root" : String(label)}`);
    } else {
      toggle.classList.add("is-leaf");
      toggle.tabIndex = -1;
      toggle.setAttribute("aria-hidden", "true");
    }
    row.appendChild(toggle);

    if (label !== null) {
      const key = el("span", "tree-key", String(label));
      if (typeof label === "number") key.classList.add("is-index");
      row.appendChild(key);
      row.appendChild(el("span", "tree-colon", ":"));
    } else {
      row.appendChild(el("span", "tree-key is-root", "$"));
    }

    row.appendChild(el("span", `tree-badge is-${typeOf(nodeValue)}`, typeOf(nodeValue)));
    row.appendChild(el("span", `tree-preview is-${typeOf(nodeValue)}`, previewOf(nodeValue)));

    const children = el("div", "tree-children");
    children.hidden = true;
    children.setAttribute("role", "group");

    let built = false;
    let rendered = 0;

    function renderChunk() {
      const entries = entriesOf(nodeValue);
      const upTo = Math.min(entries.length, rendered + CHILD_PAGE_SIZE);
      const more = children.querySelector(":scope > .tree-more");
      if (more) more.remove();
      for (let i = rendered; i < upTo; i += 1) {
        const [childKey, childValue] = entries[i];
        children.appendChild(buildNode(childKey, childValue, [...path, childKey], depth + 1));
      }
      rendered = upTo;
      if (rendered < entries.length) {
        const remaining = entries.length - rendered;
        const button = el("button", "tree-more", `Show ${Math.min(CHILD_PAGE_SIZE, remaining)} more of ${remaining}`);
        button.type = "button";
        button.style.setProperty("--depth", String(depth + 1));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          renderChunk();
        });
        children.appendChild(button);
      }
    }

    function setExpanded(next) {
      if (!expandable) return;
      if (next && !built) {
        built = true;
        renderChunk();
      }
      children.hidden = !next;
      row.setAttribute("aria-expanded", String(next));
      toggle.setAttribute("aria-label", `${next ? "Collapse" : "Expand"} ${label === null ? "root" : String(label)}`);
      const icon = toggle.querySelector("i");
      if (icon) icon.className = next ? "fas fa-chevron-down" : "fas fa-chevron-right";
    }

    if (expandable) {
      row.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        setExpanded(children.hidden);
      });
    }

    row.addEventListener("click", () => {
      select(row, path, nodeValue);
      if (expandable) setExpanded(children.hidden);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        row.click();
      } else if (event.key === "ArrowRight" && expandable && children.hidden) {
        event.preventDefault();
        setExpanded(true);
      } else if (event.key === "ArrowLeft" && expandable && !children.hidden) {
        event.preventDefault();
        setExpanded(false);
      }
    });

    wrap.appendChild(row);
    wrap.appendChild(children);
    allNodes.push({ setExpanded, expandable });
    return wrap;
  }

  const rootNode = buildNode(null, value, [], 0);
  container.appendChild(rootNode);

  // The root opens by default: a tree that starts fully closed looks broken.
  const rootRow = rootNode.querySelector(".tree-row");
  if (rootRow && rootRow.getAttribute("aria-expanded") === "false") {
    rootNode.querySelector(".tree-toggle").click();
  }
  if (rootRow) rootRow.tabIndex = 0;

  return {
    /** @returns {string|null} an explanation when the document is too large */
    expandAll() {
      let total = 0;
      const count = (node) => {
        total += 1;
        if (total > EXPAND_ALL_LIMIT) return;
        if (isBranch(node)) for (const [, child] of entriesOf(node)) count(child);
      };
      count(value);
      if (total > EXPAND_ALL_LIMIT) {
        return `This document has more than ${EXPAND_ALL_LIMIT.toLocaleString()} nodes — expand branches individually instead.`;
      }
      // Expanding builds rows, which appends to allNodes; index by position so
      // the newly built descendants are visited in the same pass.
      for (let i = 0; i < allNodes.length; i += 1) allNodes[i].setExpanded(true);
      return null;
    },
    collapseAll() {
      for (let i = allNodes.length - 1; i > 0; i -= 1) allNodes[i].setExpanded(false);
    },
    get totalNodes() {
      return allNodes.length;
    },
  };
}

/** Re-exported so the breadcrumb and the tree agree on path syntax. */
export { formatPath };
