import test from "node:test";
import assert from "node:assert/strict";
import { parseCron, translateCron, getNextRuns } from "../js/cron/cron-parser.js";

test("parseCron: parses standard every minute expression", () => {
  const res = parseCron("* * * * *");
  assert.equal(res.valid, true);
  assert.equal(res.fields.minutes.length, 60);
  assert.equal(res.fields.hours.length, 24);
  assert.equal(res.fields.daysOfMonth.length, 31);
  assert.equal(res.fields.months.length, 12);
  assert.equal(res.fields.daysOfWeek.length, 7);
});

test("parseCron: rejects expressions with incorrect number of fields", () => {
  assert.equal(parseCron("* * *").valid, false);
  assert.equal(parseCron("* * * * * *").valid, false);
  assert.equal(parseCron("").valid, false);
});

test("parseCron: handles steps and ranges correctly", () => {
  const res = parseCron("*/15 9-17 * * 1-5");
  assert.equal(res.valid, true);
  assert.deepEqual(res.fields.minutes, [0, 15, 30, 45]);
  assert.deepEqual(res.fields.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(res.fields.daysOfWeek, [1, 2, 3, 4, 5]);
});

test("parseCron: handles month and day names", () => {
  const res = parseCron("0 12 1 JAN,JUN MON,FRI");
  assert.equal(res.valid, true);
  assert.deepEqual(res.fields.months, [1, 6]);
  assert.deepEqual(res.fields.daysOfWeek, [1, 5]);
});

test("parseCron: rejects out-of-bounds values", () => {
  assert.equal(parseCron("60 * * * *").valid, false);
  assert.equal(parseCron("* 24 * * *").valid, false);
  assert.equal(parseCron("* * 0 * *").valid, false);
  assert.equal(parseCron("* * 32 * *").valid, false);
  assert.equal(parseCron("* * * 13 *").valid, false);
  assert.equal(parseCron("* * * * 8").valid, false);
  assert.equal(parseCron("10-5 * * * *").valid, false);
});

test("translateCron: human translation for common expressions", () => {
  assert.equal(translateCron("* * * * *").translation, "Every minute");
  assert.equal(translateCron("*/15 * * * *").translation, "Every 15 minutes");
  assert.equal(translateCron("0 0 * * *").translation, "Every day at midnight (12:00 AM)");
  assert.equal(translateCron("0 12 * * *").translation, "Every day at noon (12:00 PM)");
  assert.equal(translateCron("0 9 * * 1-5").translation, "At 9:00 AM, Monday through Friday");
});

test("getNextRuns: generates accurate sequential trigger timestamps", () => {
  const baseDate = new Date("2026-01-01T00:00:00Z");
  // Hourly at minute 0
  const runs = getNextRuns("0 * * * *", 5, baseDate);
  assert.equal(runs.length, 5);
  // First run should be at 01:00:00
  assert.equal(runs[0].date.getMinutes(), 0);
  assert.equal(runs[1].date.getMinutes(), 0);
  const diffHours = (runs[1].date.getTime() - runs[0].date.getTime()) / (1000 * 60 * 60);
  assert.equal(diffHours, 1);
});

test("getNextRuns: respects day of week filter", () => {
  const baseDate = new Date("2026-09-01T00:00:00Z"); // Tuesday
  // Run on Sunday only at 10:00
  const runs = getNextRuns("0 10 * * 0", 3, baseDate);
  assert.equal(runs.length, 3);
  for (const r of runs) {
    assert.equal(r.date.getDay(), 0);
    assert.equal(r.date.getHours(), 10);
    assert.equal(r.date.getMinutes(), 0);
  }
});
