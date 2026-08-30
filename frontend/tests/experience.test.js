import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  formatSpan,
  monthsBetween,
  initExperience,
} from "../js/experience.js";

/* Both endpoints count, the way a resume counts them: Feb 2018 to Oct 2022
   reads as 4 yr 9 mo, not 4 yr 8 mo. */
test("monthsBetween counts both endpoint months", () => {
  assert.equal(monthsBetween(new Date(2018, 1, 1), new Date(2018, 1, 1)), 1);
  assert.equal(monthsBetween(new Date(2018, 1, 1), new Date(2022, 9, 1)), 57);
  assert.equal(monthsBetween(new Date(2022, 10, 1), new Date(2026, 7, 1)), 46);
});

test("monthsBetween floors at zero for reversed or invalid ranges", () => {
  assert.equal(monthsBetween(new Date(2022, 0, 1), new Date(2018, 0, 1)), 0);
  assert.equal(monthsBetween(null, new Date(2018, 0, 1)), 0);
  assert.equal(monthsBetween(new Date(2018, 0, 1), "2020-01"), 0);
});

test("formatSpan drops empty units", () => {
  assert.equal(formatSpan(103), "8 yr 7 mo");
  assert.equal(formatSpan(12), "1 yr");
  assert.equal(formatSpan(7), "7 mo");
  assert.equal(formatSpan(0), "");
  assert.equal(formatSpan(Number.NaN), "");
});

function mountExperience(html) {
  const dom = new JSDOM(`<main><section id="resume">${html}</section></main>`, {
    url: "https://example.test/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  return dom;
}

function teardown() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
}

const DENSITY_MARKUP = `
  <p class="xp-role-span" data-xp-span data-start="2018-02" data-end="2022-10">fallback</p>
  <p class="xp-tenure" data-xp-span data-start="2018-02" data-end="not-a-date">8 yr+</p>
  <div id="xp-density">
    <button type="button" data-density="highlights" aria-pressed="true"></button>
    <button type="button" data-density="full" aria-pressed="false"></button>
  </div>
  <details class="xp-how"><summary>a</summary><p>one</p></details>
  <details class="xp-how"><summary>b</summary><p>two</p></details>
`;

test("initExperience computes spans and leaves unparseable ones alone", () => {
  const dom = mountExperience(DENSITY_MARKUP);
  try {
    initExperience();
    const doc = dom.window.document;
    assert.equal(doc.querySelector(".xp-role-span").textContent, "4 yr 9 mo");
    // The authored fallback survives rather than being blanked.
    assert.equal(doc.querySelector(".xp-tenure").textContent, "8 yr+");
  } finally {
    teardown();
  }
});

test("the density switch opens and closes every disclosure", () => {
  const dom = mountExperience(DENSITY_MARKUP);
  try {
    initExperience();
    const doc = dom.window.document;
    const disclosures = [...doc.querySelectorAll(".xp-how")];
    const group = doc.getElementById("xp-density");
    const [highlights, full] = group.querySelectorAll("[data-density]");

    assert.deepEqual(disclosures.map((d) => d.open), [false, false]);

    full.dispatchEvent(new dom.window.Event("click"));
    assert.deepEqual(disclosures.map((d) => d.open), [true, true]);
    assert.equal(full.getAttribute("aria-pressed"), "true");
    assert.equal(highlights.getAttribute("aria-pressed"), "false");
    assert.equal(doc.getElementById("resume").dataset.xpDensity, "full");

    highlights.dispatchEvent(new dom.window.Event("click"));
    assert.deepEqual(disclosures.map((d) => d.open), [false, false]);
    assert.equal(highlights.getAttribute("aria-pressed"), "true");
  } finally {
    teardown();
  }
});

test("the switch reports mixed when one card is opened by hand", () => {
  const dom = mountExperience(DENSITY_MARKUP);
  try {
    initExperience();
    const doc = dom.window.document;
    const [first] = doc.querySelectorAll(".xp-how");
    const buttons = [
      ...doc.getElementById("xp-density").querySelectorAll("[data-density]"),
    ];

    first.open = true;
    // jsdom does not fire `toggle` off a property write, so stand in for it.
    first.dispatchEvent(new dom.window.Event("toggle"));

    assert.deepEqual(
      buttons.map((b) => b.getAttribute("aria-pressed")),
      ["false", "false"],
      "neither button should claim a state the cards do not have",
    );
    assert.equal(doc.getElementById("resume").dataset.xpDensity, undefined);
  } finally {
    teardown();
  }
});

test("the chosen density is remembered across mounts", () => {
  const first = mountExperience(DENSITY_MARKUP);
  try {
    initExperience();
    first.window.document
      .querySelector('#xp-density [data-density="full"]')
      .dispatchEvent(new first.window.Event("click"));
    assert.equal(
      first.window.localStorage.getItem("rj_experience_density"),
      "full",
    );
  } finally {
    teardown();
  }

  const second = mountExperience(DENSITY_MARKUP);
  try {
    second.window.localStorage.setItem("rj_experience_density", "full");
    initExperience();
    assert.deepEqual(
      [...second.window.document.querySelectorAll(".xp-how")].map((d) => d.open),
      [true, true],
    );
  } finally {
    teardown();
  }
});

test("initExperience is inert when the section is absent", () => {
  const dom = new JSDOM("<main></main>", { url: "https://example.test/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    assert.doesNotThrow(() => initExperience());
  } finally {
    teardown();
  }
});
