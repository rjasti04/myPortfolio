import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { diffLines } from "../js/diff/diff-engine.js";
import { refineChanges } from "../js/diff/diff-refine.js";
import { parsePatch, patchToView } from "../js/diff/diff-patch.js";

describe("diff renderer", () => {
  let dom;
  let renderDiff;
  let MAX_RENDER_ROWS;
  let host;

  before(async () => {
    dom = new JSDOM("<!DOCTYPE html><html><body><div id='host'></div></body></html>");
    global.document = dom.window.document;
    global.window = dom.window;
    global.Node = dom.window.Node;
    ({ renderDiff, MAX_RENDER_ROWS } = await import("../js/diff/diff-render.js"));
    host = dom.window.document.getElementById("host");
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.Node;
  });

  const render = (a, b, options = {}) => {
    const result = diffLines(a, b, options.diff ?? {});
    refineChanges(result.changes);
    return { result, rendered: renderDiff(host, result, options) };
  };

  const kinds = () =>
    [...host.querySelectorAll(".diff-row")].map((row) => row.dataset.kind);

  it("draws nothing but a message when the sides are identical", () => {
    const { rendered } = render("same\n", "same\n");
    assert.equal(host.querySelectorAll(".diff-row").length, 0);
    assert.equal(host.querySelector(".diff-empty").textContent, "No differences.");
    assert.deepEqual(rendered.rows, []);

    // Callers can supply their own wording; diff-ui.js does.
    render("same\n", "same\n", { emptyMessage: "The two sides are identical." });
    assert.equal(
      host.querySelector(".diff-empty").textContent,
      "The two sides are identical."
    );
  });

  it("draws a hunk header and one row per line in split view", () => {
    render("a\nb\nc\n", "a\nX\nc\n", { view: "split" });

    const head = host.querySelector(".diff-hunk-head");
    assert.match(head.textContent, /^@@ -1,3 \+1,3 @@$/);

    assert.deepEqual(kinds(), ["equal", "replace", "equal"]);
    for (const row of host.querySelectorAll(".diff-row")) {
      assert.equal(row.querySelectorAll(".diff-half").length, 2, "split rows carry both sides");
    }
  });

  it("returns only the changed rows for navigation to step through", () => {
    const { rendered } = render("a\nb\nc\nd\ne\nf\ng\n", "a\nX\nc\nd\ne\nY\ng\n", {
      view: "split",
    });
    assert.equal(rendered.rows.length, 2);
    for (const row of rendered.rows) {
      assert.notEqual(row.dataset.kind, "equal");
    }
  });

  it("interleaves deletions before insertions in unified view", () => {
    render("a\nb\nc\n", "a\nX\nc\n", { view: "unified" });
    assert.deepEqual(kinds(), ["equal", "delete", "insert", "equal"]);
    for (const row of host.querySelectorAll(".diff-row")) {
      assert.equal(row.querySelectorAll(".diff-half").length, 1);
      assert.equal(
        row.querySelector(".diff-half").classList.contains("diff-half--unified"),
        true
      );
      assert.equal(row.querySelectorAll(".diff-gutter").length, 2, "old and new gutters");
    }
  });

  it("fills the opposite side of an insertion with a void half", () => {
    render("a\nc\n", "a\nb\nc\n", { view: "split" });
    const insertRow = [...host.querySelectorAll(".diff-row")].find(
      (row) => row.dataset.kind === "insert"
    );
    const halves = insertRow.querySelectorAll(".diff-half");
    assert.equal(halves[0].dataset.kind, "void");
    assert.equal(halves[1].dataset.kind, "insert");
    assert.equal(halves[0].querySelector(".diff-code").textContent, "");
  });

  it("numbers the gutters from one, per side", () => {
    render("a\nb\nc\n", "a\nX\nc\n", { view: "split" });
    const rows = [...host.querySelectorAll(".diff-row")];
    assert.equal(rows[0].querySelectorAll(".diff-gutter")[0].textContent, "1");
    assert.equal(rows[1].querySelectorAll(".diff-gutter")[0].textContent, "2");
    assert.equal(rows[2].querySelectorAll(".diff-gutter")[0].textContent, "3");
  });

  it("marks changed characters inside a changed line", () => {
    render("const timeout = 30;\n", "const timeout = 300;\n", { view: "split" });
    const deleted = host.querySelector('.diff-half[data-kind="delete"]');
    const inserted = host.querySelector('.diff-half[data-kind="insert"]');

    assert.deepEqual(
      [...deleted.querySelectorAll(".rf-del")].map((node) => node.textContent),
      ["30"]
    );
    assert.deepEqual(
      [...inserted.querySelectorAll(".rf-ins")].map((node) => node.textContent),
      ["300"]
    );
  });

  it("applies syntax classes without losing any of the line's text", () => {
    const line = 'const greeting = "hi"; // note\n';
    render(line, 'const greeting = "bye"; // note\n', { view: "split" });

    const deleted = host.querySelector('.diff-half[data-kind="delete"] .diff-code');
    assert.equal(deleted.textContent, 'const greeting = "hi"; // note');
    assert.ok(deleted.querySelector(".tok-keyword"), "keyword is tinted");
    assert.ok(deleted.querySelector(".tok-comment"), "comment is tinted");
  });

  it("collapses unchanged stretches into an expander and expands on demand", () => {
    const left = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const right = left.replace("line 20", "CHANGED");

    render(left, right, { view: "split" });
    const expander = host.querySelector(".diff-expander");
    assert.notEqual(expander, null);
    assert.match(expander.textContent, /^Show \d+ unchanged lines$/);
    assert.equal(expander.tagName, "BUTTON");
    // Only the hunk is drawn, not all forty lines.
    assert.ok(host.querySelectorAll(".diff-row").length < 15);

    const before = host.querySelectorAll(".diff-row").length;
    const result = diffLines(left, right);
    renderDiff(host, result, { view: "split", expanded: new Set([0]) });
    assert.ok(host.querySelectorAll(".diff-row").length > before, "expanding adds rows");
  });

  it("renders a parsed patch through the same path as a computed diff", () => {
    const patch = [
      "--- a/one.js",
      "+++ b/one.js",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "",
    ].join("\n");
    const view = patchToView(parsePatch(patch));
    refineChanges(view.changes);
    renderDiff(host, view, { view: "split" });

    assert.deepEqual(kinds(), ["equal", "replace"]);
    assert.match(host.querySelector(".diff-hunk-head").textContent, /@@ -1,2 \+1,2 @@/);
    // A patch carries no unchanged remainder, so there is nothing to expand.
    assert.equal(host.querySelector(".diff-expander"), null);
  });

  it("stops after the row ceiling and says so", () => {
    const left = Array.from({ length: MAX_RENDER_ROWS + 50 }, (_, i) => `left ${i}`).join("\n");
    const right = Array.from({ length: MAX_RENDER_ROWS + 50 }, (_, i) => `right ${i}`).join("\n");
    const { rendered } = render(left, right, { view: "unified" });

    assert.equal(rendered.truncated, true);
    assert.ok(host.querySelectorAll(".diff-row").length <= MAX_RENDER_ROWS);
    assert.match(host.querySelector(".diff-empty").textContent, /Stopped after/);
  });

  it("SECURITY: renders an injection payload as text and executes nothing", () => {
    const payload = '<img src=x onerror="window.__pwned = true">';
    render(`${payload}\n`, '<script>window.__pwned = true<\/script>\n', { view: "split" });

    assert.equal(dom.window.__pwned, undefined, "nothing executed");
    assert.equal(host.querySelectorAll("img").length, 0, "no element was created from the text");
    assert.equal(host.querySelectorAll("script").length, 0);

    const deleted = host.querySelector('.diff-half[data-kind="delete"] .diff-code');
    assert.equal(deleted.textContent, payload, "the payload is visible, as text");
  });

  it("SECURITY: a payload in a patch is text too", () => {
    const patch = ["@@ -1 +1 @@", '-<img src=x onerror="window.__pwned2 = 1">', "+safe", ""].join(
      "\n"
    );
    renderDiff(host, patchToView(parsePatch(patch)), { view: "unified" });

    assert.equal(dom.window.__pwned2, undefined);
    assert.equal(host.querySelectorAll("img").length, 0);
    assert.match(host.textContent, /onerror/, "still shown to the reader");
  });

  it("clears the container between draws", () => {
    render("a\n", "b\n", { view: "split" });
    const first = host.querySelectorAll(".diff-row").length;
    render("a\n", "b\n", { view: "split" });
    assert.equal(host.querySelectorAll(".diff-row").length, first, "no accumulation");
  });
});
