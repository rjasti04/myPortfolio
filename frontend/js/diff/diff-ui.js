/**
 * Diff Workbench UI (`diff-ui.js`)
 *
 * Wires the two panes, the options, the patch reader and the result bar to the
 * engine. One long initialiser in the manner of the sibling apps — ADR-001's
 * accepted cost, and the shape the rest of this shelf is written in.
 *
 * **Nothing a visitor pastes is persisted by default.** People compare
 * production configs and proprietary source here, and a tool that quietly kept
 * the last pair in `localStorage` would be a liability on a shared machine.
 * `rj-diff:preferences` holds the view mode and the toggles; the pane contents
 * join it only while "Remember my panes" is on, and switching that off deletes
 * what was already stored rather than merely stopping future writes.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { diffLines } from "./diff-engine.js";
import { refineChanges } from "./diff-refine.js";
import { writePatch, parsePatch, patchToView } from "./diff-patch.js";
import { renderDiff } from "./diff-render.js";

/** Matches /crypto and /json — larger inputs are refused, never truncated. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Below this width a side-by-side diff stops being readable. */
const SPLIT_MIN_WIDTH = 640;

const DEBOUNCE_MS = 180;

const STORAGE_KEY = "rj-diff:preferences";
const LEFT_KEY = "rj-diff:left";
const RIGHT_KEY = "rj-diff:right";

const OPTION_IDS = {
  ignoreWhitespace: "opt-ignore-whitespace",
  trimTrailing: "opt-trim-trailing",
  ignoreCase: "opt-ignore-case",
  ignoreBlankLines: "opt-ignore-blank",
};

function readStore(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota, private mode or storage disabled — persistence is a convenience.
  }
}

function dropStore(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do; the value was never readable either.
  }
}

