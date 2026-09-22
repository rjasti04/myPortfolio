/**
 * Arcade shell: the launcher, the HUD, and the lifecycle around a game.
 *
 * The six games know nothing about scores being stored, about the back
 * button, or about each other. They receive a mount point and an `api`, they
 * report score and game over, and they clean up after themselves in
 * `destroy()`. Everything else lives here, which is why restarting a game is
 * `destroy()` followed by `create()` rather than each game growing its own
 * reset path - a reset that misses one field is the classic source of a second
 * run that behaves like a continuation of the first.
 *
 * Adding a game is an import and one array entry.
 *
 * Two things the games are also kept out of, for the same reason:
 *
 *   Routing. Which game is on screen is the URL fragment, not a variable -
 *   `/arcade#tetris` opens Tetris, the browser's back button leaves a game the
 *   way every other page on the web does, and a game is a link a visitor can
 *   send someone.
 *
 *   Pause. `suspendLoops()` stops whatever is animating and `setInputBlocked`
 *   closes the input path, so a paused game needs no code in the game. That
 *   matters most for the pause nobody presses: leaving the tab pauses the run
 *   rather than spending it, which is the difference between coming back to a
 *   game and coming back to a score.
 */

import { suspendLoops } from "./engine.js";
import { setInputBlocked } from "./input.js";
import { createAudio } from "./audio.js";
import { readBest, writeBest, readAllBests, clearAllBests } from "./storage.js";
import { initAppSwitcher } from "../app-shared/app-switcher.js";
import { initAppShortcuts } from "../app-shared/app-shortcuts.js";
import * as game2048 from "./game-2048.js";
import * as tetris from "./game-tetris.js";
import * as flapper from "./game-flapper.js";
import * as stack from "./game-stack.js";
import * as snake from "./game-snake.js";
import * as breaker from "./game-breaker.js";

const GAMES = [game2048, tetris, flapper, stack, snake, breaker];
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
  snake:
    '<rect x="3" y="3" width="6" height="6" rx="2"/><rect x="3" y="10" width="6" height="6" rx="2" opacity=".85"/><rect x="10" y="10" width="6" height="6" rx="2" opacity=".7"/><rect x="17" y="10" width="4" height="6" rx="2" opacity=".55"/><circle cx="19" cy="5" r="2.6"/>',
  breaker:
    '<rect x="2" y="3" width="6" height="4" rx="1.4"/><rect x="9" y="3" width="6" height="4" rx="1.4" opacity=".8"/><rect x="16" y="3" width="6" height="4" rx="1.4" opacity=".65"/><rect x="5" y="8" width="6" height="4" rx="1.4" opacity=".8"/><rect x="12" y="8" width="6" height="4" rx="1.4" opacity=".55"/><circle cx="15" cy="16" r="2.3"/><rect x="5" y="19" width="12" height="3" rx="1.5"/>',
};

/** The keyboard hint on a card, in the one place a player looks for it. */
const CONTROL_ART =
  '<rect x="2" y="6" width="20" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h2M11 10h2M16 10h2M8 14.5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

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
const pausePanel = document.querySelector("#pause-panel");
const pauseControls = document.querySelector("#pause-controls");
const pauseRules = document.querySelector("#pause-rules");
const launcherSummary = document.querySelector("#launcher-summary");
const launcherSummaryText = document.querySelector("#launcher-summary-text");
const clearScoresButton = document.querySelector("#clear-scores");
const pauseButton = document.querySelector("#pause-toggle");
const pauseLabel = pauseButton.querySelector('[data-role="label"]');
const muteButton = document.querySelector("#mute");
const muteLabel = muteButton.querySelector('[data-role="label"]');
const mastheadActions = document.querySelector("#masthead-actions");
const hudTools = document.querySelector("#hud-tools");
const announcer = document.querySelector("#announcer");

const audio = createAudio();
const byId = new Map(GAMES.map((game) => [game.meta.id, game]));

let current = null;
let instance = null;
let score = 0;
/** The function that restarts what pause stopped. Non-null only while paused. */
let resumeLoops = null;

/** One-off message for screen readers: state changes with no visual text. */
function announce(message) {
  announcer.textContent = message;
}

/* The button is an icon: `aria-pressed` picks the glyph in CSS, and the label
   it is named by is off screen rather than in its text content. */
function syncMuteButton() {
  const label = audio.muted ? "Sound off" : "Sound on";
  muteButton.setAttribute("aria-pressed", String(audio.muted));
  muteButton.title = label;
  muteLabel.textContent = label;
}

