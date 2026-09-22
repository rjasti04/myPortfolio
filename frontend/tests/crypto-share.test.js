// Cover for /crypto's share link.
//
// The button used to copy window.location.href while its title promised a
// "permalink", so it copied a link to the tab regardless of what was in any
// field. The fix encodes the workbench's settings - and deliberately not its
// contents. That second half is the one worth a test: a share link is pasted
// into chat windows and ticket comments, and a tool whose share button leaks
// the plaintext you came to hash would be worse than one that shared nothing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { buildShareUrl, applyShareState } from "../js/crypto/share-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKUP = fs.readFileSync(path.join(__dirname, "../crypto.html"), "utf8");

const mount = (url = "https://rjasti.com/crypto#hasher") =>
  new JSDOM(MARKUP, { url }).window.document;

test("the link carries the tab and the settings", () => {
  const doc = mount("https://rjasti.com/crypto#generators");
  doc.getElementById("gen-type").value = "uuidv7";
  doc.getElementById("gen-batch").value = "5";

  const url = new URL(buildShareUrl(doc, "https://rjasti.com/crypto#generators"));
  assert.equal(url.hash, "#generators");
  assert.equal(url.searchParams.get("gen"), "uuidv7");
  assert.equal(url.searchParams.get("batch"), "5");
});

test("nothing you typed travels - not the plaintext, not an HMAC key", () => {
  const doc = mount();
  doc.getElementById("hasher-input").value = "hunter2";
  doc.getElementById("hmac-key").value = "webhook-signing-secret";
  doc.getElementById("encoder-input").value = "some base64 payload";
  doc.getElementById("jwt-input").value = "eyJhbGciOiJIUzI1NiJ9.e30.sig";

  const url = buildShareUrl(doc, "https://rjasti.com/crypto#hasher");
  for (const secret of ["hunter2", "webhook-signing-secret", "some%20base64", "eyJhbGciOiJIUzI1NiJ9"]) {
    assert.ok(!url.includes(secret), `the share link leaked ${secret}`);
  }
});

test("an unknown tab falls back rather than producing a dead link", () => {
  const url = new URL(buildShareUrl(mount(), "https://rjasti.com/crypto#nonsense"));
  assert.equal(url.hash, "#encoders");
});

test("stale query parameters are dropped, not accumulated", () => {
  const doc = mount();
  const url = new URL(buildShareUrl(doc, "https://rjasti.com/crypto?stale=1&gen=old#hasher"));
  assert.equal(url.searchParams.get("stale"), null);
});

test("a shared link restores the controls it names", () => {
  const doc = mount();
  const applied = applyShareState(doc, "https://rjasti.com/crypto?format=hex&gen=uuidv7&batch=5#encoders");
  assert.deepEqual(applied.sort(), ["encoder-format", "gen-batch", "gen-type"]);
  assert.equal(doc.getElementById("encoder-format").value, "hex");
  assert.equal(doc.getElementById("gen-type").value, "uuidv7");
});

test("a value the page does not offer is dropped, not assigned", () => {
  const doc = mount();
  const before = doc.getElementById("encoder-format").value;
  const applied = applyShareState(doc, "https://rjasti.com/crypto?format=rot13");
  assert.deepEqual(applied, [], "an unknown option was written into the select");
  assert.equal(doc.getElementById("encoder-format").value, before, "the select went blank");
});

test("a range outside its own bounds is refused", () => {
  const doc = mount();
  const length = doc.getElementById("gen-length");
  const before = length.value;
  applyShareState(doc, `https://rjasti.com/crypto?len=${Number(length.max) + 1}`);
  assert.equal(length.value, before);

  applyShareState(doc, `https://rjasti.com/crypto?len=${length.max}`);
  assert.equal(length.value, length.max);
});

test("the button no longer promises a permalink it does not deliver", () => {
  const share = MARKUP.slice(MARKUP.indexOf('id="share-link-btn"'), MARKUP.indexOf('id="privacy-clear-all-btn"'));
  assert.doesNotMatch(share, /permalink/i);
});

test("Clear moved into the header, matching /json and /diff", () => {
  const doc = mount();
  const clear = doc.getElementById("privacy-clear-all-btn");
  assert.ok(clear, "the clear control disappeared");
  assert.ok(clear.closest(".header-actions"), "clear is still stranded in the footer");
  // The footer keeps the privacy sentence it always had.
  assert.match(doc.querySelector(".app-footer").textContent, /Zero Network Egress/);
});