export function readPreferences() {
  try {
    const raw = readStore(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePreferences(patch) {
  writeStore(STORAGE_KEY, JSON.stringify({ ...readPreferences(), ...patch }));
}

/** "12 lines · 340 bytes", or "empty". */
export function describeText(text) {
  if (text === "") return "empty";
  const lines = text.split("\n").length;
  const bytes = new TextEncoder().encode(text).length;
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
  return `${lines.toLocaleString()} line${lines === 1 ? "" : "s"} · ${size}`;
}

/**
 * The cold-start demo.
 *
 * `/json` opens with Load sample and `/cron` and `/crypto` both ship preset
 * chips; this page opened with two empty boxes, so anyone evaluating it had to
 * supply their own material before it did anything at all. The snippet is real
 * code from this repo - the roving-tabindex fix that these same apps' tablists
 * run on - which makes the demo a work sample rather than filler about foxes.
 */
const SAMPLE_LEFT = `function switchTab(tabId) {
  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isTarget);
  });

  panels.forEach((panel, name) => {
    panel.hidden = name !== tabId;
  });
}
`;

const SAMPLE_RIGHT = `function switchTab(tabId, shouldScroll = false) {
  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-selected", String(isTarget));
    // Roving tabindex: one Tab stop for the set, arrows move within it.
    btn.tabIndex = isTarget ? 0 : -1;
  });

  panels.forEach((panel, name) => {
    panel.hidden = name !== tabId;
  });

  if (shouldScroll) scrollToActivePanel(tabId);
}
`;

export function initWorkbench() {
  const shell = document.querySelector(".diff-shell");
  const inputLeft = document.getElementById("input-left");
  const inputRight = document.getElementById("input-right");
  const inputPatch = document.getElementById("input-patch");
  const diffView = document.getElementById("diff-view");
  const patchView = document.getElementById("patch-view");
  const statsEl = document.getElementById("diff-stats");
  const algoEl = document.getElementById("diff-algo");
  const patchStats = document.getElementById("patch-stats");
  const patchError = document.getElementById("patch-error");
  const rememberToggle = document.getElementById("opt-remember");
  const wrapToggle = document.getElementById("opt-wrap");
  const contextSelect = document.getElementById("opt-context");

  if (!shell || !inputLeft || !inputRight) return;

  const state = {
    view: "split",
    result: null,
    patchResult: null,
    expanded: new Set(),
    patchExpanded: new Set(),
    rows: [],
    patchRows: [],
    cursor: -1,
    patchCursor: -1,
    timer: 0,
  };

  const options = () => ({
    ignoreWhitespace: document.getElementById(OPTION_IDS.ignoreWhitespace).checked,
    trimTrailing: document.getElementById(OPTION_IDS.trimTrailing).checked,
    ignoreCase: document.getElementById(OPTION_IDS.ignoreCase).checked,
    ignoreBlankLines: document.getElementById(OPTION_IDS.ignoreBlankLines).checked,
    context: contextSelect.value === "-1" ? Number.MAX_SAFE_INTEGER : Number(contextSelect.value),
  });

  const effectiveView = () =>
    window.innerWidth < SPLIT_MIN_WIDTH ? "unified" : state.view;

  // --- Statistics -----------------------------------------------------------

  function paintStats(target, result) {
    target.textContent = "";
    if (!result) {
      target.textContent = "Paste something into both panes to see a difference.";
      return;
    }
    if (result.identical) {
      target.textContent = "The two sides are identical.";
      return;
    }
    const { additions, deletions, modifications } = result.stats;
    const add = document.createElement("span");
    add.className = "stat-add";
    add.textContent = `+${additions} added`;
    const del = document.createElement("span");
    del.className = "stat-del";
    del.textContent = `−${deletions} removed`;
    const mod = document.createElement("span");
    mod.className = "stat-mod";
    mod.textContent = `~${modifications} modified`;
    target.append(add, document.createTextNode(" · "), del, document.createTextNode(" · "), mod);
  }

  // --- Compare tab ----------------------------------------------------------

  function draw() {
    const view = effectiveView();
    shell.dataset.view = view;

    const rendered = renderDiff(diffView, state.result, {
      view,
      expanded: state.expanded,
      emptyMessage: state.result
        ? "The two sides are identical."
        : "Paste or drop a file into each pane.",
      onExpand: (index) => {
        state.expanded.add(index);
        draw();
      },
    });
    state.rows = rendered.rows;
    state.cursor = -1;
    updateNavigation();
  }

  function updateNavigation() {
    const has = state.rows.length > 0;
    document.getElementById("btn-prev-change").disabled = !has;
    document.getElementById("btn-next-change").disabled = !has;
    const exportable = Boolean(state.result) && !state.result.identical;
    document.getElementById("btn-copy-patch").disabled = !exportable;
    document.getElementById("btn-download-patch").disabled = !exportable;
  }

  function recompute() {
    const left = inputLeft.value;
    const right = inputRight.value;

    document.getElementById("meta-left").textContent = describeText(left);
    document.getElementById("meta-right").textContent = describeText(right);

    if (left === "" && right === "") {
      state.result = null;
      state.expanded.clear();
      paintStats(statsEl, null);
      algoEl.hidden = true;
      draw();
      return;
    }

    const result = diffLines(left, right, options());
    refineChanges(result.changes);
    state.result = result;
    state.expanded.clear();

    paintStats(statsEl, result);
    if (result.algorithm === "histogram") {
      algoEl.hidden = false;
      algoEl.textContent =
        "Large edit — switched to a histogram diff. The result is good, but not guaranteed minimal.";
    } else {
      algoEl.hidden = true;
    }

    draw();

    if (rememberToggle.checked) {
      writeStore(LEFT_KEY, left);
      writeStore(RIGHT_KEY, right);
    }
  }

  function scheduleRecompute() {
    clearTimeout(state.timer);
    state.timer = setTimeout(recompute, DEBOUNCE_MS);
  }

  // --- Patch tab ------------------------------------------------------------

  function drawPatch() {
    const view = effectiveView();
    const rendered = renderDiff(patchView, state.patchResult, {
      view,
      expanded: state.patchExpanded,
      emptyMessage: "Paste a unified patch to render it.",
    });
    state.patchRows = rendered.rows;
    state.patchCursor = -1;
    const has = state.patchRows.length > 0;
    document.getElementById("btn-patch-prev").disabled = !has;
    document.getElementById("btn-patch-next").disabled = !has;
  }

  function recomputePatch() {
    const text = inputPatch.value;
    document.getElementById("meta-patch").textContent = describeText(text);

    if (text.trim() === "") {
      state.patchResult = null;
      patchError.hidden = true;
      patchStats.textContent = "Paste a patch to render it.";
      drawPatch();
      return;
    }

    const parsed = parsePatch(text);
    if (!parsed.ok) {
      state.patchResult = null;
      patchError.hidden = false;
      patchError.textContent = `Line ${parsed.error.line}, column ${parsed.error.column}: ${parsed.error.message}\n\n${parsed.error.excerpt}`;
      patchStats.textContent = "Could not read this patch.";
      drawPatch();
      return;
    }

    patchError.hidden = true;
    const view = patchToView(parsed);
    refineChanges(view.changes);
    state.patchResult = view;

    const files = parsed.files.filter((file) => file.hunks.length > 0).length;
    paintStats(patchStats, view);
    if (files > 1) {
      patchStats.append(
        document.createTextNode(` · showing the first of ${files} files`)
      );
    }
    drawPatch();
  }

  // --- Navigation -----------------------------------------------------------

  function step(rowsKey, cursorKey, delta) {
    const rows = state[rowsKey];
    if (rows.length === 0) return;
    const next = (state[cursorKey] + delta + rows.length) % rows.length;
    state[cursorKey] = next;
    for (const row of rows) row.classList.remove("is-current");
    const row = rows[next];
    row.classList.add("is-current");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // --- File input -----------------------------------------------------------

  async function loadFile(file, target) {
    if (file.size > MAX_FILE_BYTES) {
      target.value = "";
      window.alert(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB, so it has not been loaded.`
      );
      return;
    }
    target.value = await file.text();
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wireDropTarget(area, card) {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    area.addEventListener("dragover", (event) => {
      stop(event);
      card?.classList.add("is-dragover");
    });
    area.addEventListener("dragleave", (event) => {
      stop(event);
      card?.classList.remove("is-dragover");
    });
    area.addEventListener("drop", (event) => {
      stop(event);
      card?.classList.remove("is-dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFile(file, area);
    });
  }

  function wirePane(area, pickButtonId, fileInputId, clearButtonId, onChange) {
    const card = area.closest(".card");
    wireDropTarget(area, card);

    const fileInput = document.getElementById(fileInputId);
    document.getElementById(pickButtonId).addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) loadFile(file, area);
      fileInput.value = "";
    });

    document.getElementById(clearButtonId).addEventListener("click", () => {
      area.value = "";
      onChange();
      area.focus();
    });

    area.addEventListener("input", onChange);
  }

  // --- Clipboard ------------------------------------------------------------

  /**
   * Copy `text` and acknowledge it on `button`.
   *
   * The label swap matters as much as the class: `.copied` only recolours the
   * border and text, so colour was the sole signal (SC 1.4.1) and a screen
   * reader got no confirmation at all. Swapping the label announces the change
   * and is what json, crypto, cron and regex already do.
   *
   * innerHTML is saved and restored so the button's icon survives the swap -
   * the same trap json-ui.js's flash() used to fall into. The saved value is
   * the button's own markup, never user input.
   */
  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const originalMarkup = button.dataset.originalMarkup ?? button.innerHTML;
      button.dataset.originalMarkup = originalMarkup;
      button.classList.add("copied");
      button.textContent = "Copied!";
      setTimeout(() => {
        button.classList.remove("copied");
        button.innerHTML = button.dataset.originalMarkup ?? originalMarkup;
      }, 1200);
    } catch {
      // Clipboard denied or unavailable; the download button is the fallback.
    }
  }

  function currentPatch() {
    if (!state.result || state.result.identical) return "";
    return writePatch(state.result);
  }

  // --- Wiring ---------------------------------------------------------------

  wirePane(inputLeft, "btn-file-left", "file-left", "btn-clear-left", scheduleRecompute);
  wirePane(inputRight, "btn-file-right", "file-right", "btn-clear-right", scheduleRecompute);

  // Swap — the most common control on a diff tool, and the page had none.
  // Pasting the two sides the wrong way round otherwise means selecting,
  // cutting and re-pasting both.
  document.getElementById("btn-swap")?.addEventListener("click", () => {
    const held = inputLeft.value;
    inputLeft.value = inputRight.value;
    inputRight.value = held;
    recompute();
  });

  document.getElementById("btn-sample")?.addEventListener("click", () => {
    inputLeft.value = SAMPLE_LEFT;
    inputRight.value = SAMPLE_RIGHT;
    recompute();
  });
  if (inputPatch) {
    wirePane(inputPatch, "btn-file-patch", "file-patch", "btn-clear-patch", recomputePatch);
  }

  for (const id of Object.values(OPTION_IDS)) {
    document.getElementById(id).addEventListener("change", () => {
      writePreferences({ [id]: document.getElementById(id).checked });
      recompute();
    });
  }

  contextSelect.addEventListener("change", () => {
    writePreferences({ context: contextSelect.value });
    recompute();
  });

  wrapToggle.addEventListener("change", () => {
    shell.dataset.wrap = wrapToggle.checked ? "on" : "off";
    writePreferences({ wrap: wrapToggle.checked });
  });

  for (const button of document.querySelectorAll(".seg-btn[data-view]")) {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      for (const other of document.querySelectorAll(".seg-btn[data-view]")) {
        other.classList.toggle("active", other === button);
      }
      writePreferences({ view: state.view });
      draw();
      drawPatch();
    });
  }

  rememberToggle.addEventListener("change", () => {
    writePreferences({ remember: rememberToggle.checked });
    if (rememberToggle.checked) {
      writeStore(LEFT_KEY, inputLeft.value);
      writeStore(RIGHT_KEY, inputRight.value);
    } else {
      // Switching this off deletes what was kept, rather than merely stopping
      // future writes — otherwise "off" would still leave the last pair behind.
      dropStore(LEFT_KEY);
      dropStore(RIGHT_KEY);
    }
  });

  document
    .getElementById("btn-prev-change")
    .addEventListener("click", () => step("rows", "cursor", -1));
  document
    .getElementById("btn-next-change")
    .addEventListener("click", () => step("rows", "cursor", 1));
  document
    .getElementById("btn-patch-prev")
    .addEventListener("click", () => step("patchRows", "patchCursor", -1));
  document
    .getElementById("btn-patch-next")
    .addEventListener("click", () => step("patchRows", "patchCursor", 1));

  const copyButton = document.getElementById("btn-copy-patch");
  copyButton.addEventListener("click", () => copyText(currentPatch(), copyButton));

  document.getElementById("btn-download-patch").addEventListener("click", () => {
    const patch = currentPatch();
    if (patch === "") return;
    const blob = new Blob([patch], { type: "text/x-patch" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "changes.patch";
    anchor.click();
    URL.revokeObjectURL(url);
  });

  /**
   * Step to the next or previous change on whichever tab is open.
   *
   * This used to be a document-level keydown handler right here, with its own
   * copy of the "not while you are typing" guard. It is exported instead so
   * app-shortcuts.js can bind it through the same table it builds the `?`
   * sheet from - which is what makes /diff's shortcuts discoverable rather
   * than folklore.
   */
  function stepChange(delta) {
    const onPatch = shell.dataset.tab === "patch";
    step(onPatch ? "patchRows" : "rows", onPatch ? "patchCursor" : "cursor", delta);
  }

  window.addEventListener("resize", () => {
    const view = effectiveView();
    if (shell.dataset.view !== view) {
      draw();
      drawPatch();
    }
  });

  const clearAllBtn = document.getElementById("btn-clear-all");
  let clearTimer = null;
  clearAllBtn?.addEventListener("click", () => {
    if (!clearAllBtn.classList.contains("is-confirming")) {
      clearAllBtn.classList.add("is-confirming");
      const originalText = clearAllBtn.innerHTML;
      clearAllBtn.dataset.originalText = originalText;
      clearAllBtn.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Confirm Clear?';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearAllBtn.classList.remove("is-confirming");
        clearAllBtn.innerHTML = originalText;
      }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearAllBtn.classList.remove("is-confirming");
    if (clearAllBtn.dataset.originalText) {
      clearAllBtn.innerHTML = clearAllBtn.dataset.originalText;
    }
    inputLeft.value = "";
    inputRight.value = "";
    if (inputPatch) inputPatch.value = "";
    rememberToggle.checked = false;
    dropStore(LEFT_KEY);
    dropStore(RIGHT_KEY);
    dropStore(STORAGE_KEY);
    recompute();
    recomputePatch();
    clearAllBtn.classList.add("cleared");
    setTimeout(() => clearAllBtn.classList.remove("cleared"), 900);
  });

  // --- Restore --------------------------------------------------------------

  const preferences = readPreferences();
  for (const [key, id] of Object.entries(OPTION_IDS)) {
    if (typeof preferences[id] === "boolean") document.getElementById(id).checked = preferences[id];
    else if (typeof preferences[key] === "boolean") document.getElementById(id).checked = preferences[key];
  }
  if (typeof preferences.wrap === "boolean") wrapToggle.checked = preferences.wrap;
  if (preferences.context !== undefined) contextSelect.value = String(preferences.context);
  if (preferences.view === "unified" || preferences.view === "split") state.view = preferences.view;
  for (const button of document.querySelectorAll(".seg-btn[data-view]")) {
    button.classList.toggle("active", button.dataset.view === state.view);
  }
  shell.dataset.wrap = wrapToggle.checked ? "on" : "off";

  if (preferences.remember === true) {
    rememberToggle.checked = true;
    inputLeft.value = readStore(LEFT_KEY, "") ?? "";
    inputRight.value = readStore(RIGHT_KEY, "") ?? "";
  } else {
    // Defensive: a preferences blob that lost its flag must not leave content
    // sitting in storage.
    dropStore(LEFT_KEY);
    dropStore(RIGHT_KEY);
  }

  recompute();
  recomputePatch();

  return { stepChange };
}
