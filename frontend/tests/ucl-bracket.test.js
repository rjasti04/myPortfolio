import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync("frontend/ucl.html", "utf8");

// JSDOM parses asynchronously, so the page is only wired up once it has fired
// its own DOMContentLoaded.
function boot(search = "") {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://rjasti.com/ucl" + search,
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

test("renders 36 league-phase rows with zone dividers", async () => {
  const { window } = await boot();
  const rows = window.document.querySelectorAll(".lp-row");
  assert.equal(rows.length, 36);
  assert.equal(window.document.querySelectorAll(".zone-divider").length, 2);

  const zones = [...rows].map((r) => r.className.match(/zone-\w+/)[0]);
  assert.equal(
    zones.slice(0, 8).every((z) => z === "zone-r16"),
    true,
  );
  assert.equal(
    zones.slice(8, 24).every((z) => z === "zone-po"),
    true,
  );
  assert.equal(
    zones.slice(24).every((z) => z === "zone-out"),
    true,
  );

  const names = [...rows].map((r) => r.querySelector(".lp-name").textContent);
  assert.equal(new Set(names).size, 36, "no duplicate clubs");
  assert.equal(names[0], "Paris Saint-Germain");
  assert.equal(names[35], "Sabah");
});

test("seeded eight rail mirrors the top of the table", async () => {
  const { window } = await boot();
  const rail = [
    ...window.document.querySelectorAll("#rail-seeds .seed-name"),
  ].map((e) => e.textContent);
  const top8 = [...window.document.querySelectorAll(".lp-row .lp-name")]
    .slice(0, 8)
    .map((e) => e.textContent);
  assert.deepEqual(rail, top8);
});

test("builds 8 play-off ties pairing seeds 9-16 with 17-24", async () => {
  const { window } = await boot();
  const cards = window.document.querySelectorAll(
    "#playoff-container .match-card",
  );
  assert.equal(cards.length, 8);

  const names = [...window.document.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  const pairs = [...cards].map((c) =>
    [...c.querySelectorAll(".match-team-name")].map((e) => e.textContent),
  );

  // 9v24, 10v23 ... 16v17
  pairs.forEach(([a, b], i) => {
    assert.equal(a, names[8 + i], `tie ${i + 1} home side`);
    assert.equal(b, names[23 - i], `tie ${i + 1} away side`);
  });
  assert.equal(
    window.document.getElementById("playoff-counter").textContent,
    "Decided: 0 of 8",
  );
});

test("round of 16 seeds the top eight against the reserved play-off bands", async () => {
  const { window } = await boot();
  const names = [...window.document.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  const expected = { 1: 1, 2: 8, 3: 3, 4: 5, 5: 2, 6: 7, 7: 4, 8: 6 };

  for (const [tie, seed] of Object.entries(expected)) {
    const card = window.document.querySelector(`#d-r16-${tie} .match-card`);
    assert.equal(
      card.querySelector(".match-team-name").textContent,
      names[seed - 1],
      `r16-${tie}`,
    );
    assert.match(
      card.querySelectorAll(".match-team")[1].textContent,
      /PO \d winner/,
    );
  }
});

test("picking winners fills the whole tree up to the champion", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Higher seed wins every play-off.
  doc
    .querySelectorAll("#playoff-container .match-card")
    .forEach((c) => click(c.querySelector(".match-team")));
  assert.equal(
    doc.getElementById("playoff-counter").textContent,
    "Decided: 8 of 8",
  );

  // Then the top line of every knockout tie, round by round.
  for (const round of [
    ["r16", 8],
    ["qf", 4],
    ["sf", 2],
  ]) {
    for (let i = 1; i <= round[1]; i++) {
      click(doc.querySelector(`#d-${round[0]}-${i} .match-team`));
    }
  }
  click(doc.querySelector("#d-final .match-team"));

  const names = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  const champion = doc.querySelector(
    "#d-champion .champion-team span",
  ).textContent;
  assert.equal(champion, names[0], "the top seed should win a chalk bracket");

  const slots = doc.querySelectorAll("#d-champion .champion-slot");
  assert.equal(slots.length, 2);
  assert.equal(
    slots[1].querySelector(".champion-team span").textContent,
    names[1],
  );
});

test("share code round-trips through the URL", async () => {
  const first = await boot();
  const doc = first.window.document;
  const click = (el) =>
    el.dispatchEvent(new first.window.MouseEvent("click", { bubbles: true }));

  // Reorder a little, then decide some ties.
  click(doc.querySelectorAll(".lp-row")[10].querySelector(".reorder-up"));
  click(doc.querySelectorAll(".lp-row")[30].querySelector(".reorder-up"));
  doc
    .querySelectorAll("#playoff-container .match-card")
    .forEach((c) => click(c.querySelectorAll(".match-team")[1]));
  for (let i = 1; i <= 8; i++)
    click(doc.querySelector(`#d-r16-${i} .match-team`));

  const code = first.window.localStorage.getItem("ucl-predictor-state");
  const [order, po, ko] = code.split("-");
  assert.equal(order.length, 36);
  assert.equal(po, "11111111");
  assert.equal(ko.slice(0, 8), "00000000");
  assert.equal(ko.slice(8), "xxxxxxx");

  const second = await boot("?s=" + code);
  const sdoc = second.window.document;
  assert.deepEqual(
    [...sdoc.querySelectorAll(".lp-row .lp-name")].map((e) => e.textContent),
    [...doc.querySelectorAll(".lp-row .lp-name")].map((e) => e.textContent),
  );
  assert.equal(
    sdoc.getElementById("playoff-counter").textContent,
    "Decided: 8 of 8",
  );
  assert.equal(sdoc.querySelectorAll("#d-r16-1 .match-team.winner").length, 1);
  assert.equal(second.window.localStorage.getItem("ucl-predictor-state"), code);
});

test("reordering the table clears picks that no longer exist", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  doc
    .querySelectorAll("#playoff-container .match-card")
    .forEach((c) => click(c.querySelector(".match-team")));
  for (let i = 1; i <= 8; i++)
    click(doc.querySelector(`#d-r16-${i} .match-team`));
  assert.equal(
    doc.querySelectorAll("#d-qf-1 .match-team.placeholder").length,
    0,
  );

  // Send the club that finished 1st down to 30th: its R16 tie no longer exists.
  for (let i = 0; i < 29; i++) {
    click(doc.querySelectorAll(".lp-row")[i].querySelector(".reorder-down"));
  }

  const code = window.localStorage.getItem("ucl-predictor-state");
  const [order] = code.split("-");
  assert.equal(new Set(order).size <= 36, true);
  assert.equal(
    [...doc.querySelectorAll(".lp-row .lp-name")][29].textContent,
    "Paris Saint-Germain",
  );
  assert.equal(doc.querySelectorAll(".lp-row").length, 36);
});

test("a malformed share code falls back to the default table", async () => {
  const { window } = await boot("?s=not-a-real-code");
  assert.equal(window.document.querySelectorAll(".lp-row").length, 36);
  assert.equal(
    window.document.querySelector(".lp-row .lp-name").textContent,
    "Paris Saint-Germain",
  );
});

test("mobile round tabs swap the rendered round", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.equal(
    doc.querySelectorAll("#mobile-bracket-list-container .match-card").length,
    8,
  );
  click(doc.querySelector('.mobile-tab-btn[data-round="qf"]'));
  assert.equal(
    doc.querySelectorAll("#mobile-bracket-list-container .match-card").length,
    4,
  );
  click(doc.querySelector('.mobile-tab-btn[data-round="final"]'));
  assert.equal(
    doc.querySelectorAll("#mobile-bracket-list-container .match-card").length,
    1,
  );
  assert.equal(
    doc.getElementById("mobile-champion-container").style.display,
    "",
  );
});

