// Shared client-name matching, used by both Client Invoicing (matching ClickUp folder
// names to the accrued sheet) and Capacity Planning (matching ClickUp folder names to
// its own client list) — kept in one place so the two never quietly drift apart.
export function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
export function tokens(s) { return normalizeName(s).split(" ").filter((t) => t.length > 1); }
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

// Internal / non-revenue folders (per the billable-hours guide, §3.1): the literal
// "Purple Giraffe" bucket, plus onboarding/offboarding/handover/WIP trackers.
// Case-insensitive substring match — deliberately broader than the guide's literal-case
// example so folders like "Julia Onboarding & Induction" still match regardless of case.
export const INTERNAL_KEYWORDS = ["purple giraffe", "onboarding", "induction", "offboarding", "handover", "wip"];
export function isInternalFolder(folder) {
  const f = String(folder || "").toLowerCase();
  if (!f) return false;
  return INTERNAL_KEYWORDS.some((k) => f.includes(k));
}
