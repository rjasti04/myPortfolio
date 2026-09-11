/**
 * cron-parser.js
 *
 * Pure JavaScript parser, validator, natural language translator,
 * and next-run calculator for standard 5-part POSIX cron expressions:
 *   minute (0-59) | hour (0-23) | day-of-month (1-31) | month (1-12) | day-of-week (0-6)
 *
 * Zero external dependencies.
 */

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
];

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const FULL_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday"
];

const FIELD_RANGES = [
  { name: "minute", min: 0, max: 59, names: null },
  { name: "hour", min: 0, max: 23, names: null },
  { name: "dayOfMonth", min: 1, max: 31, names: null },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES },
  { name: "dayOfWeek", min: 0, max: 7, names: DAY_NAMES }, // 7 normalized to 0 (Sunday)
];

/**
 * Normalizes string tokens (e.g. JAN -> 1, MON -> 1, 7 -> 0 for Sunday).
 */
function normalizeToken(token, fieldIndex) {
  const upper = token.toUpperCase();
  const field = FIELD_RANGES[fieldIndex];

  if (field.names) {
    const idx = field.names.indexOf(upper);
    if (idx !== -1) {
      return fieldIndex === 3 ? idx + 1 : idx; // Month is 1-indexed, dayOfWeek is 0-indexed
    }
  }

  const num = parseInt(token, 10);
  if (Number.isNaN(num)) return null;

  // In cron, dayOfWeek 7 is Sunday (same as 0). Retain 7 during tokenization so range checks (e.g. 1-7) succeed, then normalize to 0 when inserting into values.
  return num;
}

/**
 * Parses a single cron field (e.g. "*", "5", "1-5", "* / 15", "1,2,5-10/2")
 * into a sorted array of matching integer values.
 */