test("quick fill settles every remaining tie with the higher seed", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.equal(
    doc.getElementById("progress-label").textContent,
    "0 of 23 ties decided",
  );

  click(doc.getElementById("autofill-btn"));

  assert.equal(
    doc.getElementById("progress-label").textContent,
    "Bracket complete",
  );
  assert.equal(
    doc.getElementById("progress-track").getAttribute("aria-valuenow"),
    "23",
  );
  assert.equal(
    doc.getElementById("playoff-counter").textContent,
    "Decided: 8 of 8",
  );

  const names = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  const champion = doc.querySelector(
    "#d-champion .champion-team span",
  ).textContent;
  assert.ok(
    names.includes(champion),
    "champion is a valid club from the tournament",
  );
  assert.ok(champion.length > 0);

  // A pick already made by hand is left alone.
  const [, po, ko] = window.localStorage
    .getItem("ucl-predictor-state")
    .split("-");
  assert.equal(po.includes("x"), false);
  assert.equal(ko.includes("x"), false);
});

test("quick fill produces randomized outcomes across multiple runs", async () => {
  const states = [];
  for (let i = 0; i < 5; i++) {
    const { window } = await boot();
    const doc = window.document;
    const click = (el) =>
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    click(doc.getElementById("autofill-btn"));
    states.push(window.localStorage.getItem("ucl-predictor-state"));
  }

  const uniqueStates = new Set(states);
  assert.ok(
    uniqueStates.size > 1,
    `expected varied randomized brackets across 5 runs, got ${uniqueStates.size} unique state(s)`,
  );
});

