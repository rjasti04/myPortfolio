import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

describe("JSON tree renderer", () => {
  let dom;
  let renderTree;
  let previewOf;
  let typeOf;
  let CHILD_PAGE_SIZE;

  before(async () => {
    dom = new JSDOM("<!DOCTYPE html><html><body><div id='host'></div></body></html>");
    global.document = dom.window.document;
    global.window = dom.window;
    global.Node = dom.window.Node;
    ({ renderTree, previewOf, typeOf, CHILD_PAGE_SIZE } = await import("../js/json/json-tree.js"));
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.Node;
  });

  const host = () => {
    const node = dom.window.document.getElementById("host");
    node.textContent = "";
    return node;
  };
  const rows = (node) => Array.from(node.querySelectorAll(".tree-row"));
  const visibleRows = (node) =>
    rows(node).filter((row) => {
      let parent = row.parentElement;
      while (parent && parent !== node) {
        if (parent.hidden) return false;
        parent = parent.parentElement;
      }
      return true;
    });

  it("renders the root expanded but does not build grandchildren", () => {
    const node = host();
    renderTree(node, { a: { deep: { deeper: 1 } }, b: 2 });

    const labels = rows(node).map((row) => row.querySelector(".tree-key").textContent);
    assert.deepEqual(labels, ["$", "a", "b"], "only the root's own children exist yet");
    assert.ok(!labels.includes("deep"), "a grandchild must not be built before its parent is expanded");
  });

  it("builds children on first expand and keeps them on collapse", () => {
    const node = host();
    renderTree(node, { a: { deep: 1 } });

    const aRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "a");
    assert.equal(aRow.getAttribute("aria-expanded"), "false");

    aRow.querySelector(".tree-toggle").click();
    assert.equal(aRow.getAttribute("aria-expanded"), "true");
    assert.ok(rows(node).some((row) => row.querySelector(".tree-key").textContent === "deep"));

    aRow.querySelector(".tree-toggle").click();
    assert.equal(aRow.getAttribute("aria-expanded"), "false");
    // Collapsed hides; it does not destroy.
    assert.ok(rows(node).some((row) => row.querySelector(".tree-key").textContent === "deep"));
    assert.equal(visibleRows(node).some((row) => row.querySelector(".tree-key").textContent === "deep"), false);
  });

  it("pages large child lists behind a 'show more' control", () => {
    const node = host();
    const big = Array.from({ length: 500 }, (_, i) => i);
    renderTree(node, { big });

    const bigRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "big");
    bigRow.querySelector(".tree-toggle").click();

    const children = bigRow.parentElement.querySelector(".tree-children");
    assert.equal(children.querySelectorAll(":scope > .tree-node").length, CHILD_PAGE_SIZE);

    const more = children.querySelector(".tree-more");
    assert.ok(more, "a show-more control should be offered");
    assert.match(more.textContent, /Show \d+ more of 300/);

    more.click();
    assert.equal(children.querySelectorAll(":scope > .tree-node").length, CHILD_PAGE_SIZE * 2);
    assert.match(children.querySelector(".tree-more").textContent, /of 100/);

    children.querySelector(".tree-more").click();
    assert.equal(children.querySelectorAll(":scope > .tree-node").length, 500);
    assert.equal(children.querySelector(".tree-more"), null, "no control once everything is rendered");
  });

  it("reports the selected path to the caller", () => {
    const node = host();
    const seen = [];
    renderTree(node, { items: [{ id: 7 }] }, { onSelect: ({ path }) => seen.push(path) });

    const itemsRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "items");
    itemsRow.click();
    const zeroRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "0");
    zeroRow.click();
    const idRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "id");
    idRow.click();

    assert.deepEqual(seen[seen.length - 1], ["items", 0, "id"]);
    assert.ok(idRow.classList.contains("is-selected"));
    assert.equal(node.querySelectorAll(".tree-row.is-selected").length, 1, "selection is exclusive");
  });

  it("expandAll refuses a document past the node ceiling instead of hanging", () => {
    const node = host();
    const huge = Array.from({ length: 6000 }, (_, i) => ({ i }));
    const controller = renderTree(node, huge);
    const refusal = controller.expandAll();
    assert.equal(typeof refusal, "string");
    assert.match(refusal, /expand branches individually/i);

    const small = renderTree(host(), { a: { b: { c: 1 } } });
    assert.equal(small.expandAll(), null);
  });

  it("collapseAll closes inner branches but keeps the top level in view", () => {
    const node = host();
    const controller = renderTree(node, { a: { b: 1 }, c: { d: 2 } });
    controller.expandAll();
    assert.ok(visibleRows(node).length > 3);

    controller.collapseAll();
    // The root stays open on purpose — collapsing it too would leave a single
    // "$" row and hide the shape of the document entirely.
    const labels = visibleRows(node).map((row) => row.querySelector(".tree-key").textContent);
    assert.deepEqual(labels, ["$", "a", "c"]);
  });

  /* ----------------------------------------------------------------------
     The security property: every document-derived string is text.
     -------------------------------------------------------------------- */

  it("SECURITY: markup in keys and values renders as text, never as nodes", () => {
    const node = host();
    const payload = '<img src=x onerror="window.__treePwned = true">';
    renderTree(node, {
      [payload]: payload,
      nested: { "<script>alert(1)</script>": ["<b>bold</b>"] },
    });

    const controller = renderTree(node, { [payload]: payload });
    controller.expandAll();

    assert.equal(node.querySelector("img"), null, "no element may be created from document content");
    assert.equal(node.querySelector("script"), null);
    assert.equal(node.querySelector("b"), null);
    assert.equal(dom.window.__treePwned, undefined);

    const keyText = node.querySelector(".tree-key:not(.is-root)").textContent;
    assert.equal(keyText, payload, "the key is shown verbatim as characters");
  });

  it("previewOf and typeOf: summaries are plain strings", () => {
    assert.equal(typeOf(null), "null");
    assert.equal(typeOf([]), "array");
    assert.equal(typeOf({}), "object");
    assert.equal(typeOf("x"), "string");
    assert.equal(typeOf(1), "number");
    assert.equal(typeOf(true), "boolean");

    assert.equal(previewOf([]), "[]");
    assert.equal(previewOf([1]), "[ 1 item ]");
    assert.equal(previewOf([1, 2]), "[ 2 items ]");
    assert.equal(previewOf({}), "{}");
    assert.equal(previewOf({ a: 1 }), "{ 1 key }");
    assert.equal(previewOf({ a: 1, b: 2 }), "{ 2 keys }");
    assert.equal(previewOf("hi"), '"hi"');
    assert.equal(previewOf(null), "null");
    assert.equal(previewOf(12.5), "12.5");

    const long = previewOf("x".repeat(400));
    assert.ok(long.length < 200, "a long string preview is truncated");
    assert.ok(long.includes("…"));
  });

  it("leaf nodes carry no expander and empty containers are not expandable", () => {
    const node = host();
    renderTree(node, { scalar: 1, emptyObj: {}, emptyArr: [] });
    for (const label of ["scalar", "emptyObj", "emptyArr"]) {
      const row = rows(node).find((r) => r.querySelector(".tree-key").textContent === label);
      assert.ok(row.querySelector(".tree-toggle").classList.contains("is-leaf"), `${label} should be a leaf`);
      assert.equal(row.hasAttribute("aria-expanded"), false);
    }
  });

  it("keyboard: ArrowRight opens a branch and ArrowLeft closes it", () => {
    const node = host();
    renderTree(node, { a: { b: 1 } });
    const aRow = rows(node).find((row) => row.querySelector(".tree-key").textContent === "a");

    const press = (key) => aRow.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
    press("ArrowRight");
    assert.equal(aRow.getAttribute("aria-expanded"), "true");
    press("ArrowLeft");
    assert.equal(aRow.getAttribute("aria-expanded"), "false");
  });
});
