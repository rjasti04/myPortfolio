import test from "node:test";
import assert from "node:assert/strict";
import {
  getLiveClock,
  epochToDetails,
  parseDateInput,
  formatRelativeTime,
} from "../js/crypto/time-workbench.js";

test("getLiveClock: returns active clock data with valid ISO string", () => {
  const clock = getLiveClock();
  assert.ok(clock.epochSeconds > 1700000000);
  assert.ok(clock.epochMs > 1700000000000);
  assert.ok(!isNaN(Date.parse(clock.iso)));
  assert.ok(clock.utcString.includes("GMT"));
});

test("epochToDetails: auto-detects seconds vs milliseconds and outputs ISO 8601", () => {
  // 1700000000 seconds = 2023-11-14T22:13:20.000Z
  const secDetails = epochToDetails(1700000000);
  assert.equal(secDetails.valid, true);
  assert.equal(secDetails.iso, "2023-11-14T22:13:20.000Z");
  assert.equal(secDetails.epochSeconds, 1700000000);
  assert.equal(secDetails.epochMs, 1700000000000);

  // 1700000000000 milliseconds = 2023-11-14T22:13:20.000Z
  const msDetails = epochToDetails("1700000000000");
  assert.equal(msDetails.valid, true);
  assert.equal(msDetails.iso, "2023-11-14T22:13:20.000Z");

  // Invalid inputs
  assert.equal(epochToDetails("not-a-number").valid, false);
  assert.equal(epochToDetails("").valid, false);
});

test("parseDateInput: converts human and ISO date strings into timestamps", () => {
  const parsed = parseDateInput("2026-09-10T12:00:00Z");
  assert.equal(parsed.valid, true);
  assert.equal(parsed.iso, "2026-09-10T12:00:00.000Z");
  assert.equal(parsed.epochSeconds, 1789041600);

  assert.equal(parseDateInput("invalid-date-string").valid, false);
});

test("formatRelativeTime: calculates humanized relative descriptions", () => {
  const now = 1700000000000;

  // Just now
  assert.equal(formatRelativeTime(now + 2000, now), "just now");
  assert.equal(formatRelativeTime(now - 3000, now), "just now");

  // Past
  assert.equal(formatRelativeTime(now - 60000, now), "1 minute ago");
  assert.equal(formatRelativeTime(now - 120000, now), "2 minutes ago");
  assert.equal(formatRelativeTime(now - 3600000, now), "1 hour ago");
  assert.equal(formatRelativeTime(now - 86400000, now), "1 day ago");

  // Future
  assert.equal(formatRelativeTime(now + 60000, now), "in 1 minute");
  assert.equal(formatRelativeTime(now + 7200000, now), "in 2 hours");
  assert.equal(formatRelativeTime(now + 172800000, now), "in 2 days");
});
