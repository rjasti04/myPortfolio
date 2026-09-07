/**
 * Arcade shell: the launcher, the HUD, and the lifecycle around a game.
 *
 * The four games know nothing about scores being stored, about the back
 * button, or about each other. They receive a mount point and an `api`, they
 * report score and game over, and they clean up after themselves in
 * `destroy()`. Everything else lives here, which is why restarting a game is
 * `destroy()` followed by `create()` rather than each game growing its own
 * reset path - a reset that misses one field is the classic source of a second
 * run that behaves like a continuation of the first.
 *
 * Adding a game is an import and one array entry.
 */

import { createAudio } from "./audio.js";
import { readBest, writeBest } from "./storage.js";
import * as game2048 from "./game-2048.js";
import * as tetris from "./game-tetris.js";
import * as flapper from "./game-flapper.js";
import * as stack from "./game-stack.js";

const GAMES = [game2048, tetris, flapper, stack];
const BASE_TITLE = document.title;

/** Small inline SVG marks - the page ships no icon font of its own. */
const ART = {
  2048: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2" opacity=".65"/><rect x="3" y="13" width="8" height="8" rx="2" opacity=".65"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  tetris:
    '<rect x="2" y="8" width="6" height="6" rx="1"/><rect x="8" y="8" width="6" height="6" rx="1"/><rect x="14" y="8" width="6" height="6" rx="1"/><rect x="8" y="14" width="6" height="6" rx="1"/>',
  flapper:
    '<circle cx="8" cy="12" r="4"/><rect x="15" y="2" width="5" height="6" rx="1.5"/><rect x="15" y="14" width="5" height="8" rx="1.5"/>',
  stack:
    '<rect x="4" y="16" width="16" height="5" rx="1.5"/><rect x="6" y="10" width="12" height="5" rx="1.5" opacity=".8"/><rect x="8" y="4" width="8" height="5" rx="1.5" opacity=".6"/>',
};

const launcher = document.querySelector("#launcher");
const grid = document.querySelector("#launcher-grid");
const stage = document.querySelector("#stage");
const mount = document.querySelector("#mount");
const stageTitle = document.querySelector("#stage-title");
const stageControls = document.querySelector("#stage-controls");
const scoreOut = document.querySelector("#hud-score");
const bestOut = document.querySelector("#hud-best");
const overlay = document.querySelector("#overlay");
const overlayScore = document.querySelector("#overlay-score");
const overlayNote = document.querySelector("#overlay-note");
const muteButton = document.querySelector("#mute");
const muteLabel = muteButton.querySelector('[data-role="label"]');
const mastheadActions = document.querySelector("#masthead-actions");
const hudTools = document.querySelector("#hud-tools");

const audio = createAudio();
let current = null;
let instance = null;
let score = 0;

/* The button is an icon: `aria-pressed` picks the glyph in CSS, and the label
   it is named by is off screen rather than in its text content. */
function syncMuteButton() {
  const label = audio.muted ? "Sound off" : "Sound on";
  muteButton.setAttribute("aria-pressed", String(audio.muted));
  muteButton.title = label;
  muteLabel.textContent = label;
}

/** Build the launcher from each module's own `meta`, so the list has one source. */
for (const game of GAMES) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "launch-card";
  card.dataset.game = game.meta.id;
  card.innerHTML = `
    <svg class="launch-art" viewBox="0 0 24 24" aria-hidden="true">${ART[game.meta.id] ?? ""}</svg>
    <span class="launch-name">${game.meta.name}</span>
    <span class="launch-tagline">${game.meta.tagline}</span>
    <span class="launch-best" data-role="best"></span>`;
  card.addEventListener("click", () => start(game));
  grid.append(card);
}

/**
 * Refresh the score bubble on every launcher card. Called on entry and on exit.
 *
 * The bubble shows the number alone, so the word it means is carried off
 * screen - a card that read "2048, slide merge and chase the tile, 32" would
 * be announcing a number with no unit.
 */
function refreshBests() {
  grid.querySelectorAll(".launch-card").forEach((card) => {
    const best = readBest(card.dataset.game);
    const badge = card.querySelector('[data-role="best"]');
    badge.classList.toggle("launch-best--empty", !best);
    badge.innerHTML = best
      ? `<span class="visually-hidden">Best score </span>${best}`
      : '<span class="visually-hidden">Not played yet</span><span aria-hidden="true">New</span>';
  });
}

const api = {
  audio,
  setScore(value) {
    score = value;
    scoreOut.textContent = String(value);
  },
  gameOver(finalScore) {
    const record = writeBest(current.meta.id, finalScore);
    overlayScore.textContent = String(finalScore);
    overlayNote.textContent = record
      ? "New personal best."
      : `Best ${readBest(current.meta.id)}.`;
    bestOut.textContent = String(readBest(current.meta.id));
    overlay.hidden = false;
    // Move focus to the overlay so a keyboard player is not left tabbing
    // through a board that no longer responds.
    overlay.querySelector("button").focus();
  },
};

function mountGame() {
  overlay.hidden = true;
  score = 0;
  scoreOut.textContent = "0";
  bestOut.textContent = String(readBest(current.meta.id));
  instance = current.create({ mount, api });
}

function start(game) {
  current = game;
  stageTitle.textContent = game.meta.name;
  stageControls.textContent = game.meta.controls;
  document.title = `${game.meta.name} · ${BASE_TITLE}`;
  // The stylesheet keys the stage's accent off this, so the chrome takes the
  // colour the game's card already wears.
  stage.dataset.game = game.meta.id;
  // Collapses the page to one viewport with the board taking everything that
  // is not the play bar.
  document.body.classList.add("is-playing");
  // The masthead goes with it, so the one sound button moves rather than a
  // second one existing to be kept in step.
  hudTools.append(muteButton);
  launcher.hidden = true;
  stage.hidden = false;
  mountGame();
  stageTitle.focus();
}

/** Banked before a run is torn down, so quitting never discards a best score. */
function bankScore() {
  if (current) writeBest(current.meta.id, score);
}

function restart() {
  bankScore();
  instance?.destroy();
  instance = null;
  mountGame();
}

function exit() {
  bankScore();
  instance?.destroy();
  instance = null;
  overlay.hidden = true;
  stage.hidden = true;
  launcher.hidden = false;
  document.body.classList.remove("is-playing");
  mastheadActions.prepend(muteButton);
  document.title = BASE_TITLE;
  refreshBests();
  // Return focus to the card that was launched, not to the top of the page.
  grid.querySelector(`[data-game="${current?.meta.id}"]`)?.focus();
  current = null;
}

document
  .querySelectorAll('[data-action="restart"]')
  .forEach((el) => el.addEventListener("click", restart));
document
  .querySelectorAll('[data-action="exit"]')
  .forEach((el) => el.addEventListener("click", exit));

muteButton.addEventListener("click", () => {
  audio.toggleMuted();
  syncMuteButton();
});

// Escape leaves the game. Bound once here rather than per game, and ignored on
// the launcher so it cannot swallow a browser-level Escape.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || stage.hidden) return;
  event.preventDefault();
  exit();
});

syncMuteButton();
refreshBests();
