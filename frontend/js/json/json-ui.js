/**
 * Workbench DOM Controller (`json-ui.js`)
 *
 * Wires the source pane and the four panels to the logic modules. Holds no
 * parsing logic of its own — everything it shows comes from `json-parser.js`,
 * `json-query.js`, `json-tree.js` and the three converters.
 *
 * The document is parsed **once** per edit, debounced, and the result is shared
 * by all four panels. That is what makes "paste once, switch tabs" work, and it
 * is the structural difference between this page and `/crypto`, where each tab
 * owns its own input.
 *
 * Nothing here builds an HTML string. Output is written with `textContent`, and
 * the JSON colouriser below appends `<span>` elements it creates itself, so a
 * document containing markup renders as characters rather than as nodes.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { parseJson, repairJson, formatJson, minifyJson, describeValue } from "./json-parser.js";
import { runQuery, formatPath } from "./json-query.js";
import { renderTree } from "./json-tree.js";
import { toYaml, fromYaml } from "./json-yaml.js";
import { toCsv, fromCsv } from "./json-csv.js";
import { toTypeScript } from "./json-typescript.js";

/** Paste and file-drop ceiling. Past this the tab stops being usable. */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/** Above this, output is shown as plain text — colouring it is not worth the pause. */
const HIGHLIGHT_LIMIT = 200 * 1024;

const DEBOUNCE_MS = 150;

/** Match paths listed as copyable chips before the list is summarised. */
const PATH_CHIP_LIMIT = 100;

const SAMPLE = `{
  "team": "Platform",
  "active": true,
  "headcount": 4,
  "members": [
    { "id": 1, "name": "Ada", "role": "staff", "price": 120 },
    { "id": 2, "name": "Alan", "role": "senior", "price": 80 },
    { "id": 3, "name": "Grace", "role": "principal", "price": 45, "onCall": true }
  ],
  "address": { "city": "London", "zip": "00123" }
}`;

const $ = (id) => document.getElementById(id);

/* -------------------------------------------------------------------------
   Small DOM helpers
   ------------------------------------------------------------------------- */

function setStatus(node, kind, message) {
  if (!node) return;
  node.className = `status-strip is-${kind}`;
  node.textContent = message;
}

/**
 * Colourise JSON by appending spans built with createElement.
 * No innerHTML, so a string containing markup stays a string.
 */
function writeJson(target, text) {
  if (!target) return;
  target.textContent = "";
  if (text === "") return;
  if (text.length > HIGHLIGHT_LIMIT) {
    target.textContent = text;
    return;
  }
  const pattern = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) target.appendChild(document.createTextNode(text.slice(last, match.index)));
    const span = document.createElement("span");
    if (match[1]) span.className = "tok-key";
    else if (match[2]) span.className = "tok-string";
    else if (match[3]) span.className = "tok-number";
    else span.className = "tok-literal";
    span.textContent = match[0];
    target.appendChild(span);
    last = match.index + match[0].length;
  }
  if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea path.
  }
  try {
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "absolute";
    scratch.style.left = "-9999px";
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand("copy");
    scratch.remove();
    return ok;
  } catch {
    return false;
  }
}

function flash(button, label = "Copied") {
  if (!button) return;
  const original = button.dataset.originalLabel ?? button.textContent;
  button.dataset.originalLabel = original;
  button.textContent = label;
  button.classList.add("copied");
  window.setTimeout(() => {
    button.textContent = button.dataset.originalLabel ?? original;
    button.classList.remove("copied");
  }, 1400);
}

function bindCopy(button, getText) {
  if (!button) return;
  button.addEventListener("click", async () => {
    const text = getText();
    if (!text) return;
    flash(button, (await copyText(text)) ? "Copied" : "Copy failed");
  });
}

