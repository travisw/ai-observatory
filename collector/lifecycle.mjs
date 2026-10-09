/**
 * Readers for the places providers announce retirements.
 *
 * Each parser takes the page text and returns lifecycle rows. They are strict on purpose: a
 * known table that stops matching throws, so a page redesign shows up as a failed job and not
 * as a calendar that quietly emptied.
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Apr 1, 2027", "October 23, 2026", "2025-04-30" or "April 4th, 2026" to "YYYY-MM-DD"; "" when no date is in the text. */
export function parseDate(raw) {
  // Docs pages sometimes use non-breaking hyphens and spaces in dates.
  const text = String(raw ?? "").replace(/[‐‑‒–]/g, "-").replace(/ /g, " ");
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return iso[0];
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(text);
  if (!named) return "";
  const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
  if (!month) return "";
  return `${named[3]}-${String(month).padStart(2, "0")}-${String(named[2]).padStart(2, "0")}`;
}

/** Splits a markdown table row on unescaped pipes. */
function cells(line) {
  const out = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  // A row starts and ends with a pipe, so the first and last cells are empty.
  return out.slice(1, -1);
}

const isRow = (line) => line.trimStart().startsWith("|");
const isDivider = (line) => /^\|?\s*:?-{2,}/.test(line.trim());

/**
 * Every table in the text, with the `### YYYY-MM-DD:` heading it sits under.
 * Returns [{ heading, headingDate, header: string[], rows: string[][] }].
 */
export function markdownTables(text) {
  const lines = text.split("\n");
  const tables = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{2,4}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    if (!isRow(line) || !isRow(lines[i + 1] ?? "") || !isDivider(lines[i + 1])) continue;
    const header = cells(line);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && isRow(lines[j]); j++) rows.push(cells(lines[j]));
    tables.push({ heading, headingDate: parseDate(heading.slice(0, 10)), header, rows });
    i = j - 1;
  }
  return tables;
}

const firstId = (cell) => {
  const m = /`([^`]+)`/.exec(cell ?? "");
  return m ? m[1].trim() : "";
};

const today = () => new Date().toISOString().slice(0, 10);

/** One row per model id; the first mention wins, and pages list the newest announcement first. */
export function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.provider}|${r.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const stateFor = (retiresAt) => (retiresAt && retiresAt < today() ? "retired" : "deprecated");
const column = (header, pattern) => header.findIndex((h) => pattern.test(h));

/** OpenAI: every "Shutdown date | <model column> | ... | replacement" table on the deprecations page. */
export function parseOpenAI(text, sourceUrl) {
  const rows = [];
  for (const table of markdownTables(text)) {
    const dateCol = column(table.header, /^shutdown date$/i);
    const modelCol = column(table.header, /model|system/i);
    const replCol = column(table.header, /replacement|substitute/i);
    if (dateCol === -1 || modelCol === -1) continue;
    for (const r of table.rows) {
      const modelId = firstId(r[modelCol]);
      // Endpoint rows ("/v1/answers") and prose rows are not models.
      if (!modelId || modelId.startsWith("/")) continue;
      const retiresAt = parseDate(r[dateCol] ?? "");
      rows.push({
        provider: "openai",
        modelId,
        state: stateFor(retiresAt),
        deprecatedAt: table.headingDate,
        retiresAt,
        retiresNote: "",
        replacement: replCol === -1 ? "" : firstId(r[replCol]),
        sourceUrl,
      });
    }
  }
  if (rows.length === 0) throw new Error("openai deprecations: no shutdown tables found");
  return dedupe(rows);
}

/** Anthropic: the model status table, enriched with replacements from the history tables. */
export function parseAnthropic(text, sourceUrl) {
  const tables = markdownTables(text);
  const status = tables.find((t) => /api model name/i.test(t.header[0] ?? "") && /current state/i.test(t.header[1] ?? ""));
  if (!status) throw new Error("anthropic deprecations: model status table not found");
  const stateCol = 1;
  const deprecatedCol = column(status.header, /^deprecated$/i);
  const retireCol = column(status.header, /retirement/i);

  const replacements = new Map();
  for (const t of tables) {
    const modelCol = column(t.header, /deprecated model/i);
    const replCol = column(t.header, /replacement/i);
    if (modelCol === -1 || replCol === -1) continue;
    for (const r of t.rows) {
      const id = firstId(r[modelCol]);
      if (id) replacements.set(id, firstId(r[replCol]));
    }
  }

  const rows = status.rows.map((r) => {
    const modelId = (r[0] ?? "").replace(/`/g, "").trim();
    const retireText = r[retireCol] ?? "";
    const retiresAt = parseDate(retireText);
    const retiresNote = /not sooner than/i.test(retireText)
      ? "not sooner than"
      : retiresAt
        ? "tentative"
        : /announced/i.test(retireText)
          ? "to be announced"
          : "";
    return {
      provider: "anthropic",
      modelId,
      state: (r[stateCol] ?? "").trim().toLowerCase(),
      deprecatedAt: parseDate(r[deprecatedCol] ?? ""),
      retiresAt,
      retiresNote,
      replacement: replacements.get(modelId) ?? "",
      sourceUrl,
    };
  }).filter((r) => r.modelId && ["active", "deprecated", "retired"].includes(r.state));
  if (rows.length === 0) throw new Error("anthropic deprecations: status table has no usable rows");
  return dedupe(rows);
}

/**
 * Cohere: a few tables, but most retirements are bullet lists under a dated heading whose
 * intro says the models "will be retired". Both forms are read.
 */
export function parseCohere(text, sourceUrl) {
  const rows = [];
  for (const table of markdownTables(text)) {
    const dateCol = column(table.header, /shutdown date/i);
    const modelCol = column(table.header, /deprecated model/i);
    const replCol = column(table.header, /replacement/i);
    if (dateCol === -1 || modelCol === -1) continue;
    for (const r of table.rows) {
      const modelId = firstId(r[modelCol]);
      if (!modelId) continue;
      const retiresAt = parseDate(r[dateCol] ?? "");
      rows.push({ provider: "cohere", modelId, state: stateFor(retiresAt), deprecatedAt: table.headingDate, retiresAt, retiresNote: "", replacement: replCol === -1 ? "" : firstId(r[replCol]), sourceUrl });
    }
  }

  // Dated sections: "### 2026-04-04: ..." then "Effective April 4th, 2026, the following models will be retired:" and bullets.
  const sections = text.split(/^(?=### )/m);
  for (const section of sections) {
    const head = /^### (\d{4}-\d{2}-\d{2})/.exec(section);
    if (!head) continue;
    const intro = /effective ([^,]+,? ?\d{4})[^\n]*?(retired|deprecat)/i.exec(section);
    const listStart = /(will be retired:|Deprecated Models:)\s*\n/i.exec(section);
    if (!intro || !listStart) continue;
    const retiresAt = parseDate(intro[1]);
    const after = section.slice(listStart.index + listStart[0].length);
    for (const line of after.split("\n")) {
      if (!line.startsWith("*")) break;
      const modelId = firstId(line);
      if (!modelId || modelId.startsWith("/")) continue;
      rows.push({ provider: "cohere", modelId, state: stateFor(retiresAt), deprecatedAt: head[1], retiresAt, retiresNote: "", replacement: "", sourceUrl });
    }
  }
  if (rows.length === 0) throw new Error("cohere deprecations: nothing recognisable on the page");
  return dedupe(rows);
}
