import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseCron,
  translateCron,
  getNextRuns,
  expandMacro,
  resolveLocalTimeZone,
  CRON_MACROS,
} from "../js/cron/cron-parser.js";

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

  assert.deepEqual(parseCron("* * * * 7").fields.daysOfWeek, [0]);
  assert.deepEqual(parseCron("* * * * 1-7").fields.daysOfWeek, [0, 1, 2, 3, 4, 5, 6]);
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

/* --- Macros and Quartz ----------------------------------------------------
 *
 * The parser handled named tokens, ranges, steps and lists but rejected
 * anything that was not exactly five fields - so pasting `@daily` from a real
 * crontab, or a 6-field expression from a Kubernetes manifest, got a field
 * count rather than an answer.
 */

test("expandMacro turns each standard macro into its canonical five fields", () => {
  assert.equal(expandMacro("@yearly"), "0 0 1 1 *");
  assert.equal(expandMacro("@annually"), "0 0 1 1 *");
  assert.equal(expandMacro("@monthly"), "0 0 1 * *");
  assert.equal(expandMacro("@weekly"), "0 0 * * 0");
  assert.equal(expandMacro("@daily"), "0 0 * * *");
  assert.equal(expandMacro("@midnight"), "0 0 * * *");
  assert.equal(expandMacro("@hourly"), "0 * * * *");
});

test("expandMacro leaves an ordinary expression alone", () => {
  assert.equal(expandMacro("*/15 9-17 * * 1-5"), "*/15 9-17 * * 1-5");
  assert.equal(expandMacro("  0 9 * * 1  "), "  0 9 * * 1  ");
});

test("a macro parses to the same fields as the expression it stands for", () => {
  for (const [macro, expanded] of Object.entries(CRON_MACROS)) {
    const fromMacro = parseCron(macro);
    const fromText = parseCron(expanded);
    assert.equal(fromMacro.valid, true, `${macro} was refused`);
    assert.deepEqual(fromMacro.fields, fromText.fields, `${macro} != ${expanded}`);
  }
});

test("a macro is case-insensitive, as crontab itself is", () => {
  assert.equal(parseCron("@DAILY").valid, true);
});

test("a macro drives the trigger timeline too", () => {
  const runs = getNextRuns("@hourly", 3, new Date("2026-01-01T00:30:00Z"), "UTC");
  assert.equal(runs.length, 3);
  assert.equal(runs[0].date.getUTCMinutes(), 0);
});

test("an unknown macro is named, not swallowed", () => {
  const result = parseCron("@fortnightly");
  assert.equal(result.valid, false);
  assert.match(result.error, /Unknown macro @fortnightly/);
  assert.match(result.error, /@daily/, "the error should say what the real ones are");
});

test("@reboot says it has no schedule rather than failing on field count", () => {
  const result = parseCron("@reboot");
  assert.equal(result.valid, false);
  assert.match(result.error, /once at startup/);
  assert.doesNotMatch(result.error, /5 fields/);
});

test("a 6-field expression is named as Quartz, not counted at", () => {
  const result = parseCron("0 0 12 * * ?");
  assert.equal(result.valid, false);
  assert.match(result.error, /Quartz/);
  assert.match(result.error, /seconds/);
});

test("a 7-field Quartz expression gets the same answer", () => {
  assert.match(parseCron("0 0 12 * * ? 2026").error, /Quartz/);
});

test("a wrong field count that is not Quartz still gets the plain message", () => {
  assert.match(parseCron("* * *").error, /Expected exactly 5 fields/);
});

/* --- Timezones -------------------------------------------------------------
 *
 * A cron expression is wall clock: `0 9 * * *` means nine in the morning where
 * the scheduler runs. The rail used to compute in the browser's zone and say
 * so in a static pill, which answered a question nobody asks.
 */

test("the same expression fires at different instants in different zones", () => {
  const from = new Date("2026-06-01T00:00:00Z");
  const utc = getNextRuns("0 9 * * *", 1, from, "UTC")[0];
  const newYork = getNextRuns("0 9 * * *", 1, from, "America/New_York")[0];

  assert.equal(utc.date.toISOString(), "2026-06-01T09:00:00.000Z");
  // 09:00 in New York on 1 June is 13:00 UTC (EDT, UTC-4).
  assert.equal(newYork.date.toISOString(), "2026-06-01T13:00:00.000Z");
});

test("the wall-clock hour is what the visitor asked for, in their chosen zone", () => {
  const runs = getNextRuns("30 14 * * *", 3, new Date("2026-02-01T00:00:00Z"), "Asia/Kolkata");
  for (const run of runs) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(run.date);
    assert.equal(parts.find((p) => p.type === "hour").value, "14");
    assert.equal(parts.find((p) => p.type === "minute").value, "30");
  }
});

test("a daylight-saving jump does not drop or duplicate a daily run", () => {
  // US DST began 08 Mar 2026. A 02:30 daily job is the awkward case: that wall
  // time does not exist on the day the clock springs forward.
  const runs = getNextRuns("30 2 * * *", 4, new Date("2026-03-06T12:00:00Z"), "America/New_York");
  assert.equal(runs.length, 4);
  const days = new Set(
    runs.map((r) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", day: "2-digit" }).format(r.date),
    ),
  );
  assert.equal(days.size, 4, "two runs landed on the same local day");
});

test("runs are reported in the zone they were computed for", () => {
  const [run] = getNextRuns("0 9 * * *", 1, new Date("2026-06-01T00:00:00Z"), "Asia/Tokyo");
  assert.equal(run.timeZone, "Asia/Tokyo");
  assert.match(run.localTime, /^09:00/);
});

test("resolveLocalTimeZone always answers something usable", () => {
  const zone = resolveLocalTimeZone();
  assert.equal(typeof zone, "string");
  assert.ok(zone.length > 0);
  // It has to be a zone Intl will actually accept.
  assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: zone }));
});

test("the timezone control is a select over the runtime's own zone list", () => {
  const markup = readFileSync("frontend/cron.html", "utf8");
  assert.match(markup, /<select id="cron-tz"/, "the pill is still a pill");
  const ui = readFileSync("frontend/js/cron/cron-ui.js", "utf8");
  assert.match(ui, /Intl\.supportedValuesOf\("timeZone"\)/);
});