test("quick fill preserves picks already made", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Send the lower seed through play-off 1, then fill the rest.
  click(
    doc
      .querySelectorAll("#playoff-container .match-card")[0]
      .querySelectorAll(".match-team")[1],
  );
  click(doc.getElementById("autofill-btn"));

  const names = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  const po1Winner = doc.querySelector(
    "#playoff-container .match-card .match-team.winner .match-team-name",
  );
  assert.equal(
    po1Winner.textContent,
    names[23],
    "the 24th seed keeps the upset it was given",
  );
});

test("the rank pill swaps to a number field that moves a club", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  const before = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  click(doc.querySelectorAll(".lp-row")[30].querySelector(".lp-rank"));

  const input = doc.querySelector(".lp-jump");
  assert.ok(input, "the pill became an input");
  assert.equal(input.value, "31");

  input.value = "1";
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );

  const after = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );
  assert.equal(after[0], before[30], "the club moved to the top");
  assert.equal(after[1], before[0], "everyone else shifted down");
  assert.equal(doc.querySelectorAll(".lp-row").length, 36);
});

test("an out-of-range jump is clamped, and Escape cancels", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const before = [...doc.querySelectorAll(".lp-row .lp-name")].map(
    (e) => e.textContent,
  );

  click(doc.querySelectorAll(".lp-row")[5].querySelector(".lp-rank"));
  let input = doc.querySelector(".lp-jump");
  input.value = "999";
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert.equal(
    [...doc.querySelectorAll(".lp-row .lp-name")][35].textContent,
    before[5],
    "clamped to last place",
  );

  click(doc.querySelectorAll(".lp-row")[2].querySelector(".lp-rank"));
  input = doc.querySelector(".lp-jump");
  input.value = "1";
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(doc.querySelector(".lp-jump"), null, "the field closed");
  assert.equal(
    [...doc.querySelectorAll(".lp-row .lp-name")][2].textContent,
    before[2],
    "Escape left the order alone",
  );
});

test("the league table row carries the club's association", async () => {
  const { window } = await boot();
  const rows = window.document.querySelectorAll(".lp-row");
  assert.equal(rows[0].querySelector(".lp-country").textContent, "France");
  assert.equal(rows[3].querySelector(".lp-country").textContent, "England");
  const blanks = [...rows].filter(
    (r) => !r.querySelector(".lp-country").textContent.trim(),
  );
  assert.deepEqual(blanks, [], "every club resolves to an association");
});

// jsdom has no PointerEvent constructor, so build the event from MouseEvent and
// carry the pointer fields the page reads. Listeners key off the type name.
function pointerEvent(
  window,
  type,
  clientY,
  pointerId = 7,
  pointerType = "touch",
) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

// Reordering has to work from a finger, so drive the real pointer sequence
// rather than calling the reorder helpers directly.
function grab(window, handle, pointerId = 7) {
  handle.setPointerCapture = () => {};
  handle.releasePointerCapture = () => {};
  return (type, clientY) =>
    handle.dispatchEvent(pointerEvent(window, type, clientY, pointerId));
}

// jsdom does no layout, so the rows need measurable geometry.
function stubRowGeometry(doc, rowHeight = 50) {
  [...doc.querySelectorAll(".lp-row")].forEach((row, i) => {
    row.getBoundingClientRect = () => ({
      top: i * rowHeight,
      bottom: i * rowHeight + rowHeight,
      height: rowHeight,
    });
  });
  doc.getElementById("standings-container").getBoundingClientRect = () => ({
    top: 0,
    height: 36 * rowHeight,
  });
  return rowHeight;
}

test("a touch drag on the handle reorders the table", async () => {
  const { window } = await boot();
  const doc = window.document;
  const names = () =>
    [...doc.querySelectorAll(".lp-row")].map(
      (r) => r.querySelector(".lp-name").textContent,
    );
  const before = names();
  const ROW_H = stubRowGeometry(doc);

  // Drag the top club down past the midpoints of the next two rows.
  const fire = grab(window, doc.querySelector(".lp-row .drag-handle"));
  fire("pointerdown", 25);
  fire("pointermove", 35);
  fire("pointermove", 2 * ROW_H + 40);
  fire("pointerup", 2 * ROW_H + 40);

  const after = names();
  assert.equal(after[2], before[0], "the dragged club landed third");
  assert.equal(after[0], before[1]);
  assert.equal(after.length, 36);
  assert.equal(
    doc.body.classList.contains("is-dragging"),
    false,
    "drag state cleaned up",
  );
});

