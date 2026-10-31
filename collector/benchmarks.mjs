/**
 * Published benchmark results, copied from two public leaderboards once a day.
 *
 * Epoch AI publishes every score it has run or collected as one zip of CSVs (CC BY 4.0).
 * LMArena publishes its leaderboard as a Hugging Face dataset (CC BY 4.0), readable row by
 * row through the datasets server. Nothing is run here; a row is a score, the model name the
 * source used, the organisation it credits, when it was measured, and a link back. The
 * capsule decides which catalogue model each row belongs to.
 */

import { CHUNK, getJson, withBackoff } from "./http.mjs";

const EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip";
const EPOCH_PAGE = "https://epoch.ai/benchmarks";

/** The CSVs read from Epoch's zip. The score column and scale come from their `benchmark_metadata.csv`. */
const EPOCH_FILES = [
  { file: "gpqa_diamond.csv", slug: "gpqa-diamond", name: "GPQA Diamond", column: "Best score (across scorers)", scale: 1, page: `${EPOCH_PAGE}/gpqa-diamond` },
  { file: "swe_bench_verified.csv", slug: "swe-bench-verified", name: "SWE-bench Verified", column: "Best score (across scorers)", scale: 1, page: `${EPOCH_PAGE}/swe-bench-verified` },
  { file: "frontiermath_tiers_1_3_v2.csv", slug: "frontiermath-tiers-1-3", name: "FrontierMath, tiers 1 to 3", column: "Best score (across scorers)", scale: 1, page: `${EPOCH_PAGE}/frontiermath-tiers-1-3` },
  { file: "otis_mock_aime_2024_2025.csv", slug: "otis-mock-aime", name: "OTIS Mock AIME 2024–2025", column: "Best score (across scorers)", scale: 1, page: `${EPOCH_PAGE}/otis-mock-aime-2024-2025` },
  { file: "simpleqa_verified.csv", slug: "simpleqa-verified", name: "SimpleQA Verified", column: "Best score (across scorers)", scale: 1, page: `${EPOCH_PAGE}/simpleqa-verified` },
  { file: "arc_agi_2_external.csv", slug: "arc-agi-2", name: "ARC-AGI-2", column: "Score", scale: 1, page: `${EPOCH_PAGE}/arc-agi-2` },
  { file: "hle_external.csv", slug: "hle", name: "Humanity's Last Exam", column: "Accuracy", scale: 1, page: `${EPOCH_PAGE}/hle` },
];
const EPOCH_INDEX = { file: "epoch_capabilities_index/eci_scores.csv", slug: "eci", name: "Epoch Capabilities Index", page: `${EPOCH_PAGE}/eci` };
const EPOCH_MODELS = "model_metadata.csv";

/**
 * The dataset's `latest` split lists the overall ranking first, then each category. The rows
 * endpoint is cached and quick; the filter endpoint that would select the category is not.
 */
const ARENA_ROWS = "https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text_style_control&split=latest";
const ARENA_PAGE = "https://lmarena.ai/leaderboard/text";
const ARENA_PAGES_MAX = 12;

/**
 * Reads a zip from memory: the central directory at the end names every entry and where its
 * bytes start. Every entry Epoch ships is deflated, which the runtime inflates natively.
 */
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("zip: no central directory");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, { method, start: dataStart, length: compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    async text(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`zip: no entry ${name}`);
      const data = bytes.subarray(entry.start, entry.start + entry.length);
      if (entry.method === 0) return decoder.decode(data);
      if (entry.method !== 8) throw new Error(`zip: ${name} uses compression method ${entry.method}`);
      const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(inflated).text();
    },
  };
}

/** RFC 4180 CSV to objects keyed by the header row. Quoted cells may hold commas, quotes and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "2026-10-09T14:38:01.000Z" or "2026-10-09" to "2026-10-09"; anything else to "". */
function day(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

/** A score on the benchmark's own scale to a percentage with one decimal. */
function percent(value, scale) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return (n * scale * 100).toFixed(1);
}

/** The first of several possible columns that holds a date. */
function firstDate(row, columns) {
  for (const column of columns) {
    const d = day(row[column]);
    if (d) return d;
  }
  return "";
}

/**
 * One benchmark's rows. A model version can appear more than once in the collected files
 * (several runs or task sets); the best score is the one leaderboards show, so it is kept.
 */
function epochRows(spec, rows, orgOf) {
  const best = new Map();
  for (const row of rows) {
    const sourceModel = String(row["Model version"] ?? "").trim();
    const score = percent(row[spec.column], spec.scale);
    if (!sourceModel || score === "") continue;
    const prior = best.get(sourceModel);
    if (prior && Number(prior.score) >= Number(score)) continue;
    const stderr = Number(row.stderr ?? row["Accuracy Standard Error"]);
    const link = String(row["Log viewer"] || row["Source link"] || "");
    best.set(sourceModel, {
      slug: spec.slug,
      benchmark: spec.name,
      sourceModel,
      organization: String(row.Organization || orgOf.get(sourceModel) || ""),
      score,
      unit: "pct",
      rank: "",
      detail: Number.isFinite(stderr) && stderr > 0 ? `±${(stderr * 100).toFixed(1)}` : "",
      date: firstDate(row, ["Started at", "Run date", "Date of evaluation", "Created", "Release date"]),
      url: link.startsWith("http") ? link : spec.page,
    });
  }
  return [...best.values()];
}