function syncPauseButton() {
  const paused = Boolean(resumeLoops);
  const label = paused ? "Resume (Escape)" : "Pause (Escape)";
  pauseButton.setAttribute("aria-pressed", String(paused));
  pauseButton.title = label;
  pauseLabel.textContent = label;
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
    <span class="launch-controls">
      <svg viewBox="0 0 24 24" aria-hidden="true">${CONTROL_ART}</svg>
      ${game.meta.controls}
    </span>
    <span class="launch-best" data-role="best"></span>`;
  card.addEventListener("click", () => openGame(game));
  grid.append(card);
}

/**
 * The one line the launcher was missing: how much of the arcade you have
 * actually played, and which run was the best of them.
 *
 * The data was already in storage under one prefix and already being read to
 * paint six separate bubbles; nothing tied them together, so there was no
 * "4 of 6 played" anywhere and no way to drop a score you would rather forget.
 *
 * The strip stays hidden until something has been played - an empty arcade
 * does not need a summary of itself.
 */
function refreshSummary() {
  if (!launcherSummary || !launcherSummaryText) return;

  const bests = readAllBests();
  // Only games still on the shelf count towards "of 6".
  const played = GAMES.filter((game) => bests[game.meta.id] > 0);

  if (played.length === 0) {
    launcherSummary.hidden = true;
    launcherSummaryText.textContent = "";
    return;
  }

  const top = played.reduce((best, game) =>
    bests[game.meta.id] > bests[best.meta.id] ? game : best,
  );

  launcherSummary.hidden = false;
  launcherSummaryText.textContent =
    `${played.length} of ${GAMES.length} played · best run: ` +
    `${top.meta.name} ${bests[top.meta.id].toLocaleString()}`;
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
    // A run that ends while paused would leave the panel over the result.
    clearPause();
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
    announce(
      record
        ? `Game over. ${finalScore}. New personal best.`
        : `Game over. ${finalScore}.`,
    );
  },
};

/* ---- Pause ------------------------------------------------------------- */

/** Drop the pause without resuming: the loops it held are about to be gone. */
function clearPause() {
  resumeLoops = null;
  setInputBlocked(false);
  pausePanel.hidden = true;
  syncPauseButton();
}

function pause() {
  // Nothing to pause on the launcher, and a game that is already over is not
  // paused - it is finished, and the result should stay on screen.
  if (!current || resumeLoops || !overlay.hidden) return;
  resumeLoops = suspendLoops();
  setInputBlocked(true);
  pausePanel.hidden = false;
  syncPauseButton();
  pausePanel.querySelector("button").focus();
  announce("Paused.");
}

function resume() {
  if (!resumeLoops) return;
  // Held before `clearPause` drops it, and named apart from the module's own
  // `restart` - one starts the loops again, the other throws the run away.
  const startLoops = resumeLoops;
  clearPause();
  startLoops();
  /* Focus goes back to the stage rather than to the pause button, and that is
     load-bearing rather than tidy. Space and Enter activate whatever button
     holds focus, and Space is the action key in three of these games: leaving
     it on the pause toggle means the first flap re-pauses the run. The title
     takes focus for the same reason entering a game gives it the title. */
  stageTitle.focus();
  announce("Resumed.");
}

/* ---- Lifecycle --------------------------------------------------------- */

function mountGame() {
  overlay.hidden = true;
  score = 0;
  scoreOut.textContent = "0";
  bestOut.textContent = String(readBest(current.meta.id));
  instance = current.create({ mount, api });
}

function enter(game) {
  current = game;
  stageTitle.textContent = game.meta.name;
  stageControls.textContent = game.meta.controls;
  pauseControls.textContent = game.meta.controls;
  // The pause panel is already described as the how-to sheet; `rules` is what
  // makes that true. Without it the only way to learn what scores was to start
  // playing and then stop.
  if (pauseRules) {
    pauseRules.textContent = game.meta.rules ?? "";
    pauseRules.hidden = !game.meta.rules;
  }
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
  clearPause();
  instance?.destroy();
  instance = null;
  mountGame();
  // The button that was clicked is either hidden now or about to be, so focus
  // would otherwise fall back to the document - and on the play-again button,
  // Space would restart a second time.
  stageTitle.focus();
}

function leave() {
  const left = current;
  bankScore();
  clearPause();
  instance?.destroy();
  instance = null;
  overlay.hidden = true;
  stage.hidden = true;
  launcher.hidden = false;
  document.body.classList.remove("is-playing");
  mastheadActions.prepend(muteButton);
  document.title = BASE_TITLE;
  current = null;
  refreshBests();
  refreshSummary();
  // Return focus to the card that was launched, not to the top of the page.
  grid.querySelector(`[data-game="${left?.meta.id}"]`)?.focus();
}

/* ---- Routing -----------------------------------------------------------
   The fragment is the state, not a mirror of it: every entry and exit goes
   through `route()`, so a typed URL, the back button and a click on a card all
   land in the same place. */

const gameFromHash = () => byId.get(location.hash.slice(1)) ?? null;

function route() {
  const next = gameFromHash();
  if (next === current) return;
  if (current) leave();
  if (next) enter(next);
}

/** Open a game, pushing history so back returns to the launcher. */
function openGame(game) {
  if (current === game) return;
  history.pushState({ arcade: game.meta.id }, "", `#${game.meta.id}`);
  route();
}

