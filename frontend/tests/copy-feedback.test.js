// Cover for the copy buttons across the developer apps.
//
// json-ui.js's flash() saved and restored `textContent`. Every one of these
// buttons ships an icon - `<i class="fas fa-copy"></i>Copy` - and assigning
// textContent removes the element's child nodes, so the FIRST click deleted
// the <i> and the revert put back only the string. The icon never returned for
// the rest of the session. diff-ui.js had the sibling problem: its copy
// acknowledged with a CSS class alone, so colour was the only signal and a
// screen reader got no confirmation at all.
//
// crypto-ui.js has always done this correctly with innerHTML, which is what
// both were moved onto.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

test("json flash() restores markup, not just text", () => {
  const source = read("../js/json/json-ui.js");
  const flash = source.match(/function flash\([\s\S]*?\n\}/);
  assert.ok(flash, "flash() not found in json-ui.js");

  assert.match(
    flash[0],
    /dataset\.originalMarkup\s*\?\?\s*button\.innerHTML/,
    "flash() must snapshot innerHTML, or the button's icon is lost on first click"
  );
  assert.match(
    flash[0],
    /button\.innerHTML = button\.dataset\.originalMarkup/,
    "flash() must restore innerHTML, or the icon never comes back"
  );
  assert.doesNotMatch(
    flash[0],
    /dataset\.originalLabel/,
    "the textContent-based snapshot is what destroyed the icon; it should be gone"
  );
});

test("json copy buttons actually carry an icon worth preserving", () => {
  const html = read("../json.html");
  const withIcon = [...html.matchAll(/<button[^>]*class="btn-sm"[^>]*>([\s\S]*?)<\/button>/g)]
    .filter((m) => /<i\s+class="fa/.test(m[1]));
  assert.ok(
    withIcon.length > 0,
    "no icon-bearing .btn-sm found; if the markup changed, the flash() guarantee above needs rechecking"
  );
});

test("diff copy announces with a label, not colour alone", () => {
  const source = read("../js/diff/diff-ui.js");
  const copy = source.match(/async function copyText\([\s\S]*?\n  \}/);
  assert.ok(copy, "copyText() not found in diff-ui.js");

  assert.match(
    copy[0],
    /textContent = "Copied!"/,
    "the copy needs a visible, announced label; .copied only recolours the border"
  );
  assert.match(
    copy[0],
    /innerHTML = button\.dataset\.originalMarkup/,
    "restore innerHTML so this does not reintroduce the json icon bug"
  );
});

test("crypto and cron tablists use a roving tabindex", () => {
  // role="tablist" promises one Tab stop for the whole set. json-main.js and
  // diff-main.js always did this; these two never set tabIndex at all, so
  // every tab stayed individually Tab-reachable.
  for (const rel of ["../js/crypto/crypto-main.js", "../js/cron/cron-main.js"]) {
    assert.match(
      read(rel),
      /\.tabIndex = is(Target|Active) \? 0 : -1/,
      `${rel} must set a roving tabindex when switching tabs`
    );
  }
});

test("every Font Awesome glyph referenced in the SPA is in the vendored subset", () => {
  // scripts/vendor_fonts.py subsets the faces to the icons actually used, and
  // frontend/fonts/ is COMMITTED - `npm run build` does not regenerate it. So
  // an icon picked from the full Font Awesome catalogue renders as a blank box
  // in production with nothing failing along the way. That is exactly what a
  // circle-half-stroke theme icon and an earth-americas header link did before
  // this test existed.
  const available = new Set(
    [...read("../fonts.css").matchAll(/^\.(fa-[a-z0-9-]+)/gm)].map((m) => m[1])
  );

  // Only real usages, never prose: class attributes in the markup, and the
  // "fas fa-x" string literals theme.js swaps onto the button. Scanning raw
  // text would also pick up icon names mentioned in comments and the
  // fa-solid-900-subset font filename, neither of which is a glyph.
  const used = new Set();
  for (const m of read("../index.html").matchAll(/class="([^"]*\bfa-[^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls.startsWith("fa-")) used.add(cls);
  }
  for (const m of read("../js/theme.js").matchAll(/"(?:fas|far|fab) (fa-[a-z0-9-]+)"/g)) {
    used.add(m[1]);
  }

  // fa-solid / fa-regular / fa-brands select a FACE, not a glyph.
  for (const face of ["fa-solid", "fa-regular", "fa-brands"]) used.delete(face);

  assert.ok(used.size > 20, `only ${used.size} icons found - the scan probably stopped matching`);

  const missing = [...used].filter((name) => !available.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `these glyphs are not in the vendored subset and will render blank: ${missing.join(", ")}`
  );
});