/** Epoch's own capability index: one number per model, named by display name rather than id. */
function epochIndexRows(rows) {
  const out = [];
  for (const row of rows) {
    const sourceModel = String(row.Model ?? "").trim();
    const score = Number(row.eci);
    if (!sourceModel || !Number.isFinite(score)) continue;
    const low = Number(row.eci_ci_low);
    const high = Number(row.eci_ci_high);
    out.push({
      slug: EPOCH_INDEX.slug,
      benchmark: EPOCH_INDEX.name,
      sourceModel,
      organization: String(row.Organization ?? ""),
      score: score.toFixed(1),
      unit: "index",
      rank: "",
      detail: Number.isFinite(low) && Number.isFinite(high) ? `${low.toFixed(0)}–${high.toFixed(0)} likely` : "",
      date: day(row.date),
      url: EPOCH_INDEX.page,
    });
  }
  return out;
}

async function ingestRows(c, source, rows, runAt) {
  let added = 0;
  let changed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await c.mutate("ingestBenchmarks", source, runAt, rows.slice(i, i + CHUNK));
    added += result.added ?? 0;
    changed += result.changed ?? 0;
  }
  const closed = await c.mutate("finalizeBenchmarks", source, runAt, rows.length);
  return { added, changed, removed: closed.removed ?? 0 };
}

async function collectEpoch(c) {
  const res = await withBackoff(async () => {
    const r = await fetch(EPOCH_ZIP, { headers: { "user-agent": "ai-observatory collector (+https://ai-observatory.view.fast)" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) {
      const err = new Error(`${EPOCH_ZIP} -> ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return r.arrayBuffer();
  }, { deadline: c.deadline });
  const zip = await unzip(res);

  // Many rows leave the organisation blank; Epoch's model list fills it in.
  const orgOf = new Map();
  if (zip.names.includes(EPOCH_MODELS)) {
    for (const row of parseCsv(await zip.text(EPOCH_MODELS))) {
      if (row.model_version && row.organization) orgOf.set(row.model_version, row.organization);
    }
  }

  const rows = [];
  for (const spec of EPOCH_FILES) {
    if (!zip.names.includes(spec.file)) {
      c.log(`benchmarks: epoch zip has no ${spec.file}`);
      continue;
    }
    rows.push(...epochRows(spec, parseCsv(await zip.text(spec.file)), orgOf));
  }
  if (zip.names.includes(EPOCH_INDEX.file)) rows.push(...epochIndexRows(parseCsv(await zip.text(EPOCH_INDEX.file))));
  else c.log(`benchmarks: epoch zip has no ${EPOCH_INDEX.file}`);
  if (rows.length === 0) throw new Error("epoch zip had no usable rows");

  const result = await ingestRows(c, "epoch", rows, new Date().toISOString());
  c.log(`benchmarks epoch: ${rows.length} rows, +${result.added} ~${result.changed} -${result.removed}`);
}

async function collectArena(c) {
  const rows = [];
  let done = false;
  for (let page = 0; page < ARENA_PAGES_MAX && !done; page++) {
    const body = await withBackoff(() => getJson(`${ARENA_ROWS}&offset=${page * 100}&length=100`), { deadline: c.deadline });
    const list = Array.isArray(body?.rows) ? body.rows : [];
    if (list.length === 0) break;
    for (const { row } of list) {
      // The overall ranking ends where the first category begins.
      if (row?.category !== "overall") {
        done = true;
        break;
      }
      const sourceModel = String(row?.model_name ?? "").trim();
      const rating = Number(row?.rating);
      if (!sourceModel || !Number.isFinite(rating)) continue;
      const votes = Number(row.vote_count);
      const low = Number(row.rating_lower);
      const high = Number(row.rating_upper);
      rows.push({
        slug: "arena-text",
        benchmark: "LMArena text",
        sourceModel,
        organization: String(row.organization ?? ""),
        score: rating.toFixed(0),
        unit: "elo",
        rank: String(row.rank ?? ""),
        detail: [Number.isFinite(votes) ? `${Math.round(votes).toLocaleString("en-US")} votes` : "", Number.isFinite(low) && Number.isFinite(high) ? `${low.toFixed(0)}–${high.toFixed(0)} likely` : ""].filter(Boolean).join(" · "),
        date: day(row.leaderboard_publish_date),
        url: ARENA_PAGE,
      });
    }
  }
  if (rows.length === 0) throw new Error("lmarena returned no overall rows");
  const result = await ingestRows(c, "lmarena", rows, new Date().toISOString());
  c.log(`benchmarks lmarena: ${rows.length} rows, +${result.added} ~${result.changed} -${result.removed}`);
}

/** Both leaderboards. One failing is logged and the other still lands; the run fails afterwards. */
export async function collectBenchmarks(c) {
  let failed = 0;
  for (const [name, job] of [["epoch", collectEpoch], ["lmarena", collectArena]]) {
    try {
      await job(c);
    } catch (error) {
      c.log(`benchmarks ${name}: FAILED ${error.message}`);
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} benchmark source(s) failed`);
}

export { EPOCH_FILES, epochRows };
