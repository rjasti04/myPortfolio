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
    "Selected: 8 of 12",
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
