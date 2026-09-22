// Cover for /crypto's JWT decoder.
//
// A JWT is attacker-supplied by definition - it is the thing you were handed
// and do not yet trust - so the two properties that matter are that a
// malformed one is reported rather than thrown, and that the panel never
// claims to have verified anything.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeJwt, describeClaims } from "../js/crypto/jwt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const token = (header, payload, signature = "not-a-real-signature") =>
  `${b64url(header)}.${b64url(payload)}.${signature}`;

/** RFC 7519 §3.1's own example token. */
const RFC_EXAMPLE =
  "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9." +
  "eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ." +
  "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

test("decodes the example token from RFC 7519", () => {
  const result = decodeJwt(RFC_EXAMPLE, Date.parse("2011-03-22T18:43:00Z"));
  assert.equal(result.valid, true);
  assert.equal(result.header.alg, "HS256");
  assert.equal(result.header.typ, "JWT");
  assert.equal(result.payload.iss, "joe");
  assert.equal(result.payload["http://example.com/is_root"], true);
});

test("exp is read as seconds, not milliseconds", () => {
  // A token read as milliseconds lands in 1970 - the classic symptom of
  // missing that NumericDate is seconds.
  const exp = 1_800_000_000;
  const result = decodeJwt(token({ alg: "HS256" }, { exp }), exp * 1000 - 60_000);
  const row = result.claims.find((c) => c.key === "exp");
  assert.equal(row.value, new Date(exp * 1000).toISOString());
  assert.match(row.value, /^20\d\d-/);
  assert.equal(row.relative, "in 1 minute");
});

test("expiry is reported relative to now, in both directions", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  const expired = decodeJwt(token({ alg: "HS256" }, { exp: now / 1000 - 3600 }), now);
  assert.equal(expired.expired, true);

  const live = decodeJwt(token({ alg: "HS256" }, { exp: now / 1000 + 3600 }), now);
  assert.equal(live.expired, false);

  const undated = decodeJwt(token({ alg: "HS256" }, { sub: "abc" }), now);
  assert.equal(undated.expired, null, "a token with no exp has no expiry answer");
});

test("registered claims are annotated; unknown ones are left alone", () => {
  const rows = describeClaims({ iss: "me", sub: "you", custom: "mine" });
  assert.equal(rows.find((r) => r.key === "iss").label, "Issuer");
  assert.equal(rows.find((r) => r.key === "custom").label, null);
});

test("an object claim is stringified rather than rendered as [object Object]", () => {
  const rows = describeClaims({ scope: { read: true } });
  assert.equal(rows[0].value, '{"read":true}');
});

test("a malformed token is reported, never thrown", () => {
  for (const bad of ["", "   ", "not-a-token", "a.b", "a.b.c.d", "!!!.!!!.x"]) {
    const result = decodeJwt(bad);
    assert.equal(result.valid, false, `expected ${JSON.stringify(bad)} to be refused`);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  }
});

test("the field count is named, because a truncated paste is the usual cause", () => {
  assert.match(decodeJwt("a.b").error, /three dot-separated parts; this has 2/);
});

test("a payload that decodes to a non-object is refused", () => {
  const notAnObject = `${b64url({ alg: "none" })}.${Buffer.from('"just a string"').toString("base64url")}.x`;
  const result = decodeJwt(notAnObject);
  assert.equal(result.valid, false);
  assert.match(result.error, /not a JSON object/);
});

test("non-ASCII claims survive the Base64URL round trip", () => {
  const result = decodeJwt(token({ alg: "HS256" }, { name: "Renée Ångström" }));
  assert.equal(result.payload.name, "Renée Ångström");
});

test("the panel says it does not verify, and offers no way to", () => {
  const markup = fs.readFileSync(path.join(__dirname, "../crypto.html"), "utf8");
  const panel = markup.slice(markup.indexOf('id="panel-jwt"'), markup.indexOf('id="panel-about"'));
  assert.match(panel, /does not verify the signature/i);
  assert.doesNotMatch(panel, /id="jwt-(secret|key|verify)"/, "a verification control appeared on the JWT panel");
});
