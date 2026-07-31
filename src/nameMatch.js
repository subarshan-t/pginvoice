// Shared client-name matching, used by both Client Invoicing (matching ClickUp folder
// names to the accrued sheet) and Capacity Planning (matching ClickUp folder names to
// its own client list) — kept in one place so the two never quietly drift apart.
export function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
// Generic connector/corporate-suffix words carry no identifying signal on their own —
// without filtering them, two unrelated clients that both happen to be "X and Co" (e.g.
// "Wills and Co" vs "Toto and Co") share enough tokens to clear the fuzzy-match
// threshold below and get folded into each other's hours. Only strip them when doing so
// leaves at least one real token, so a name that's ALL stopwords still matches on itself.
const STOPWORDS = new Set(["and", "the", "co", "pty", "ltd", "inc", "group", "of"]);
export function tokens(s) {
  const all = normalizeName(s).split(" ").filter((t) => t.length > 1);
  const meaningful = all.filter((t) => !STOPWORDS.has(t));
  return meaningful.length ? meaningful : all;
}
export function tokenSim(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
export function findMatch(name, candidates) {
  const norm = normalizeName(name);
  for (const a of candidates) if (normalizeName(a) === norm) return { name: a, confidence: 1, method: "exact" };
  for (const a of candidates) {
    const na = normalizeName(a);
    if (na && (norm.includes(na) || na.includes(norm))) return { name: a, confidence: 0.85, method: "substring" };
  }
  let best = null;
  for (const a of candidates) {
    const sim = tokenSim(name, a);
    if (sim > (best?.confidence ?? 0)) best = { name: a, confidence: sim, method: "tokens" };
  }
  if (best && best.confidence >= 0.5) return best;
  return null;
}

// Matches a raw ClickUp username against a roster of {name, alias} people, trying
// each person's alias (a manually-set override for when ClickUp's display name
// doesn't fuzzy-match their roster name at all) alongside their name. Returns the
// owning person object, keyed back by canonical `name` regardless of which of the
// two candidates actually matched.
export function findPersonMatch(name, people) {
  const owner = new Map();
  const candidates = [];
  for (const p of people) {
    const keys = [p.name];
    if (p.alias && p.alias.trim()) keys.push(p.alias.trim());
    for (const k of keys) {
      if (!owner.has(k)) { owner.set(k, p); candidates.push(k); }
    }
  }
  const m = findMatch(name, candidates);
  return m ? (owner.get(m.name) || null) : null;
}

// Canonical client-type vocabulary — Client Invoicing's own 4 categories
// (package/hourly/quoted/queensland) plus "map" (Marketing Action Plan), which is
// its own distinct engagement type rather than a plain Quoted project or Package.
// Capacity Planning and Performance track a finer-grained "basis" per client
// agreement (Package/Project/Quoted/MAP/Strategy/Hourly/Ad hoc); basisToClientType
// folds that down to this shared vocabulary so a chip, filter, or export reads the
// same way in every module instead of surfacing internal-only jargon like
// "Strategy". Project (bounded, one-off scoped work) maps to Quoted; Strategy (an
// ongoing engagement with agreed recurring hours, same shape as a Package) maps to
// Package; MAP keeps its own identity rather than folding into either.
export const CLIENT_TYPE_LABELS = {
  package: "Package",
  hourly: "Hourly",
  quoted: "Quoted",
  map: "MAP",
  queensland: "Queensland (prv)",
};
export const CLIENT_TYPE_TONES = {
  package: "var(--accent)",
  hourly: "var(--accent-orchid)",
  quoted: "var(--fg-tertiary)",
  map: "var(--status-warn)",
  queensland: "var(--status-info)",
};
export function basisToClientType(basis) {
  const b = String(basis || "").trim();
  if (b === "MAP") return "map";
  if (b === "Package" || b === "Strategy") return "package";
  if (b === "Quoted" || b === "Project") return "quoted";
  return "hourly"; // Hourly, Ad hoc, or unrecognised
}

// A client group's canonical type from its Capacity Planning row(s). Almost every
// group is a single row, so this is just basisToClientType(that row's basis); a
// "Combined" group (multiple sub-project rows with different bases — e.g. a
// Package plus a one-off Project) is bucketed under whichever non-Hourly type
// carries the most agreed hours, since actual hours can't be split back out
// between the sub-rows once matched to a single ClickUp folder.
export function dominantClientType(rows) {
  const types = rows.map((r) => basisToClientType(r.basis));
  const uniq = [...new Set(types)];
  if (uniq.length === 1) return uniq[0];
  const fixedRows = rows.filter((r) => basisToClientType(r.basis) !== "hourly");
  if (!fixedRows.length) return "hourly";
  const dominant = fixedRows.reduce((best, r) => (r.agreed || 0) > (best.agreed || 0) ? r : best, fixedRows[0]);
  return basisToClientType(dominant.basis);
}

// A handful of clients run their ClickUp work across several sibling project folders
// instead of one umbrella folder per client (e.g. Aus3C's cyber-training programs each
// get their own folder: "Aus3C Cyber Battle", "Aus3C IRAP", ...). The single-best-match
// findMatch() above only ever picks ONE folder for a client, so these clients' real hours
// were being silently undercounted everywhere actuals are computed from ClickUp data —
// Capacity Planning, Performance, and Client Accruals alike. Prefix rules (rather than a
// fixed, manually-maintained folder list) so a brand-new sub-project folder is picked up
// automatically the next time it's synced, without another code change.
// Keyed by a normalized substring that identifies the client regardless of which system's
// exact display name is passed in (SEED_CLIENTS vs pginvoice_clients spell some of these
// differently).
const MULTI_FOLDER_CLIENTS = [
  { key: "apex comm", prefixes: ["apex comms "] },
  { key: "aus3c", prefixes: ["aus3c "], exact: ["australian cyber collaboration centre"] },
  { key: "aus 3c", prefixes: ["aus3c "], exact: ["australian cyber collaboration centre"] },
  { key: "clarke energy", prefixes: ["cea "], exact: ["clarke energy"] },
  { key: "magain", prefixes: ["magain "] },
  { key: "majestic plumbing", prefixes: ["majestic plumbing", "mp "] },
];

// Returns every real ClickUp folder belonging to a multi-folder client, or null if `name`
// isn't one of them (meaning the caller should fall back to plain findMatch instead).
export function multiFolderMatchesFor(name, allFolders) {
  const norm = normalizeName(name);
  const rule = MULTI_FOLDER_CLIENTS.find((r) => norm.includes(r.key));
  if (!rule) return null;
  return allFolders.filter((f) => {
    const nf = normalizeName(f);
    if (rule.exact && rule.exact.includes(nf)) return true;
    return rule.prefixes.some((p) => nf.startsWith(p));
  });
}

// Internal / non-revenue folders (per the billable-hours guide, §3.1): onboarding/
// offboarding/handover/WIP trackers. "Purple Giraffe" is NOT internal — it's the
// ClickUp account DMA (Digital Marketing Adelaide) logs time under, and its hours
// count like any other consultant's across all reports.
// Case-insensitive substring match — deliberately broader than the guide's literal-case
// example so folders like "Julia Onboarding & Induction" still match regardless of case.
export const INTERNAL_KEYWORDS = ["onboarding", "induction", "offboarding", "handover", "wip"];
export function isInternalFolder(folder) {
  const f = String(folder || "").toLowerCase();
  if (!f) return false;
  return INTERNAL_KEYWORDS.some((k) => f.includes(k));
}
