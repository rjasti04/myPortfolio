/**
 * CSV Converter (`json-csv.js`)
 *
 * `toCsv(value)` and `fromCsv(text)`, to RFC 4180.
 *
 * Two decisions worth knowing about, because both are places a careless
 * converter loses someone's data:
 *
 * **The header is the union of every row's keys**, in first-seen order — not
 * the first row's keys. A ragged array whose third object gained a field would
 * otherwise silently shift every later column by one.
 *
 * **Type inference is opt-in and refuses to guess.** A value becomes a number
 * only if `String(Number(v)) === v`, which leaves `00123`, `+15551234567` and
 * `1e999` as the strings they were. The usual "helpful" coercion is how a CSV
 * round-trip turns a zip code into 1234 and a phone number into Infinity.
 *
 * CSV genuinely cannot distinguish `null` from `""` — both are an empty cell.
 * `toCsv` writes null as empty; `fromCsv` reads empty as `null` when inference
 * is on and as `""` when it is off. That asymmetry is inherent to the format,
 * and it is surfaced in the panel rather than hidden here.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvError";
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Flatten nested objects to dotted paths (`address.city`). Arrays of scalars
 * join with `arrayJoin`; arrays of objects have no sane flat representation and
 * are refused by name rather than stringified into an unreadable cell.
 */
function flattenRow(source, prefix, out, arrayJoin) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenRow(value, path, out, arrayJoin);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && typeof item === "object")) {
        throw new CsvError(
          `Column "${path}" holds an array of objects, which has no flat CSV form. Query it into a flat array first.`
        );
      }
      out[path] = value.map((item) => (item === null ? "" : String(item))).join(arrayJoin);
      continue;
    }
    out[path] = value;
  }
}

function cellToText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function quoteCell(text, delimiter) {
  if (text === "") return "";
  const mustQuote = text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
  if (!mustQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serialise an array of objects as CSV.
 *
 * @returns {{ ok: boolean, text: string, error: string|null, columns: string[], rows: number }}
 */
export function toCsv(value, options = {}) {
  const { delimiter = ",", newline = "\n", arrayJoin = "; " } = options;
  try {
    let records;
    let sourceKey = null;
    if (Array.isArray(value)) {
      records = value;
    } else if (isPlainObject(value)) {
      // `{ "data": [ ... ] }` is the shape most API responses arrive in, and the
      // envelope is not the table. When exactly one property holds an array of
      // objects there is no ambiguity about which one was meant — so use it, and
      // report which key it came from rather than doing it silently. Two such
      // properties is ambiguous, and falls through to the one-row path.
      const candidates = Object.keys(value).filter(
        (key) => Array.isArray(value[key]) && value[key].length > 0 && value[key].every(isPlainObject)
      );
      if (candidates.length === 1) {
        sourceKey = candidates[0];
        records = value[sourceKey];
      } else {
        records = [value];
      }
    } else {
      throw new CsvError("CSV needs an array of objects, or a single object for a one-row table.");
    }

    if (records.length === 0) return { ok: true, text: "", error: null, columns: [], rows: 0, sourceKey };

    // Scalar arrays become a single-column table rather than an error.
    if (records.every((row) => !isPlainObject(row))) {
      const header = quoteCell("value", delimiter);
      const body = records.map((row) => quoteCell(cellToText(row), delimiter));
      return { ok: true, text: [header, ...body].join(newline) + newline, error: null, columns: ["value"], rows: records.length, sourceKey };
    }

    const flat = [];
    const columns = [];
    const seen = new Set();
    for (const row of records) {
      if (!isPlainObject(row)) throw new CsvError("Every element must be an object to become a CSV row.");
      const out = {};
      flattenRow(row, "", out, arrayJoin);
      flat.push(out);
      for (const key of Object.keys(out)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }

    const lines = [columns.map((c) => quoteCell(c, delimiter)).join(delimiter)];
    for (const row of flat) {
      lines.push(
        columns
          .map((column) =>
            quoteCell(cellToText(Object.prototype.hasOwnProperty.call(row, column) ? row[column] : ""), delimiter)
          )
          .join(delimiter)
      );
    }
    return { ok: true, text: lines.join(newline) + newline, error: null, columns, rows: flat.length, sourceKey };
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    return { ok: false, text: "", error: error.message, columns: [], rows: 0, sourceKey: null };
  }
}

/** Split CSV text into rows of raw string cells, honouring quotes. */
function splitRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  let cellWasQuoted = false;

  const endCell = () => {
    row.push(cellWasQuoted ? { text: cell, quoted: true } : { text: cell, quoted: false });
    cell = "";
    cellWasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
      cellWasQuoted = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      endCell();
      i += 1;
      continue;
    }
    if (c === "\r" && text[i + 1] === "\n") {
      endRow();
      i += 2;
      continue;
    }
    if (c === "\n" || c === "\r") {
      endRow();
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (quoted) throw new CsvError("Unterminated quoted field — a closing '\"' is missing.");
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Convert a text cell to a JSON value.
 * A quoted cell is always kept as a string: the author quoted it on purpose.
 */
function inferCell(entry) {
  const { text, quoted } = entry;
  if (quoted) return text;
  if (text === "") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  // Only exact round-trips become numbers, so 00123 and +1555... stay strings.
  const asNumber = Number(text);
  if (text.trim() !== "" && Number.isFinite(asNumber) && String(asNumber) === text) return asNumber;
  return text;
}

/** Expand dotted column names back into nested objects. */
function unflatten(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Parse CSV into an array of objects.
 *
 * @returns {{ ok: boolean, value: Array|null, error: string|null }}
 */
export function fromCsv(text, options = {}) {
  const { delimiter = ",", inferTypes = true, expandDots = true } = options;
  try {
    if (typeof text !== "string" || text.trim() === "") throw new CsvError("Input is empty");
    const rows = splitRows(text, delimiter);
    if (rows.length === 0) throw new CsvError("Input is empty");

    const header = rows[0].map((entry) => entry.text.trim());
    if (header.length === 0 || header.every((h) => h === "")) throw new CsvError("The first row must be a header.");

    const out = [];
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      // A single empty cell is a blank trailing line, not a record.
      if (row.length === 1 && row[0].text === "" && !row[0].quoted) continue;
      const record = {};
      for (let c = 0; c < header.length; c += 1) {
        const name = header[c] || `column${c + 1}`;
        const entry = row[c] ?? { text: "", quoted: false };
        const value = inferTypes ? inferCell(entry) : entry.text;
        if (expandDots && name.includes(".")) unflatten(record, name, value);
        else record[name] = value;
      }
      out.push(record);
    }
    return { ok: true, value: out, error: null };
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    return { ok: false, value: null, error: error.message };
  }
}