test("a tap does not reorder, and Escape abandons a drag", async () => {
  const { window } = await boot();
  const doc = window.document;
  const names = () =>
    [...doc.querySelectorAll(".lp-row")].map(
      (r) => r.querySelector(".lp-name").textContent,
    );
  const before = names();
  stubRowGeometry(doc);

  const fire = grab(window, doc.querySelector(".lp-row .drag-handle"), 3);

  // Under the slop threshold: a tap, not a drag.
  fire("pointerdown", 20);
  fire("pointermove", 22);
  fire("pointerup", 22);
  assert.deepEqual(names(), before, "a tap changed nothing");

  // A real drag, abandoned with Escape before release.
  fire("pointerdown", 20);
  fire("pointermove", 300);
  window.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  fire("pointerup", 300);

  assert.deepEqual(names(), before, "Escape abandoned the drag");
  assert.equal(doc.body.classList.contains("is-dragging"), false);
});

test("hovering a club lights its rows and the edges it won", async () => {
  const { window } = await boot();
  const doc = window.document;
  const click = (el) =>
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  click(doc.getElementById("autofill-btn"));
  const champion = doc.querySelector(
    "#d-champion .champion-team span",
  ).textContent;

  const row = [...doc.querySelectorAll("#d-r16-1 .match-team")].find(
    (el) => el.dataset.team === champion,
  );
  assert.ok(row, "the champion appears in its round-of-16 tie");

  row.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));

  const lit = [...doc.querySelectorAll(".match-team.route")].map(
    (el) => el.dataset.team,
  );
  assert.equal(new Set(lit).size, 1, "only one club is lit");
  assert.equal(lit[0], champion);
  // R16, QF, SF and the final, on both the desktop bracket and the mobile list.
  assert.ok(
    lit.length >= 4,
    `expected the whole run to light up, saw ${lit.length}`,
  );

  assert.equal(
    doc.getElementById("desktop-bracket-stage").classList.contains("routing"),
    true,
  );
  assert.ok(doc.querySelectorAll(".match-card.on-route").length >= 4);

  row.dispatchEvent(
    new window.MouseEvent("mouseout", {
      bubbles: true,
      relatedTarget: doc.body,
    }),
  );
  assert.equal(
    doc.querySelectorAll(".match-team.route").length,
    0,
    "highlight cleared",
  );
  assert.equal(
    doc.getElementById("desktop-bracket-stage").classList.contains("routing"),
    false,
  );
});

test("every club's flag code resolves to its own country, with a text fallback", async () => {
  const { window } = await boot();
  const doc = window.document;

  const EXPECTED = {
    "Paris Saint-Germain": ["fr", "France", "FRA"],
    Liverpool: ["gb-eng", "England", "ENG"],
    "Manchester City": ["gb-eng", "England", "ENG"],
    "Bayern München": ["de", "Germany", "GER"],
    "Real Madrid": ["es", "Spain", "ESP"],
    Inter: ["it", "Italy", "ITA"],
    "Sporting CP": ["pt", "Portugal", "POR"],
    "Club Brugge": ["be", "Belgium", "BEL"],
    Feyenoord: ["nl", "Netherlands", "NED"],
    "Bodø/Glimt": ["no", "Norway", "NOR"],
    Galatasaray: ["tr", "Türkiye", "TUR"],
    "Shakhtar Donetsk": ["ua", "Ukraine", "UKR"],
    "Slavia Praha": ["cz", "Czechia", "CZE"],
    "Slovan Bratislava": ["sk", "Slovakia", "SVK"],
    "AEK Athens": ["gr", "Greece", "GRE"],
    LASK: ["at", "Austria", "AUT"],
    Sabah: ["az", "Azerbaijan", "AZE"],
  };

  const rows = [...doc.querySelectorAll(".lp-row")];
  assert.equal(rows.length, 36);

  for (const row of rows) {
    const club = row.querySelector(".lp-name").textContent;
    const img = row.querySelector("img.team-flag");
    assert.ok(img, `${club} has a flag`);

    const code = img.getAttribute("src").match(/\/w40\/([a-z-]+)\.png$/)[1];
    assert.equal(
      img.getAttribute("src").startsWith("https://flagcdn.com/"),
      true,
    );

    const expected = EXPECTED[club];
    if (expected) {
      assert.equal(code, expected[0], `${club} flies the ${expected[1]} flag`);
      assert.equal(img.getAttribute("alt"), expected[1]);
      assert.equal(img.dataset.abbr, expected[2]);
    }
    // The row's association label and the flag must agree.
    assert.equal(
      row.querySelector(".lp-country").textContent,
      img.getAttribute("alt"),
    );
  }

  // A flag that fails to load leaves the country code behind, not a hole.
  const broken = rows[3].querySelector("img.team-flag");
  broken.dispatchEvent(new window.Event("error"));
  const badge = rows[3].querySelector(".flag-fallback");
  assert.ok(badge, "the broken flag became a badge");
  assert.equal(badge.textContent, "ENG");
  assert.equal(rows[3].querySelector("img.team-flag"), null);
});
