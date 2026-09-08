import { trackEvent } from "../analytics.js";
import { prefersReducedMotion } from "../config.js";
import { navigateToSection } from "../navigation.js";
import { toggleTheme } from "../theme.js";
import { createRegistry } from "./registry.js";
import { createHistory } from "./history.js";
import { Intent, intentFor, completeInput } from "./keymap.js";
import { initPalette } from "./palette.js";
import * as out from "./output.js";

// Cap the rendered log. Output used to grow unbounded for the session, leaving
// hundreds of nodes under a backdrop-filter ancestor.
const MAX_BLOCKS = 200;
const MATRIX_KEY = "rj_terminal_matrix";
const COMPACT_QUERY = "(max-width: 768px)";

const PLACEHOLDER_SAMPLES = ["help", "whoami", "skills", "fortune"];
const BASE_PLACEHOLDER = "Type 'help' to see commands...";

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function initTerminal() {
  const input = document.getElementById("terminal-input");
  const output = document.getElementById("terminal-output");
  const body = document.getElementById("terminal-body");
  const panel = document.querySelector(".terminal-panel");
  if (!input || !output || !body || !panel) return;

  const registry = createRegistry();
  const history = createHistory();

  // ── Context: the only place commands can reach the outside world ──────────
  const ctx = {
    registry,
    history,

    sections: () =>
      Array.from(document.querySelectorAll("main section[id]")).map((section) => section.id),


    stats: () =>
      Array.from(document.querySelectorAll("#about .stat-card")).map((card) => ({
        value: card.querySelector(".stat-number")?.textContent?.trim() ?? "",
        label: card.querySelector(".stat-label")?.textContent?.trim() ?? "",
      })),

    async navigate(target) {
      navigateToSection(target);
      await nextFrame();
    },


    async ask(question) {
      await ctx.navigate("ai");
      await nextFrame();
      // Drive the assistant through its own form so chat.js stays the single
      // owner of request handling — no reaching into its internals.
      const field = document.getElementById("ai-page-input");
      const form = document.getElementById("ai-page-form");
      if (!field || !form) return false;
      field.value = question;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    },

    download(href, filename) {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },

    toggleTheme,

    toggleMatrix() {
      const on = panel.classList.toggle("matrix-mode");
      try {
        sessionStorage.setItem(MATRIX_KEY, on ? "1" : "0");
      } catch {
        // Session storage unavailable — mode still applies for this view.
      }
      return on;
    },

    clear() {
      output.replaceChildren();
    },
  };

  try {
    if (sessionStorage.getItem(MATRIX_KEY) === "1") panel.classList.add("matrix-mode");
  } catch {
    // Ignore — matrix mode simply starts off.
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function appendBlock(...nodes) {
    const block = document.createElement("div");
    block.className = "terminal-block";
    for (const node of nodes) {
      if (node) block.appendChild(node);
    }
    if (!block.childNodes.length) return;
    output.appendChild(block);
    while (output.childElementCount > MAX_BLOCKS) {
      output.firstElementChild.remove();
    }
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }

  // ── Execution ─────────────────────────────────────────────────────────────
  async function run(rawInput) {
    const value = rawInput.trim();
    if (!value) return;

    history.push(value);

    const [word, ...args] = value.split(/\s+/);
    const name = word.toLowerCase();
    const command = registry.get(name);

    // Log resolution only. The previous version shipped raw argument text into
    // user_activity_events, which turned `echo` into an open text-collection
    // endpoint.
    trackEvent("terminal_command", {
      command: command ? name : "__unknown__",
      argc: args.length,
      ok: Boolean(command),
    });

    const echo = out.echoLine(value);
    if (!command) {
      appendBlock(echo, out.err(`bash: ${name}: command not found. Type 'help' for available commands.`));
      return;
    }

    try {
      const result = await command.run(ctx, args);
      appendBlock(echo, result instanceof Node ? result : null);
    } catch (error) {
      console.warn(`terminal: ${name} failed`, error);
      appendBlock(echo, out.err(`${name}: command failed.`));
    }
  }

  // ── Starter chips ─────────────────────────────────────────────────────────
  const chipRow = document.getElementById("terminal-chips");
  if (chipRow) {
    chipRow.replaceChildren();
    for (const command of registry.chips()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "terminal-chip";
      button.textContent = command.chipLabel ?? command.name;
      button.addEventListener("click", () => {
        stopPlaceholderAnimation();
        input.value = "";
        run(command.chipInput ?? command.name);
      });
      chipRow.appendChild(button);
    }
  }

  // ── Input handling ────────────────────────────────────────────────────────
  input.addEventListener("keydown", (event) => {
    if (typeof window.triggerWebGlSurge === "function") window.triggerWebGlSurge();

    const selection = window.getSelection();
    const hasSelection = Boolean(selection && !selection.isCollapsed);
    const intent = intentFor(event);

    switch (intent) {
      case Intent.SUBMIT: {
        event.preventDefault();
        const value = input.value;
        input.value = "";
        run(value);
        break;
      }
      case Intent.HIST_PREV:
        event.preventDefault();
        input.value = history.prev() ?? input.value;
        break;
      case Intent.HIST_NEXT:
        event.preventDefault();
        input.value = history.next();
        break;
      case Intent.COMPLETE: {
        // An empty prompt has nothing to complete, so Tab keeps its normal
        // meaning and moves focus on. Together with Shift+Tab (declined in
        // keymap.js) this is the escape route WCAG 2.1.2 requires.
        if (!input.value.trim()) break;
        event.preventDefault();
        const typed = input.value;
        const { value, matches } = completeInput(typed, registry, ctx);
        input.value = value;
        if (matches.length > 1) {
          appendBlock(out.echoLine(typed.trim()), out.text(matches.join("  ")));
        }
        break;
      }
      case Intent.BLUR:
        event.preventDefault();
        input.blur();
        break;
      case Intent.CLEAR:
        event.preventDefault();
        ctx.clear();
        break;
      case Intent.ABORT:
        // Leave Ctrl+C alone when there is a selection to copy.
        if (hasSelection) break;
        event.preventDefault();
        appendBlock(out.echoLine(`${input.value}^C`));
        input.value = "";
        history.resetCursor();
        break;
      default:
        break;
    }
  });

  // Clicking the panel focuses the prompt — but never while the user is
  // selecting output to copy, which the old unconditional focus() broke.
  body.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    input.focus();
  });

  // ── Collapse / expand (small viewports) ───────────────────────────────────
  const toggle = document.getElementById("terminal-toggle");
  const compact = window.matchMedia(COMPACT_QUERY);

  function setCollapsed(collapsed) {
    panel.classList.toggle("is-collapsed", collapsed);
    toggle?.setAttribute("aria-expanded", String(!collapsed));
  }

  if (toggle) {
    setCollapsed(compact.matches);
    compact.addEventListener("change", (event) => setCollapsed(event.matches));
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.contains("is-collapsed");
      setCollapsed(!collapsed);
      if (collapsed) input.focus();
    });
  }

  // ── Animated placeholder (kept: it is the main discoverability cue) ────────
  let placeholderTimer = null;
  let placeholderStopped = false;

  function stopPlaceholderAnimation() {
    if (placeholderStopped) return;
    placeholderStopped = true;
    if (placeholderTimer !== null) clearTimeout(placeholderTimer);
    placeholderTimer = null;
    input.setAttribute("placeholder", BASE_PLACEHOLDER);
  }

  function runPlaceholderAnimation() {
    if (prefersReducedMotion.matches) return;
    let sampleIdx = 0;
    let charIdx = 0;
    let phase = "typing";

    const tick = () => {
      if (placeholderStopped) return;
      const sample = PLACEHOLDER_SAMPLES[sampleIdx];
      let delay = 110;

      if (phase === "typing") {
        charIdx++;
        input.setAttribute("placeholder", `${sample.slice(0, charIdx)}▎`);
        if (charIdx >= sample.length) {
          phase = "holding";
          delay = 1200;
        }
      } else if (phase === "holding") {
        input.setAttribute("placeholder", sample);
        phase = "erasing";
        delay = 500;
      } else if (phase === "erasing") {
        charIdx--;
        input.setAttribute("placeholder", `${sample.slice(0, charIdx)}▎`);
        if (charIdx <= 0) {
          phase = "pausing";
          delay = 400;
        } else {
          delay = 55;
        }
      } else {
        sampleIdx = (sampleIdx + 1) % PLACEHOLDER_SAMPLES.length;
        charIdx = 0;
        phase = "typing";
        delay = 250;
      }

      placeholderTimer = setTimeout(tick, delay);
    };

    placeholderTimer = setTimeout(tick, 600);
  }

  input.addEventListener("focus", stopPlaceholderAnimation, { once: true });
  input.addEventListener("input", stopPlaceholderAnimation, { once: true });
  runPlaceholderAnimation();

  // ── Ctrl+K palette over the same registry ─────────────────────────────────
  initPalette({ registry, run, panel });
}
