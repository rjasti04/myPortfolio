import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("frontend/worldcup.html", "utf8");

function boot(search = "") {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://rjasti.com/worldcup" + search,
    pretendToBeVisual: true,
  });

  return new Promise((resolve) => {
    if (dom.window.document.readyState === "complete") {
      resolve(dom);
      return;
    }
    dom.window.addEventListener("load", () => resolve(dom));
  });
}

test("renders 12 groups with 4 teams each", async () => {
  const { window } = await boot();
  const doc = window.document;
  const groupCards = doc.querySelectorAll("#groups-container .card");
  assert.equal(groupCards.length, 12, "12 groups rendered");

  const teams = doc.querySelectorAll("#groups-container .team-item");
  assert.equal(teams.length, 48, "48 teams in total");

  const wildcards = doc.querySelectorAll("#wildcards-container .wildcard-card");
  assert.equal(wildcards.length, 12, "12 wildcard candidate cards");
  assert.equal(
    doc.getElementById("wildcard-counter-label").textContent,
    "Selected: 8 of 8",
  );
});

test("header contains autofill-btn with dice icon and accessible attributes", async () => {
  const { window } = await boot();
  const doc = window.document;
  const btn = doc.getElementById("autofill-btn");
  assert.ok(btn, "autofill button exists");
  assert.equal(
    btn.getAttribute("aria-label"),
    "Randomly fill undecided stages and matches across the tournament",
  );
  assert.ok(btn.querySelector("i.fa-dice"), "has dice icon");
});

test("random fill completes all 32 knockout matches and crowns champion and podium", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Initially no matches decided
  const serialBefore = window.localStorage.getItem("predictor-state");
  if (serialBefore) {
    const [, , bracketBits] = serialBefore.split("-");
    assert.equal(bracketBits, "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  }

  // Click random fill
  click(doc.getElementById("autofill-btn"));

  // Check state serialization: all 32 bracket bits should be 0 or 1 (no 'x')
  const serialAfter = window.localStorage.getItem("predictor-state");
  assert.ok(serialAfter, "state saved to localStorage");
  const [, , bracketBitsAfter] = serialAfter.split("-");
  assert.equal(bracketBitsAfter.length, 32);
  assert.equal(bracketBitsAfter.includes("x"), false, "all 32 matches decided");

  // Check podium
  const gold = doc.querySelector(
    "#d-podium .podium-item.gold .podium-team-name",
  );
  assert.ok(gold && gold.textContent.trim().length > 0, "champion crowned");
  const silver = doc.querySelector(
    "#d-podium .podium-item.silver .podium-team-name",
  );
  assert.ok(
    silver && silver.textContent.trim().length > 0,
    "runner-up crowned",
  );
  const bronze = doc.querySelector(
    "#d-podium .podium-item.bronze .podium-team-name",
  );
  assert.ok(
    bronze && bronze.textContent.trim().length > 0,
    "third place crowned",
  );
});

test("random fill preserves manually chosen picks", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Pick team 2 in match r32-1 manually
  const r32FirstMatch = doc.querySelector("#d-r32-1 .match-card");
  const teams = r32FirstMatch.querySelectorAll(".match-team");
  const manualPickTeamName = teams[1]
    .querySelector(".match-team-name")
    .textContent.trim();
  click(teams[1]);

  // Verify match 1 in localStorage is '1'
  let [, , bits] = window.localStorage.getItem("predictor-state").split("-");
  assert.equal(bits[0], "1", "manual pick recorded");

  // Click random fill
  click(doc.getElementById("autofill-btn"));

  // Verify match 1 remained '1' and other matches were resolved
  const serialAfter = window.localStorage.getItem("predictor-state");
  const [, , bitsAfter] = serialAfter.split("-");
  assert.equal(bitsAfter[0], "1", "manual pick preserved");
  assert.equal(bitsAfter.includes("x"), false, "all matches completed");

  // Check card reflects winner class on team 2
  const updatedTeams = doc.querySelectorAll(
    "#d-r32-1 .match-card .match-team",
  );
  assert.equal(updatedTeams[1].classList.contains("winner"), true);
  assert.equal(
    updatedTeams[1].querySelector(".match-team-name").textContent.trim(),
    manualPickTeamName,
  );
});

test("random fill produces varied outcomes across runs", async () => {
  const dom1 = await boot();
  const dom2 = await boot();
  const click1 = (el) =>
    el.dispatchEvent(new dom1.window.MouseEvent("click", { bubbles: true }));
  const click2 = (el) =>
    el.dispatchEvent(new dom2.window.MouseEvent("click", { bubbles: true }));

  click1(dom1.window.document.getElementById("autofill-btn"));
  click2(dom2.window.document.getElementById("autofill-btn"));

  const state1 = dom1.window.localStorage.getItem("predictor-state");
  const state2 = dom2.window.localStorage.getItem("predictor-state");

  // With 12 groups shuffled, 8 wildcards randomized, and 32 coin flips,
  // consecutive runs produce diverse tournament paths
  assert.notEqual(
    state1,
    state2,
    "consecutive random fill runs produce diverse tournament paths",
  );
});

test("URL state parameter round-trips correctly after random fill", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  click(doc.getElementById("autofill-btn"));
  const serial = window.localStorage.getItem("predictor-state");

  // Boot a new instance with the serial in ?s=
  const loadedDom = await boot(`?s=${serial}`);
  const loadedSerial = loadedDom.window.localStorage.getItem("predictor-state");
  assert.equal(loadedSerial, serial, "serialized state reloads accurately");
});