function bindDownload(button, getText, getName) {
  if (!button) return;
  button.addEventListener("click", () => {
    const text = getText();
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/* -------------------------------------------------------------------------
   Workbench
   ------------------------------------------------------------------------- */

export function initWorkbench(config = {}) {
  const preferences = config.preferences ?? {};
  const onPreferenceChange = config.onPreferenceChange ?? (() => {});

  /** The single shared document. */
  const state = { raw: "", parsed: null, ok: false, error: null };

  let activeTab = "format";
  let treeController = null;
  let selectedPath = [];
  let debounceTimer = 0;

  const sourceInput = $("source-input");
  const sourceStatus = $("source-status");

  /* --- source ---------------------------------------------------------- */

  function parseNow() {
    state.raw = sourceInput ? sourceInput.value : "";
    if (state.raw.trim() === "") {
      state.ok = false;
      state.parsed = null;
      state.error = null;
      setStatus(sourceStatus, "idle", "Paste or drop a JSON document to begin.");
      refresh();
      return;
    }
    const result = parseJson(state.raw);
    state.ok = result.ok;
    state.parsed = result.value;
    state.error = result.error;
    if (result.ok) {
      const stats = describeValue(result.value);
      const bytes = new TextEncoder().encode(state.raw).length;
      setStatus(
        sourceStatus,
        "ok",
        `Valid JSON · ${stats.objects} object${stats.objects === 1 ? "" : "s"}, ${stats.arrays} array${
          stats.arrays === 1 ? "" : "s"
        }, ${stats.scalars} value${stats.scalars === 1 ? "" : "s"} · depth ${stats.depth} · ${bytes.toLocaleString()} bytes`
      );
    } else {
      setStatus(sourceStatus, "error", `Line ${result.error.line}, column ${result.error.column} — ${result.error.message}`);
    }
    refresh();
  }

  function scheduleParse() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(parseNow, DEBOUNCE_MS);
  }

  function setDocument(text) {
    if (!sourceInput) return;
    sourceInput.value = text;
    parseNow();
  }

  if (sourceInput) {
    sourceInput.addEventListener("input", () => {
      scheduleParse();
      if (preferences.remember) onPreferenceChange({ document: sourceInput.value });
    });
  }

  const sampleBtn = $("btn-sample");
  if (sampleBtn) sampleBtn.addEventListener("click", () => setDocument(SAMPLE));

  /* --- file drop ------------------------------------------------------- */

  const dropzone = $("dropzone");
  const fileInput = $("file-input");

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      setStatus(sourceStatus, "error", `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDocument(String(reader.result ?? ""));
    reader.onerror = () => setStatus(sourceStatus, "error", "That file could not be read.");
    reader.readAsText(file);
  }

  if (dropzone) {
    dropzone.addEventListener("click", () => fileInput && fileInput.click());
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (fileInput) fileInput.click();
      }
    });
    for (const type of ["dragenter", "dragover"]) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("drag-over");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove("drag-over");
      });
    }
    dropzone.addEventListener("drop", (event) => loadFile(event.dataTransfer?.files?.[0]));
  }
  if (fileInput) fileInput.addEventListener("change", () => loadFile(fileInput.files?.[0]));

  /* --- format panel ---------------------------------------------------- */

  const formatOutput = $("format-output");
  const repairLog = $("repair-log");
  const indentSelect = $("indent-select");
  const sortKeysToggle = $("sort-keys");
  let formatText = "";

  function currentIndent() {
    const value = indentSelect ? indentSelect.value : "2";
    return value === "tab" ? "tab" : Number(value);
  }

  function renderFormatPanel() {
    if (!formatOutput) return;
    if (!state.ok) {
      formatOutput.textContent = "";
      return;
    }
    formatText = formatJson(state.parsed, {
      indent: currentIndent(),
      sortKeys: Boolean(sortKeysToggle && sortKeysToggle.checked),
    });
    writeJson(formatOutput, formatText);
  }

  function showRepairs(result) {
    if (!repairLog) return;
    repairLog.textContent = "";
    if (result.repairs.length === 0) {
      repairLog.appendChild(document.createTextNode("Nothing needed repairing."));
      return;
    }
    const heading = document.createElement("p");
    heading.className = "repair-heading";
    heading.textContent = `${result.repairs.length} change${result.repairs.length === 1 ? "" : "s"} made:`;
    repairLog.appendChild(heading);
    const list = document.createElement("ul");
    list.className = "repair-list";
    for (const entry of result.repairs) {
      const item = document.createElement("li");
      if (entry.lossy) item.className = "is-lossy";
      const where = document.createElement("span");
      where.className = "repair-where";
      where.textContent = `Line ${entry.line}`;
      const what = document.createElement("span");
      what.className = "repair-what";
      what.textContent = entry.detail;
      item.appendChild(where);
      item.appendChild(what);
      list.appendChild(item);
    }
    repairLog.appendChild(list);
  }

  if (indentSelect) {
    indentSelect.addEventListener("change", () => {
      onPreferenceChange({ indent: indentSelect.value });
      renderFormatPanel();
    });
  }
  if (sortKeysToggle) {
    sortKeysToggle.addEventListener("change", () => {
      onPreferenceChange({ sortKeys: sortKeysToggle.checked });
      renderFormatPanel();
    });
  }

  const minifyBtn = $("btn-minify");
  if (minifyBtn) {
    minifyBtn.addEventListener("click", () => {
      if (!state.ok) return;
      formatText = minifyJson(state.parsed);
      writeJson(formatOutput, formatText);
    });
  }
  const beautifyBtn = $("btn-beautify");
  if (beautifyBtn) beautifyBtn.addEventListener("click", renderFormatPanel);

  const repairBtn = $("btn-repair");
  if (repairBtn) {
    repairBtn.addEventListener("click", () => {
      const result = repairJson(state.raw, { indent: currentIndent() });
      showRepairs(result);
      if (result.ok) {
        setDocument(result.text);
        setStatus(sourceStatus, "ok", `Repaired — ${result.repairs.length} change${result.repairs.length === 1 ? "" : "s"} applied.`);
      } else {
        setStatus(sourceStatus, "error", `Could not repair: ${result.error.message} (line ${result.error.line})`);
      }
    });
  }

  const applyBtn = $("btn-apply-format");
  if (applyBtn) applyBtn.addEventListener("click", () => formatText && setDocument(formatText));

  bindCopy($("btn-copy-format"), () => formatText);
  bindDownload($("btn-download-format"), () => formatText, () => "document.json");

  /* --- query panel ----------------------------------------------------- */

  const queryInput = $("query-input");
  const queryStatus = $("query-status");
  const queryOutput = $("query-output");
  const queryPaths = $("query-paths");
  const dialectSelect = $("dialect-select");
  let queryText = "";

  function currentDialect() {
    return dialectSelect ? dialectSelect.value : "jsonpath";
  }

  function renderQueryPanel() {
    if (!queryOutput) return;
    const expression = queryInput ? queryInput.value.trim() : "";
    queryOutput.textContent = "";
    if (queryPaths) queryPaths.textContent = "";
    queryText = "";

    if (!state.ok) {
      setStatus(queryStatus, "idle", state.raw.trim() === "" ? "Waiting for a document." : "Fix the document before querying.");
      return;
    }
    if (expression === "") {
      setStatus(queryStatus, "idle", "Try items[0].id, $..price, or filter(price > 50).");
      return;
    }
    const result = runQuery(expression, state.parsed);
    if (!result.ok) {
      setStatus(queryStatus, "error", `Column ${result.error.column} — ${result.error.message}`);
      return;
    }
    const values = result.matches.map((m) => m.value);
    queryText = formatJson(values, { indent: currentIndent() });
    writeJson(queryOutput, queryText);
    setStatus(
      queryStatus,
      result.matches.length > 0 ? "ok" : "warn",
      `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`
    );

    if (queryPaths) {
      for (const match of result.matches.slice(0, PATH_CHIP_LIMIT)) {
        const path = formatPath(match.path, currentDialect());
        const item = document.createElement("button");
        item.type = "button";
        item.className = "path-chip";
        item.textContent = path;
        item.dataset.path = path;
        item.addEventListener("click", async () => {
          flash(item, (await copyText(item.dataset.path ?? "")) ? "Copied" : "Copy failed");
        });
        queryPaths.appendChild(item);
      }
      if (result.matches.length > PATH_CHIP_LIMIT) {
        const note = document.createElement("span");
        note.className = "path-more";
        note.textContent = `+${result.matches.length - PATH_CHIP_LIMIT} more`;
        queryPaths.appendChild(note);
      }
    }
  }

  if (queryInput) {
    queryInput.addEventListener("input", () => {
      window.clearTimeout(queryInput.dataset.timer);
      queryInput.dataset.timer = String(window.setTimeout(renderQueryPanel, DEBOUNCE_MS));
    });
  }
  if (dialectSelect) {
    dialectSelect.addEventListener("change", () => {
      onPreferenceChange({ dialect: dialectSelect.value });
      renderQueryPanel();
      renderBreadcrumb();
    });
  }
  for (const [id, expression] of [
    ["ex-dot", "members[0].name"],
    ["ex-descend", "$..price"],
    ["ex-filter", "members.filter(price > 50)"],
  ]) {
    const button = $(id);
    if (!button) continue;
    button.addEventListener("click", () => {
      if (!queryInput) return;
      queryInput.value = expression;
      renderQueryPanel();
      queryInput.focus();
    });
  }

  bindCopy($("btn-copy-query"), () => queryText);
  bindDownload($("btn-download-query"), () => queryText, () => "query-result.json");

  /* --- tree panel ------------------------------------------------------ */

  const treeContainer = $("tree-container");
  const treeCode = $("tree-code");
  const breadcrumb = $("breadcrumb");
  const treeStatus = $("tree-status");

  function renderBreadcrumb() {
    if (!breadcrumb) return;
    breadcrumb.textContent = formatPath(selectedPath, currentDialect());
  }

  function renderTreePanel() {
    if (!treeContainer) return;
    treeContainer.textContent = "";
    if (treeCode) treeCode.textContent = "";
    treeController = null;
    if (!state.ok) {
      setStatus(treeStatus, "idle", state.raw.trim() === "" ? "Waiting for a document." : "Fix the document to explore it.");
      return;
    }
    selectedPath = [];
    renderBreadcrumb();
    treeController = renderTree(treeContainer, state.parsed, {
      onSelect: ({ path }) => {
        selectedPath = path;
        renderBreadcrumb();
      },
    });
    writeJson(treeCode, formatJson(state.parsed, { indent: currentIndent() }));
    setStatus(treeStatus, "ok", "Click a node to copy its path.");
  }

  const expandBtn = $("btn-expand-all");
  if (expandBtn) {
    expandBtn.addEventListener("click", () => {
      if (!treeController) return;
      const refusal = treeController.expandAll();
      if (refusal) setStatus(treeStatus, "warn", refusal);
    });
  }
  const collapseBtn = $("btn-collapse-all");
  if (collapseBtn) collapseBtn.addEventListener("click", () => treeController && treeController.collapseAll());

  bindCopy($("btn-copy-path"), () => formatPath(selectedPath, currentDialect()));

  /* --- convert panel --------------------------------------------------- */

  const convertFormat = $("convert-format");
  const convertOutput = $("convert-output");
  const convertSource = $("convert-source");
  const convertStatus = $("convert-status");
  const convertNote = $("convert-note");
  const csvDelimiter = $("csv-delimiter");
  const csvInfer = $("csv-infer");
  const tsRoot = $("ts-root");
  let convertText = "";
  let direction = "from-json";

  const NOTES = {
    yaml: "Block style, 2-space indent. Strings that YAML would re-read as a boolean, null or number are quoted — so \"no\" stays the string \"no\". Anchors, merge keys, tags and multi-document streams are not supported.",
    csv: "Nested objects flatten to dotted columns; the header is the union of every row's keys. CSV cannot tell null from an empty string — both are an empty cell.",
    typescript: "Optional members come from keys missing in some array elements. Identical shapes share one interface. One-way: TypeScript is generated, not parsed.",
  };

  function syncConvertControls() {
    const format = convertFormat ? convertFormat.value : "yaml";
    const reverse = direction === "to-json";
    const oneWay = format === "typescript";

    for (const [id, visible] of [
      ["csv-options", format === "csv"],
      ["ts-options", format === "typescript"],
      ["convert-source-wrap", reverse && !oneWay],
      ["btn-use-as-document", reverse && !oneWay],
    ]) {
      const node = $(id);
      if (node) node.hidden = !visible;
    }
    const toggle = $("convert-direction");
    if (toggle) toggle.hidden = oneWay;
    if (oneWay) direction = "from-json";
    if (convertNote) convertNote.textContent = NOTES[format] ?? "";

    const label = $("convert-output-label");
    if (label) {
      label.textContent = reverse && !oneWay ? "JSON" : { yaml: "YAML", csv: "CSV", typescript: "TypeScript" }[format];
    }
  }

  function renderConvertPanel() {
    if (!convertOutput) return;
    syncConvertControls();
    const format = convertFormat ? convertFormat.value : "yaml";
    convertOutput.textContent = "";
    convertText = "";

    if (direction === "to-json") {
      const raw = convertSource ? convertSource.value : "";
      if (raw.trim() === "") {
        setStatus(convertStatus, "idle", `Paste ${format === "csv" ? "CSV" : "YAML"} to convert it to JSON.`);
        return;
      }
      const result =
        format === "csv"
          ? fromCsv(raw, {
              delimiter: csvDelimiter ? csvDelimiter.value : ",",
              inferTypes: !csvInfer || csvInfer.checked,
            })
          : fromYaml(raw);
      if (!result.ok) {
        setStatus(convertStatus, "error", result.error.message ?? String(result.error));
        return;
      }
      convertText = formatJson(result.value, { indent: currentIndent() });
      writeJson(convertOutput, convertText);
      setStatus(convertStatus, "ok", "Converted to JSON.");
      return;
    }

    if (!state.ok) {
      setStatus(convertStatus, "idle", state.raw.trim() === "" ? "Waiting for a document." : "Fix the document to convert it.");
      return;
    }
    if (format === "yaml") {
      convertText = toYaml(state.parsed);
      convertOutput.textContent = convertText;
      setStatus(convertStatus, "ok", "Converted to YAML.");
      return;
    }
    if (format === "csv") {
      const result = toCsv(state.parsed, { delimiter: csvDelimiter ? csvDelimiter.value : "," });
      if (!result.ok) {
        setStatus(convertStatus, "error", result.error);
        return;
      }
      convertText = result.text;
      convertOutput.textContent = convertText;
      setStatus(
        convertStatus,
        "ok",
        `${result.rows} row${result.rows === 1 ? "" : "s"}, ${result.columns.length} columns` +
          (result.sourceKey ? ` — tabulated from "${result.sourceKey}".` : ".")
      );
      return;
    }
    convertText = toTypeScript(state.parsed, tsRoot && tsRoot.value.trim() ? tsRoot.value.trim() : "Root");
    convertOutput.textContent = convertText;
    setStatus(convertStatus, "ok", "Interfaces generated.");
  }

  if (convertFormat) {
    convertFormat.addEventListener("change", () => {
      onPreferenceChange({ convertFormat: convertFormat.value });
      renderConvertPanel();
    });
  }
  for (const button of document.querySelectorAll("[data-direction]")) {
    button.addEventListener("click", () => {
      direction = button.dataset.direction;
      for (const sibling of document.querySelectorAll("[data-direction]")) {
        sibling.classList.toggle("active", sibling === button);
        sibling.setAttribute("aria-pressed", String(sibling === button));
      }
      renderConvertPanel();
    });
  }
  for (const node of [convertSource, csvDelimiter, csvInfer, tsRoot]) {
    if (!node) continue;
    node.addEventListener(node.tagName === "TEXTAREA" || node.type === "text" ? "input" : "change", () => {
      window.clearTimeout(node.dataset.timer);
      node.dataset.timer = String(window.setTimeout(renderConvertPanel, DEBOUNCE_MS));
    });
  }
  const useAsDocument = $("btn-use-as-document");
  if (useAsDocument) {
    useAsDocument.addEventListener("click", () => {
      if (!convertText) return;
      setDocument(convertText);
      setActiveTab("format");
    });
  }

  bindCopy($("btn-copy-convert"), () => convertText);
  bindDownload($("btn-download-convert"), () => convertText, () => {
    const format = convertFormat ? convertFormat.value : "yaml";
    if (direction === "to-json") return "converted.json";
    return { yaml: "document.yaml", csv: "document.csv", typescript: "types.ts" }[format] ?? "document.txt";
  });

  /* --- tabs, refresh, clear -------------------------------------------- */

  function refresh() {
    if (activeTab === "format") renderFormatPanel();
    else if (activeTab === "query") renderQueryPanel();
    else if (activeTab === "tree") renderTreePanel();
    else renderConvertPanel();
  }

  function setActiveTab(tab) {
    activeTab = tab;
    if (typeof config.onTabChange === "function") config.onTabChange(tab);
    refresh();
  }

  function clearAll() {
    if (sourceInput) sourceInput.value = "";
    if (queryInput) queryInput.value = "";
    if (convertSource) convertSource.value = "";
    if (repairLog) repairLog.textContent = "";
    selectedPath = [];
    formatText = "";
    queryText = "";
    convertText = "";
    parseNow();
  }

  // Restore persisted preferences into the controls before the first render.
  if (indentSelect && preferences.indent) indentSelect.value = preferences.indent;
  if (sortKeysToggle && typeof preferences.sortKeys === "boolean") sortKeysToggle.checked = preferences.sortKeys;
  if (dialectSelect && preferences.dialect) dialectSelect.value = preferences.dialect;
  if (convertFormat && preferences.convertFormat) convertFormat.value = preferences.convertFormat;
  if (sourceInput && preferences.remember && preferences.document) sourceInput.value = preferences.document;

  parseNow();

  return { setActiveTab, clearAll, setDocument, getDocument: () => state.raw };
}