function parseField(fieldStr, fieldIndex) {
  const { min, max, name } = FIELD_RANGES[fieldIndex];
  const trimmed = fieldStr.trim();
  if (!trimmed) {
    throw new Error(`Empty ${name} field`);
  }

  const values = new Set();
  const subTokens = trimmed.split(",");

  for (const rawToken of subTokens) {
    const token = rawToken.trim();
    if (!token) throw new Error(`Invalid empty value in ${name} field`);

    // Handle step (e.g. */15, 10-30/5, 5/10)
    let step = 1;
    let rangePart = token;

    if (token.includes("/")) {
      const parts = token.split("/");
      if (parts.length !== 2) {
        throw new Error(`Invalid step syntax '${token}' in ${name}`);
      }
      rangePart = parts[0];
      step = parseInt(parts[1], 10);
      if (Number.isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value '${parts[1]}' in ${name}`);
      }
    }

    let start = min;
    let end = fieldIndex === 4 ? 6 : max;

    if (rangePart === "*") {
      start = min;
      end = fieldIndex === 4 ? 6 : max;
    } else if (rangePart.includes("-")) {
      const rangeParts = rangePart.split("-");
      if (rangeParts.length !== 2) {
        throw new Error(`Invalid range syntax '${rangePart}' in ${name}`);
      }
      const s = normalizeToken(rangeParts[0], fieldIndex);
      const e = normalizeToken(rangeParts[1], fieldIndex);
      if (s === null || e === null) {
        throw new Error(`Invalid range endpoints '${rangePart}' in ${name}`);
      }
      if (s < min || s > max || e < min || e > max) {
        throw new Error(`Range '${rangePart}' out of bounds (${min}-${max}) in ${name}`);
      }
      if (s > e) {
        throw new Error(`Range start '${s}' is greater than end '${e}' in ${name}`);
      }
      start = s;
      end = e;
    } else {
      const val = normalizeToken(rangePart, fieldIndex);
      if (val === null || val < min || val > max) {
        throw new Error(`Value '${rangePart}' out of bounds (${min}-${max}) in ${name}`);
      }
      if (token.includes("/")) {
        start = val;
        end = fieldIndex === 4 ? 6 : max;
      } else {
        values.add(fieldIndex === 4 && val === 7 ? 0 : val);
        continue;
      }
    }

    for (let i = start; i <= end; i += step) {
      values.add(fieldIndex === 4 && i === 7 ? 0 : i);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Validates and parses a 5-part cron expression string.
 * Returns { valid: true, fields, rawParts } or { valid: false, error: string }.
 */
export function parseCron(cronExpr) {
  if (typeof cronExpr !== "string") {
    return { valid: false, error: "Cron expression must be a string." };
  }

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected exactly 5 fields (minute, hour, day, month, weekday), but found ${parts.length}.`,
    };
  }

  try {
    const minutes = parseField(parts[0], 0);
    const hours = parseField(parts[1], 1);
    const daysOfMonth = parseField(parts[2], 2);
    const months = parseField(parts[3], 3);
    const daysOfWeek = parseField(parts[4], 4);

    return {
      valid: true,
      rawParts: {
        minute: parts[0],
        hour: parts[1],
        dayOfMonth: parts[2],
        month: parts[3],
        dayOfWeek: parts[4],
      },
      fields: {
        minutes,
        hours,
        daysOfMonth,
        months,
        daysOfWeek,
      },
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Formats a two-digit number.
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Converts 24-hour hour into 12-hour format string (e.g. 9 -> "9:00 AM", 15 -> "3:00 PM").
 */
function formatTime12(h, m = 0) {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
}

/**
 * Translates a valid 5-part cron expression to clean, natural human English.
 */
export function translateCron(cronExpr) {
  const parsed = parseCron(cronExpr);
  if (!parsed.valid) {
    return { valid: false, error: parsed.error, translation: null };
  }

  const { rawParts, fields } = parsed;
  const mRaw = rawParts.minute;
  const hRaw = rawParts.hour;
  const domRaw = rawParts.dayOfMonth;
  const monRaw = rawParts.month;
  const dowRaw = rawParts.dayOfWeek;

  // Common complete presets
  if (mRaw === "*" && hRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: "Every minute" };
  }
  if (mRaw.startsWith("*/") && hRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: `Every ${mRaw.slice(2)} minutes` };
  }
  if (mRaw === "0" && hRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: "Every hour, at the start of the hour" };
  }
  if (mRaw === "0" && hRaw.startsWith("*/") && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: `Every ${hRaw.slice(2)} hours, on the hour` };
  }
  if (mRaw === "0" && hRaw === "0" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: "Every day at midnight (12:00 AM)" };
  }
  if (mRaw === "0" && hRaw === "12" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: "Every day at noon (12:00 PM)" };
  }
  if (mRaw === "0" && hRaw === "0" && domRaw === "1" && monRaw === "*" && dowRaw === "*") {
    return { valid: true, translation: "At midnight (12:00 AM), on the first day of every month" };
  }
  if (mRaw === "0" && hRaw === "0" && domRaw === "1" && monRaw === "1" && dowRaw === "*") {
    return { valid: true, translation: "At midnight (12:00 AM), on January 1st" };
  }

  // 1. Minute part
  let minuteDesc = "";
  if (mRaw === "*") {
    minuteDesc = "Every minute";
  } else if (mRaw.startsWith("*/")) {
    minuteDesc = `Every ${mRaw.slice(2)} minutes`;
  } else if (fields.minutes.length === 1) {
    // will be merged with hour
    minuteDesc = `at minute ${fields.minutes[0]}`;
  } else if (fields.minutes.length <= 5) {
    minuteDesc = `at minutes ${fields.minutes.join(", ")}`;
  } else {
    minuteDesc = `at ${fields.minutes.length} select minutes`;
  }

  // 2. Hour part
  let hourDesc = "";
  if (hRaw === "*") {
    if (mRaw === "*") {
      hourDesc = "";
    } else {
      hourDesc = "of every hour";
    }
  } else if (hRaw.startsWith("*/")) {
    hourDesc = `past every ${hRaw.slice(2)} hours`;
  } else if (fields.hours.length === 1) {
    if (fields.minutes.length === 1) {
      // Precise time: "At 09:15 AM"
      minuteDesc = `At ${formatTime12(fields.hours[0], fields.minutes[0])}`;
      hourDesc = "";
    } else {
      hourDesc = `during the ${formatTime12(fields.hours[0])} hour`;
    }
  } else if (hRaw.includes("-") && !hRaw.includes(",")) {
    const [startH, endH] = hRaw.split("-").map(Number);
    hourDesc = `between ${formatTime12(startH)} and ${formatTime12(endH)}`;
  } else {
    const formattedHours = fields.hours.map((h) => formatTime12(h));
    hourDesc = `at ${formattedHours.join(", ")}`;
  }

  // Combine time description
  let timeClause = "";
  if (minuteDesc && hourDesc) {
    timeClause = `${minuteDesc}, ${hourDesc}`;
  } else {
    timeClause = minuteDesc || hourDesc;
  }

  // 3. Day of month
  let domClause = "";
  if (domRaw !== "*") {
    if (domRaw.startsWith("*/")) {
      domClause = `every ${domRaw.slice(2)} days`;
    } else if (fields.daysOfMonth.length === 1) {
      domClause = `on day ${fields.daysOfMonth[0]}`;
    } else if (domRaw.includes("-") && !domRaw.includes(",")) {
      domClause = `between day ${fields.daysOfMonth[0]} and ${fields.daysOfMonth[fields.daysOfMonth.length - 1]}`;
    } else {
      domClause = `on days ${fields.daysOfMonth.join(", ")}`;
    }
  }

  // 4. Month
  let monthClause = "";
  if (monRaw !== "*") {
    if (monRaw.startsWith("*/")) {
      monthClause = `every ${monRaw.slice(2)} months`;
    } else if (fields.months.length === 1) {
      monthClause = `in ${FULL_MONTHS[fields.months[0] - 1]}`;
    } else if (monRaw.includes("-") && !monRaw.includes(",")) {
      const mStart = fields.months[0];
      const mEnd = fields.months[fields.months.length - 1];
      monthClause = `from ${FULL_MONTHS[mStart - 1]} through ${FULL_MONTHS[mEnd - 1]}`;
    } else {
      const monthNames = fields.months.map((m) => FULL_MONTHS[m - 1]);
      monthClause = `in ${monthNames.join(", ")}`;
    }
  }

  // 5. Day of week
  let dowClause = "";
  if (dowRaw !== "*") {
    if (dowRaw === "1-5") {
      dowClause = "Monday through Friday";
    } else if (dowRaw === "0,6" || dowRaw === "6,0" || dowRaw === "7,6" || dowRaw === "6,7") {
      dowClause = "on weekends (Saturday and Sunday)";
    } else if (fields.daysOfWeek.length === 1) {
      dowClause = `on ${FULL_DAYS[fields.daysOfWeek[0]]}`;
    } else if (dowRaw.includes("-") && !dowRaw.includes(",")) {
      const dStart = fields.daysOfWeek[0];
      const dEnd = fields.daysOfWeek[fields.daysOfWeek.length - 1];
      dowClause = `${FULL_DAYS[dStart]} through ${FULL_DAYS[dEnd]}`;
    } else {
      const dayNames = fields.daysOfWeek.map((d) => FULL_DAYS[d]);
      dowClause = `on ${dayNames.join(", ")}`;
    }
  }

  // Assemble the natural sentence
  const segments = [timeClause];

  if (domClause && dowClause) {
    // POSIX cron specifies that if both are specified, it matches either (OR)
    segments.push(`${domClause} or ${dowClause}`);
  } else if (domClause) {
    segments.push(domClause);
  } else if (dowClause) {
    segments.push(dowClause);
  }

  if (monthClause) {
    segments.push(monthClause);
  }

  let result = segments.filter(Boolean).join(", ");
  // Capitalize first character
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return {
    valid: true,
    translation: result,
  };
}

