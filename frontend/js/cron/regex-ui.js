/**
 * regex-ui.js
 *
 * DOM controller for the Regex Visualizer view.
 * Handles live pattern compilation, flag toggles, syntax color breakdown,
 * mirrored highlight overlay on sample text, and detailed match inspector.
 *
 * Zero external dependencies.
 */

import { tokenizeRegex, evaluateRegex, normalizeFlags } from "./regex-parser.js";

const PRESETS = [
  {
    label: "Email Address",
    pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    flags: "g",
    text: "Contact team at hello@example.com or support@company.org for assistance.",
  },
  {
    label: "URL / Link",
    pattern: "https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b[-a-zA-Z0-9()@:%_\\+.~#?&//=]*",
    flags: "g",
    text: "Visit https://rjasti.com or read the docs at https://github.com/rjasti04/rjWebApp today!",
  },
  {
    label: "IPv4 Address",
    pattern: "\\b(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}\\b",
    flags: "g",
    text: "Router gateway: 192.168.1.1, DNS servers: 8.8.8.8 and 1.1.1.1, invalid: 999.300.1.1.",
  },
  {
    label: "ISO Date",
    pattern: "(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])",
    flags: "g",
    text: "Created on 2026-09-10 and scheduled release for 2026-12-31.",
  },
  {
    label: "UUID v4",
    pattern: "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
    flags: "gi",
    text: "Session tokens: 4372d911-1d3d-44a6-9d4d-f6ad46953012 and 12345678-1234-4234-8234-123456789abc.",
  },
];