/* --- Accessibility, chrome and parity with /ucl ---------------------------
 *
 * /worldcup was a design generation behind its sibling: no tab semantics, no
 * progress indicator anywhere except the wildcard counter on one of three
 * tabs, no hero context, and reorder buttons labelled "Move team up" twelve
 * groups over.
 */

test("the stage switcher is a real tablist with one selected tab", async () => {
  const { window } = await boot();
  const doc = window.document;

  assert.equal(doc.querySelector(".navigation-tabs").getAttribute("role"), "tablist");

  const tabs = [...doc.querySelectorAll(".navigation-tabs .tab-btn")];
  assert.equal(tabs.length, 3);
  for (const tab of tabs) {
    assert.equal(tab.getAttribute("role"), "tab");
    assert.ok(doc.getElementById(tab.getAttribute("aria-controls")));
  }
  assert.equal(tabs.filter((t) => t.getAttribute("aria-selected") === "true").length, 1);
  assert.equal(tabs.filter((t) => t.getAttribute("tabindex") !== "-1").length, 1);
});

test("clicking and arrowing both move the selection", async () => {
  const { window } = await boot();
  const tabs = [...window.document.querySelectorAll(".navigation-tabs .tab-btn")];

  tabs[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].getAttribute("tabindex"), "-1");

  tabs[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");

  tabs[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
});

test("the mobile round switcher is a tablist, and its panel follows the tab", async () => {
  const { window } = await boot();
  const doc = window.document;

  assert.equal(doc.querySelector(".mobile-bracket-tabs").getAttribute("role"), "tablist");
  const rounds = [...doc.querySelectorAll(".mobile-tab-btn")];
  assert.equal(rounds.length, 5);

  const panel = doc.getElementById("mobile-bracket-list-container");
  assert.equal(panel.getAttribute("role"), "tabpanel");

  rounds[3].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(rounds[3].getAttribute("aria-selected"), "true");
  assert.equal(panel.getAttribute("aria-labelledby"), rounds[3].id);
});

test("no decorative icon is left for a screen reader to read out", () => {
  const icons = html.match(/<i class="fa[^>]*>/g) ?? [];
  assert.deepEqual(icons.filter((i) => !i.includes("aria-hidden")), []);
});

test("the header no longer brands the app with the mark its footer disclaims", async () => {
  const { window } = await boot();
  const doc = window.document;

  assert.equal(doc.querySelector(".brand-title").textContent.trim(), "World Cup 26");
  // The disclaimer stays; it is the brand that was wrong.
  assert.match(doc.querySelector(".app-footer").textContent, /Not Affiliated With FIFA/);
});

test("the hero carries the same kind of context /ucl's does", async () => {
  const { window } = await boot();
  const chips = [...window.document.querySelectorAll(".hero-chip")].map((c) => c.textContent.trim());

  assert.equal(chips.length, 3);
  assert.match(chips.join(" | "), /48 teams/);
  assert.match(chips.join(" | "), /Round of 32/);
  assert.match(chips.join(" | "), /New Jersey/);
});

test("the progress bar counts the whole tournament, not one tab's wildcards", async () => {
  const { window } = await boot();
  const doc = window.document;

  const track = doc.getElementById("progress-track");
  assert.equal(track.getAttribute("role"), "progressbar");
  // Eight wildcard places plus 32 knockout ties.
  assert.equal(track.getAttribute("aria-valuemax"), "40");
  assert.equal(track.getAttribute("aria-valuenow"), "8", "the eight default wildcards are decided");
  assert.match(doc.getElementById("progress-label").textContent, /8 of 40 decisions made/);
});

test("a filled bracket reads as complete", async () => {
  const { window } = await boot();
  const doc = window.document;

  try {
    doc.getElementById("autofill-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  } catch {
    // The podium celebration reaches for a canvas jsdom does not implement;
    // the state it is celebrating has already been computed.
  }

  assert.equal(doc.getElementById("progress-track").getAttribute("aria-valuenow"), "40");
  assert.match(doc.getElementById("progress-label").textContent, /Bracket complete/);
});

test("a reorder button names the club it moves", async () => {
  const { window } = await boot();
  const up = window.document.querySelector(".reorder-up");

  assert.ok(up, "no reorder control rendered");
  const label = up.getAttribute("aria-label");
  assert.doesNotMatch(label, /^Move team (up|down)$/, "twelve groups of identical labels");
  assert.match(label, /^Move .+ up$/);
});

test("Reset takes two presses and never raises a browser dialog", async () => {
  const { window } = await boot();
  const doc = window.document;

  const code = html
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /window\.confirm\(|[^.\w]confirm\(/, "the native dialog is back");

  const reset = doc.getElementById("reset-btn");
  reset.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(reset.classList.contains("is-confirming"), "the first press should arm, not fire");

  reset.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(reset.classList.contains("is-confirming"), false);
  assert.equal(doc.getElementById("progress-track").getAttribute("aria-valuenow"), "8");
});

test("the page loads the shared chrome", () => {
  assert.match(html, /js\/app-shared\/predictor-chrome\.js/);
  assert.match(html, /href="app-shared\.css"/);
});