/**
 * Computes human-friendly relative time diff (e.g. "in 5 minutes", "in 2 hours").
 */
function getRelativeTimeStr(targetDate, baseDate) {
  const diffMs = targetDate.getTime() - baseDate.getTime();
  if (diffMs <= 0) return "now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `in ${diffSec}s`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `in ${diffMin} min${diffMin === 1 ? "" : "s"}`;

  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHours < 24) {
    if (remMin === 0) return `in ${diffHours} hr${diffHours === 1 ? "" : "s"}`;
    return `in ${diffHours} hr${diffHours === 1 ? "" : "s"} ${remMin}m`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remHours = diffHours % 24;
  if (diffDays < 30) {
    if (remHours === 0) return `in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
    return `in ${diffDays}d ${remHours}h`;
  }

  return `in ${diffDays} days`;
}

/**
 * Calculates the next `count` execution dates for a given cron expression.
 *
 * @param {string} cronExpr - 5-part cron expression
 * @param {number} count - number of triggers to calculate (default 10)
 * @param {Date} fromDate - baseline date to evaluate from
 * @returns {Array<{ date: Date, iso: string, localDate: string, localTime: string, relative: string }>}
 */
export function getNextRuns(cronExpr, count = 10, fromDate = new Date()) {
  const parsed = parseCron(cronExpr);
  if (!parsed.valid) {
    return [];
  }

  const { rawParts, fields } = parsed;
  const minuteSet = new Set(fields.minutes);
  const hourSet = new Set(fields.hours);
  const domSet = new Set(fields.daysOfMonth);
  const monthSet = new Set(fields.months);
  const dowSet = new Set(fields.daysOfWeek);

  const domIsWild = rawParts.dayOfMonth === "*";
  const dowIsWild = rawParts.dayOfWeek === "*";

  const runs = [];
  const curr = new Date(fromDate.getTime());

  // Step 1 minute into the future and reset seconds/ms
  curr.setSeconds(0, 0);
  curr.setMinutes(curr.getMinutes() + 1);

  // Safety bound: search up to 5 years (avoid infinite loops on impossible dates like Feb 31)
  const maxSearchMinutes = 5 * 365 * 24 * 60;
  let iterations = 0;

  while (runs.length < count && iterations < maxSearchMinutes) {
    const month = curr.getMonth() + 1; // 1-12
    if (!monthSet.has(month)) {
      // Jump to the first day of next month at 00:00
      curr.setMonth(curr.getMonth() + 1, 1);
      curr.setHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const dom = curr.getDate(); // 1-31
    const dow = curr.getDay(); // 0-6

    // In POSIX cron:
    // If both DOM and DOW are non-wildcards, match if EITHER matches (logical OR)
    // If only one is specified, match that one
    // If both are wildcards, match all
    let dayMatch = false;
    if (!domIsWild && !dowIsWild) {
      dayMatch = domSet.has(dom) || dowSet.has(dow);
    } else if (!domIsWild) {
      dayMatch = domSet.has(dom);
    } else if (!dowIsWild) {
      dayMatch = dowSet.has(dow);
    } else {
      dayMatch = true;
    }

    if (!dayMatch) {
      // Jump to next day at 00:00
      curr.setDate(curr.getDate() + 1);
      curr.setHours(0, 0, 0, 0);
      iterations += 60;
      continue;
    }

    const hour = curr.getHours(); // 0-23
    if (!hourSet.has(hour)) {
      // Jump to next hour at :00
      curr.setHours(curr.getHours() + 1, 0, 0, 0);
      iterations += 30;
      continue;
    }

    const minute = curr.getMinutes(); // 0-59
    if (minuteSet.has(minute)) {
      const runDate = new Date(curr.getTime());
      runs.push({
        date: runDate,
        iso: runDate.toISOString(),
        localDate: runDate.toLocaleDateString(undefined, {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        localTime: runDate.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        relative: getRelativeTimeStr(runDate, fromDate),
      });
    }

    curr.setMinutes(curr.getMinutes() + 1);
    iterations += 1;
  }

  return runs;
}