/** Leave the game on screen. */
function closeGame() {
  if (!current) return;
  if (history.state?.arcade) {
    // This tab opened the game, so going back is both the honest history
    // operation and the one that keeps the stack from growing an entry per
    // game a visitor tries.
    history.back();
    return;
  }
  // Landed straight on `/arcade#tetris`: there is no launcher behind us to go
  // back to, so drop the fragment in place rather than leaving the site.
  history.replaceState(null, "", location.pathname + location.search);
  route();
}

window.addEventListener("hashchange", route);
window.addEventListener("popstate", route);

/* ---- Wiring ------------------------------------------------------------ */

document
  .querySelectorAll('[data-action="restart"]')
  .forEach((el) => el.addEventListener("click", restart));
document
  .querySelectorAll('[data-action="exit"]')
  .forEach((el) => el.addEventListener("click", closeGame));
document
  .querySelectorAll('[data-action="resume"]')
  .forEach((el) => el.addEventListener("click", resume));

pauseButton.addEventListener("click", () => {
  if (resumeLoops) resume();
  else pause();
});

muteButton.addEventListener("click", () => {
  audio.toggleMuted();
  syncMuteButton();
});

/* Escape is the one key the shell owns. It steps back out of wherever the
   player is rather than doing one fixed thing, so it is never the key that
   throws a run away: a live game pauses, a paused game resumes, and only a
   game that is already over leaves. */
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || stage.hidden) return;
  event.preventDefault();
  if (!overlay.hidden) closeGame();
  else if (resumeLoops) resume();
  else pause();
});

/* Focus trap for the two overlays.

   Both are role="dialog"/"alertdialog", and both already move focus in and
   restore it on the way out - but nothing held Tab inside them. They sit in
   .stage-body, a sibling of the HUD, so Tab walked straight out to Mute,
   Exit, Restart and Pause sitting behind the dimmed panel: reachable, and
   invisible. A modal role promises that cannot happen.

   Kept local rather than importing modal.js's handleFocusTrap, which drags
   swipe-handler.js into the arcade bundle for one function. */
window.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;

  const dialog = !overlay.hidden ? overlay : !pausePanel.hidden ? pausePanel : null;
  if (!dialog) return;

  const focusable = Array.from(
    dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]"),
  ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  // Also catches focus sitting outside the dialog entirely - a click on the
  // dimmed backdrop leaves it on <body>, and without this Tab would resume
  // from there into the HUD.
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* A backgrounded tab throttles its animation frames to a crawl, so a run left
   for a minute used to be a run spent. Pausing on the way out means the game
   is where it was left; it deliberately does not resume by itself, because
   arriving back mid-fall is the same lost run by another route. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("blur", pause);

syncMuteButton();
syncPauseButton();
refreshBests();
refreshSummary();
// A fragment that names a game is honoured on load, so `/arcade#snake` is a
// link to that game rather than to the launcher.
route();

/**
 * Clear my scores.
 *
 * Two presses, like every other destructive control across the apps - a
 * single click that silently erased six personal bests would be the wrong
 * trade for a button that sits next to them. The sound preference shares the
 * namespace and is deliberately left alone.
 */
if (clearScoresButton) {
  let clearTimer = null;
  const restingLabel = clearScoresButton.textContent;

  clearScoresButton.addEventListener("click", () => {
    if (!clearScoresButton.classList.contains("is-confirming")) {
      clearScoresButton.classList.add("is-confirming");
      clearScoresButton.textContent = "Confirm — clear all six?";
      clearTimer = window.setTimeout(() => {
        clearScoresButton.classList.remove("is-confirming");
        clearScoresButton.textContent = restingLabel;
      }, 4000);
      return;
    }

    window.clearTimeout(clearTimer);
    clearScoresButton.classList.remove("is-confirming");
    clearScoresButton.textContent = restingLabel;

    const removed = clearAllBests();
    refreshBests();
    refreshSummary();
    announce(
      removed === 0
        ? "There were no scores to clear."
        : `Cleared ${removed} saved score${removed === 1 ? "" : "s"}.`,
    );
  });
}

/* Shared chrome: the shelf, reachable from the header of every app.

   The shortcuts sheet is launcher-only. While a game is on screen Escape
   belongs to the shell - it pauses, resumes or leaves - and the two keys the
   arcade owns are listed in the sheet as documentation rather than bound a
   second time. `suppress` is what keeps that honest. */
initAppSwitcher({ current: "arcade" });
initAppShortcuts({
  suppress: () => !stage.hidden,
  extra: [{ keys: ["Esc"], label: "Pause, resume, or leave a game" }],
});