export function initRegexUI({ container, onStateChange, initialPattern = "", initialFlags = "g", initialText = "" }) {
  let pattern = initialPattern || PRESETS[0].pattern;
  let flags = normalizeFlags(initialFlags || PRESETS[0].flags);
  let sampleText = initialText || PRESETS[0].text;

  // DOM Elements
  const patternInput = container.querySelector("#regex-pattern");
  const flagsContainer = container.querySelector("#regex-flags");
  const errorEl = container.querySelector("#regex-error");
  const syntaxTokensEl = container.querySelector("#regex-tokens");
  const testTextarea = container.querySelector("#regex-textarea");
  const highlightOverlay = container.querySelector("#regex-highlight-overlay");
  const matchesSummaryEl = container.querySelector("#regex-matches-summary");
  const matchesListEl = container.querySelector("#regex-matches-list");
  const presetsContainer = container.querySelector("#regex-presets");
  const copyBtn = container.querySelector("#regex-copy-btn");

  let debounceTimer = null;

  // Setup presets
  renderPresets();

  function renderPresets() {
    if (!presetsContainer) return;
    presetsContainer.textContent = "";
    for (const p of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-btn";
      btn.textContent = p.label;
      btn.addEventListener("click", () => {
        pattern = p.pattern;
        flags = p.flags;
        sampleText = p.text;
        if (patternInput) patternInput.value = pattern;
        if (testTextarea) testTextarea.value = sampleText;
        updateFlagButtons();
        update();
      });
      presetsContainer.appendChild(btn);
    }
  }

  // Setup flag buttons
  const flagButtons = flagsContainer ? flagsContainer.querySelectorAll("[data-flag]") : [];
  flagButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.getAttribute("data-flag");
      if (flags.includes(f)) {
        flags = flags.replace(f, "");
      } else {
        flags = normalizeFlags(flags + f);
      }
      updateFlagButtons();
      update();
    });
  });

  function updateFlagButtons() {
    flagButtons.forEach((btn) => {
      const f = btn.getAttribute("data-flag");
      const isActive = flags.includes(f);
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  function renderSyntaxTokens(tokens) {
    if (!syntaxTokensEl) return;
    syntaxTokensEl.textContent = "";

    if (!tokens || tokens.length === 0) {
      const emptySpan = document.createElement("span");
      emptySpan.className = "text-muted";
      emptySpan.textContent = "Empty pattern";
      syntaxTokensEl.appendChild(emptySpan);
      return;
    }

    tokens.forEach((tok) => {
      const span = document.createElement("span");
      span.className = `syntax-token ${tok.type}`;
      span.textContent = tok.text;
      span.title = tok.description;
      syntaxTokensEl.appendChild(span);
    });
  }

  function renderHighlightOverlay(text, matches) {
    if (!highlightOverlay) return;
    highlightOverlay.textContent = "";

    if (!text) return;
    if (!matches || matches.length === 0) {
      highlightOverlay.appendChild(document.createTextNode(text));
      return;
    }

    let lastIdx = 0;
    const fragment = document.createDocumentFragment();

    matches.forEach((m, i) => {
      const start = m.index;
      const end = m.endIndex;

      // Ensure valid boundaries
      if (start < lastIdx || end > text.length) return;

      // Text before match
      if (start > lastIdx) {
        fragment.appendChild(document.createTextNode(text.slice(lastIdx, start)));
      }

      // Matched text
      const mark = document.createElement("mark");
      mark.className = `regex-match match-alt-${i % 2}`;
      mark.textContent = text.slice(start, end);
      mark.setAttribute("data-match-idx", String(i + 1));
      fragment.appendChild(mark);

      lastIdx = end;
    });

    // Trailing text
    if (lastIdx < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
    }

    highlightOverlay.appendChild(fragment);
  }

  /**
   * Empty / starter state for the matches rail. The panel used to open on a
   * blank card with no indication of what to do, which reads as broken rather
   * than idle.
   */
  function renderMatchesEmptyState(iconClass, message) {
    const li = document.createElement("li");
    li.className = "empty-state";

    const icon = document.createElement("i");
    icon.className = iconClass;
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.className = "empty-state-text";
    text.textContent = message;

    li.append(icon, text);
    matchesListEl.appendChild(li);
  }

  function renderMatchesList(res) {
    if (!matchesSummaryEl || !matchesListEl) return;
    matchesListEl.textContent = "";

    if (!res.valid) {
      matchesSummaryEl.textContent = "Invalid pattern";
      matchesSummaryEl.className = "matches-summary text-error";
      renderMatchesEmptyState(
        "fas fa-triangle-exclamation",
        "The pattern above could not be compiled. See the error for details."
      );
      return;
    }

    matchesSummaryEl.className = "matches-summary";

    if (!patternInput?.value) {
      matchesSummaryEl.textContent = "";
      renderMatchesEmptyState(
        "fas fa-wand-magic-sparkles",
        "Write a pattern above, or pick a preset, to see matches and capture groups here."
      );
      return;
    }

    const countText = res.matchCount === 1 ? "1 match" : `${res.matchCount} matches`;
    matchesSummaryEl.textContent = `${countText} \u00b7 ${res.executionTimeMs}ms`;

    if (res.matchCount === 0) {
      renderMatchesEmptyState(
        "fas fa-magnifying-glass",
        testTextarea?.value
          ? "No matches in the sample text. Try loosening the pattern or toggling a flag."
          : "Paste some sample text on the left to test this pattern against it."
      );
      return;
    }

    res.matches.forEach((m, idx) => {
      const li = document.createElement("li");
      li.className = "match-card";

      const header = document.createElement("div");
      header.className = "match-header";

      const badge = document.createElement("span");
      badge.className = "match-badge badge";
      badge.textContent = `Match #${idx + 1}`;

      const indexRange = document.createElement("span");
      indexRange.className = "match-indices font-mono";
      indexRange.textContent = `[${m.index}–${m.endIndex}] (${m.match.length} chars)`;

      header.appendChild(badge);
      header.appendChild(indexRange);

      const valPre = document.createElement("pre");
      valPre.className = "match-value font-mono";
      valPre.textContent = m.match;

      li.appendChild(header);
      li.appendChild(valPre);

      // Captured groups
      if (m.groups && m.groups.length > 0) {
        const groupsContainer = document.createElement("div");
        groupsContainer.className = "match-groups";

        const groupsTitle = document.createElement("div");
        groupsTitle.className = "match-groups-title";
        groupsTitle.textContent = "Capture Groups:";
        groupsContainer.appendChild(groupsTitle);

        const groupsTable = document.createElement("table");
        groupsTable.className = "groups-table";
        const tbody = document.createElement("tbody");

        m.groups.forEach((g) => {
          const row = document.createElement("tr");

          const nameTd = document.createElement("td");
          nameTd.className = "group-name font-mono";
          nameTd.textContent = g.name ? `$${g.name}` : `$${g.index}`;

          const valTd = document.createElement("td");
          valTd.className = "group-val font-mono";
          valTd.textContent = g.defined ? g.value : "<undefined>";
          if (!g.defined) valTd.classList.add("text-muted");

          row.appendChild(nameTd);
          row.appendChild(valTd);
          tbody.appendChild(row);
        });

        groupsTable.appendChild(tbody);
        groupsContainer.appendChild(groupsTable);
        li.appendChild(groupsContainer);
      }

      matchesListEl.appendChild(li);
    });
  }

  function update() {
    pattern = patternInput ? patternInput.value : "";
    sampleText = testTextarea ? testTextarea.value : "";

    // Syntax tokens breakdown
    const tokens = tokenizeRegex(pattern);
    renderSyntaxTokens(tokens);

    // Evaluate
    const res = evaluateRegex(pattern, flags, sampleText);

    if (!res.valid) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = res.error;
      }
      renderHighlightOverlay(sampleText, []);
      renderMatchesList(res);
      return;
    }

    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    renderHighlightOverlay(sampleText, res.matches);
    renderMatchesList(res);

    if (typeof onStateChange === "function") {
      onStateChange({ pattern, flags, text: sampleText });
    }
  }

  function debouncedUpdate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(update, 60);
  }

  // Scroll and size synchronization between textarea and backdrop
  if (testTextarea && highlightOverlay) {
    testTextarea.addEventListener("scroll", () => {
      highlightOverlay.scrollTop = testTextarea.scrollTop;
      highlightOverlay.scrollLeft = testTextarea.scrollLeft;
    });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        highlightOverlay.style.height = `${testTextarea.clientHeight}px`;
      });
      ro.observe(testTextarea);
    }
  }

  // Bind inputs
  if (patternInput) {
    patternInput.value = pattern;
    patternInput.addEventListener("input", debouncedUpdate);
  }
  if (testTextarea) {
    testTextarea.value = sampleText;
    testTextarea.addEventListener("input", debouncedUpdate);
  }

  // Copy button
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const fullRegex = `/${pattern}/${flags}`;
      try {
        await navigator.clipboard.writeText(fullRegex);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = fullRegex;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      const orig = copyBtn.innerHTML;
      copyBtn.classList.add("copied");
      copyBtn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> <span>Copied!</span>';
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = orig;
      }, 1500);
    });
  }

  // Initial state setup
  updateFlagButtons();
  update();

  return {
    setState: ({ newPattern, newFlags, newText }) => {
      if (typeof newPattern === "string") pattern = newPattern;
      if (typeof newFlags === "string") flags = normalizeFlags(newFlags);
      if (typeof newText === "string") sampleText = newText;
      if (patternInput) patternInput.value = pattern;
      if (testTextarea) testTextarea.value = sampleText;
      updateFlagButtons();
      update();
    },
    getState: () => ({ pattern, flags, text: sampleText }),
  };
}
