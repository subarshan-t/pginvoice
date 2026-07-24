import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload, Copy, Check, ChevronDown, ChevronUp, Download, Search,
  AlertTriangle, Link2, FileSpreadsheet, FileText, Printer, Users, ArrowUpDown,
  RefreshCw, Wifi, WifiOff,
} from "lucide-react";
import { LETTERHEAD_FOOTER_B64 } from "./letterheadFooter.js";
import { NORDIQUE_FONT_FACE_CSS } from "./nordiqueFont.js";
import { idbGet, idbSet } from "./idbStore.js";
import { findMatch, isInternalFolder } from "./nameMatch.js";
import { fetchClickupFromSupabase, fetchSyncMeta, triggerManualSync } from "./clickupSync.js";

// ---------------------------- time text → minutes ----------------------------
function parseTimeTextToMinutes(raw) {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "-" || s === "--") return 0;
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10) + (colon[3] ? parseInt(colon[3], 10) / 60 : 0);
  if (/[hms]/.test(s)) {
    const h = s.match(/(\d+(?:\.\d+)?)\s*h/);
    const m = s.match(/(\d+(?:\.\d+)?)\s*m/);
    const sec = s.match(/(\d+(?:\.\d+)?)\s*s(?!\w)/);
    if (h || m || sec) return (h ? parseFloat(h[1]) * 60 : 0) + (m ? parseFloat(m[1]) : 0) + (sec ? parseFloat(sec[1]) / 60 : 0);
  }
  const n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return 0;
  if (n > 0 && n < 1) return n * 24 * 60;
  return n;
}
function msToMinutes(raw) {
  const n = parseFloat(String(raw).replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return 0;
  return n / 60000;
}
const fmt = (hrs, dec = 2) =>
  Number.isFinite(hrs)
    ? (Math.round(hrs * Math.pow(10, dec)) / Math.pow(10, dec)).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })
    : "—";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The browser's "Save as PDF" dialog suggests <title> as the default filename —
// strip characters that are illegal in filenames on Windows/macOS (some client
// names contain "/", e.g. "BAMSS / Childcare Sec Services") so that suggestion
// doesn't get silently mangled or rejected.
const filenameSafe = (s) => String(s ?? "").replace(/[\\/:*?"<>|]/g, "-").trim();
function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
// "Priya" for a single contributor; "Priya (18.00h), Suba (4.00h)" when more than one logged
// time against the same task — hours already shown in the Hours column, so only spelled out
// per-person when there's more than one name to disambiguate.
function formatTaskUsers(userMinutesMap) {
  if (!userMinutesMap || userMinutesMap.size === 0) return "—";
  const entries = [...userMinutesMap.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 1) return entries[0][0] || "—";
  return entries.map(([u, min]) => `${u || "—"} (${fmt(min / 60)}h)`).join(", ");
}

// ------------------------------ name matching --------------------------------
// normalizeName / tokenSim / findMatch / isInternalFolder now live in ./nameMatch.js,
// shared with Capacity Planning so the two never quietly drift apart.

// ------------------- header parsing for the accrued sheet --------------------
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
const MONTH_INDEX = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };

function parseHeaderToMonth(cell, contextYear) {
  if (cell === null || cell === undefined || cell === "") return null;
  if (cell instanceof Date && !isNaN(cell.getTime()))
    return { year: cell.getFullYear(), month: cell.getMonth(), label: monthLabel(cell.getFullYear(), cell.getMonth()) };
  const s = String(cell).trim();
  const lower = s.toLowerCase();
  if (lower.includes("%") || lower.includes("comment")) return null;
  const dmy = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    const month = parseInt(dmy[2], 10) - 1;
    if (month >= 0 && month <= 11) return { year, month, label: monthLabel(year, month) };
  }
  for (const m of MONTH_NAMES) {
    const re = new RegExp(`\\b${m}\\w*\\b`, "i");
    if (re.test(lower)) {
      const yearMatch = s.match(/\b(20\d{2}|\d{2})\b/);
      let year = null;
      if (yearMatch) { year = parseInt(yearMatch[1], 10); if (year < 100) year += 2000; }
      else if (contextYear) year = contextYear;
      else return null;
      return { year, month: MONTH_INDEX[m], label: monthLabel(year, MONTH_INDEX[m]) };
    }
  }
  return null;
}
function monthLabel(year, month) { return new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" }); }
function monthKey(year, month) { return `${year}-${String(month + 1).padStart(2, "0")}`; }
function prevMonthKeyStr(key) {
  const [y, m] = key.split("-").map(Number); // m is 1-12
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ------------------------------ accrued parser -------------------------------
function parseAccruedWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /accrued/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  let headerIdx = rows.findIndex((r) => r && ((r[0] && /client/i.test(String(r[0]))) || (r[1] && /agreed/i.test(String(r[1])))));
  if (headerIdx < 0) headerIdx = 2;
  const header = rows[headerIdx] || [];

  const warnings = [];
  const maxSaneYear = new Date().getFullYear() + 1;
  const rawCols = [];
  let contextYear = null;
  for (let c = 2; c < header.length; c++) {
    const m = parseHeaderToMonth(header[c], contextYear);
    if (!m) continue;
    if (m.year > maxSaneYear) {
      warnings.push(`Column "${String(header[c])}" parsed as ${m.label}, which looks like a typo in the source sheet (year is well in the future). It's still included, but check it.`);
    } else {
      contextYear = m.year; // don't let a bad year poison inference for later month-only headers
    }
    rawCols.push({ col: c, ...m });
  }
  // real spreadsheets accumulate repeated/duplicate month columns over time (copy-paste,
  // corrections); keep one per month — the rightmost (latest-entered) column wins — and
  // present them in chronological order rather than raw column order.
  const byMonth = new Map();
  for (const bc of rawCols) byMonth.set(monthKey(bc.year, bc.month), bc);
  if (byMonth.size < rawCols.length) {
    warnings.push(`Found ${rawCols.length - byMonth.size} duplicate month column(s) in the accrued sheet, using the rightmost (latest) one for each month.`);
  }
  const balanceCols = [...byMonth.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));

  const clients = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = row[0];
    const pkgRaw = row[1];
    if (!name || typeof name !== "string") continue;
    const nameTrim = name.trim();
    if (!nameTrim) continue;
    if (typeof pkgRaw === "string" && /agreed\s*h\.?p\.?m/i.test(pkgRaw)) continue;

    let pkg = null;
    if (typeof pkgRaw === "number") pkg = pkgRaw;
    else if (typeof pkgRaw === "string") {
      const m = pkgRaw.match(/(-?\d+(?:\.\d+)?)/);
      if (m) pkg = parseFloat(m[1]);
    }

    const balances = {};
    for (const bc of balanceCols) {
      const v = row[bc.col];
      if (typeof v === "number") balances[monthKey(bc.year, bc.month)] = v;
    }
    if (pkg === null && Object.keys(balances).length === 0) continue;
    clients.push({ name: nameTrim, package: pkg, balances });
  }

  // real client lists accumulate exact-name duplicates (re-added rows, copy-paste) — not
  // a parsing error, but worth surfacing since only the first match is ever used for lookups
  const nameCounts = new Map();
  for (const c of clients) nameCounts.set(c.name, (nameCounts.get(c.name) || 0) + 1);
  const dupNames = [...nameCounts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  if (dupNames.length) warnings.push(`${dupNames.length} client name${dupNames.length === 1 ? "" : "s"} appear more than once in the accrued sheet (${dupNames.slice(0, 5).join(", ")}${dupNames.length > 5 ? ", …" : ""}); only the first row for each is used.`);

  return { clients, balanceCols, sheetName, warnings };
}

// ------------------------------- clickup parser -------------------------------
function findHeader(headers, wanted) {
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const w = norm(wanted);
  let hit = headers.find((h) => norm(h) === w);
  if (!hit) hit = headers.find((h) => norm(h).startsWith(w));
  return hit || null;
}
const SKIP_FOLDERS = new Set(["", "grand total", "(blank)", "blank"]);

// "Start Text" is already localised to the business timezone (ACST), e.g.
// "05/19/2026, 6:49:33 AM ACST" — parse the date directly from it rather
// than converting the raw epoch "Start" value, which can misfile
// near-midnight sessions into the wrong month across a UTC boundary.
function parseStartTextMonth(raw) {
  if (!raw) return null;
  const datePart = String(raw).split(",")[0].trim();
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 0 || month > 11) return null;
  return { year, month, day };
}
function dateKeyStr(year, month, day) { return `${monthKey(year, month)}-${String(day).padStart(2, "0")}`; }

function parseClickupCsv(file, onDone, onErr) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: "greedy",
    complete: (result) => {
      const headers = result.meta.fields || [];
      const warnings = [];
      const hFolder = findHeader(headers, "Folder Name");
      const hTask = findHeader(headers, "Task Name");
      const hTimeText = findHeader(headers, "Time Tracked Text");
      // Exact match only — "Time Tracked" must not fall back to matching
      // "Time Tracked Text" via findHeader's startsWith rule when there's no
      // separate numeric column.
      const hTimeMs = headers.find((h) => h.toLowerCase().replace(/[^a-z0-9]/g, "") === "timetracked") || null;
      const hBillable = findHeader(headers, "Billable");
      const hUser = findHeader(headers, "Username");
      const hStart = findHeader(headers, "Start Text");
      if (!hFolder) { onErr("Couldn't find a \"Folder Name\" column. This should be a ClickUp time-tracking export."); return; }
      let zeroCount = 0;
      const rows = [];
      for (const r of result.data) {
        const folder = String(r[hFolder] || "").trim();
        if (SKIP_FOLDERS.has(folder.toLowerCase())) continue;
        let minutes = 0;
        // "Time Tracked" (ms) is the authoritative numeric duration; "Time Tracked
        // Text" is a display string and only used as a fallback for older,
        // pre-aggregated exports that don't carry the numeric column at all.
        if (hTimeMs && r[hTimeMs] !== undefined && String(r[hTimeMs]).trim() !== "") minutes = msToMinutes(r[hTimeMs]);
        else if (hTimeText) minutes = parseTimeTextToMinutes(r[hTimeText]);
        if (minutes === 0) zeroCount++;
        const billableRaw = hBillable ? String(r[hBillable] || "").trim().toLowerCase() : "";
        const billable = ["true", "yes", "1", "billable"].includes(billableRaw);
        const startMonth = hStart ? parseStartTextMonth(r[hStart]) : null;
        rows.push({
          folder,
          task: hTask ? String(r[hTask] || "").trim() || "Untitled" : "Untitled",
          minutes, billable, hasBillableCol: !!hBillable,
          user: hUser ? String(r[hUser] || "").trim() : "",
          isInternal: isInternalFolder(folder),
          monthKey: startMonth ? monthKey(startMonth.year, startMonth.month) : null,
          monthLabel: startMonth ? monthLabel(startMonth.year, startMonth.month) : null,
          dateKey: startMonth ? dateKeyStr(startMonth.year, startMonth.month, startMonth.day) : null,
        });
      }
      if (rows.length && zeroCount === rows.length) warnings.push("Every row parsed to zero hours; the ClickUp export format may have changed.");
      onDone({ rows, hasBillable: !!hBillable, hasUser: !!hUser, hasStartDate: !!hStart, warnings });
    },
    error: (e) => onErr("Couldn't read the CSV: " + e.message),
  });
}

// ------------------------------ classification ------------------------------
function classifyClient(c) {
  if (c.matched && c.pkg != null) return "package";
  if (/\(qld\)/i.test(c.name)) return "queensland";
  return "hourly";
}

const TYPE_LABELS = {
  package: "Clients on a Package",
  hourly: "Clients on Hourly rate",
  quoted: "Quoted Clients",
  queensland: "Queensland Clients (prv)",
};

// Category tags borrow the brand's purple family; Queensland (an inactive/
// legacy bucket) is the one deliberate step outside it.
const TYPE_TONES = {
  package: "var(--accent)",
  hourly: "var(--accent-orchid)",
  queensland: "var(--status-info)",
  quoted: "var(--fg-tertiary)",
};

// ------------------------------- PDF (print) --------------------------------
const PRINT = { ink: "#000000", inkSoft: "#000000", brand: "#3F008E", line: "#E7E1F0", brandSoft: "#F1EAFB" };

function buildPrintHtml(c, monthText, priorMonthText) {
  const type = c.type;
  const isPkg = type === "package";
  const taskRows = [...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1])
    .map(([task, min]) => `<tr class="datarow"><td>${esc(task)}</td><td class="right">${fmt(min / 60)}</td></tr>`).join("");
  const workedRounded = Math.round(c.workedFiltered * 100) / 100;
  const priorSigned = c.priorBalance ?? 0;
  const priorLabel = priorSigned < 0 ? "Carried in from previous month"
                    : priorSigned > 0 ? "Over-used in previous month"
                    : "Prior month balance";
  const priorAbs = Math.abs(priorSigned);
  const totalAccrued = workedRounded + priorSigned; // as spec'd: current spent + prior signed

  const reconciliation = isPkg ? `
    <tr class="noborder"><td colspan="2" class="section-heading">Reconciliation</td></tr>
    <tr class="datarow"><td class="label">Package</td><td class="right">${fmt(c.pkg)} h / month</td></tr>
    <tr class="datarow"><td class="label">${priorLabel}${priorMonthText ? ` (${esc(priorMonthText)})` : ""}</td><td class="right">${fmt(priorAbs)} h</td></tr>
    <tr class="datarow"><td class="label">Time tracked this month</td><td class="right">${fmt(workedRounded)} h</td></tr>
    <tr class="total"><td>Total accrued time</td><td class="right">${fmt(totalAccrued)} h</td></tr>
    <tr class="datarow"><td class="label">New balance going forward</td><td class="right">${fmt(c.newBalance)} h ${c.newBalance > 0 ? "over" : c.newBalance < 0 ? "credit" : ""}</td></tr>
    <tr class="datarow"><td class="label">Remaining this month</td><td class="right">${c.remaining >= 0 ? fmt(c.remaining) + " h left" : fmt(Math.abs(c.remaining)) + " h over"}</td></tr>
    <tr class="noborder"><td colspan="2" class="note-cell">Total accrued time = time tracked this month + prior balance (signed). Negative prior = client credit carried in; positive prior = over-served last month.</td></tr>` : `
    <tr class="noborder"><td colspan="2" class="section-heading">Summary</td></tr>
    <tr class="datarow"><td class="label">Time tracked this month</td><td class="right">${fmt(workedRounded)} h</td></tr>
    <tr class="noborder"><td colspan="2" class="note-cell">${type === "hourly" ? "Hourly-rate client: invoice at the agreed hourly rate for these hours." : "Queensland (previously) client: no accrued balance on record."}</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${esc(filenameSafe(c.displayName))} ${esc(filenameSafe(monthText))}</title>
<style>
  ${NORDIQUE_FONT_FACE_CSS}
  @page { margin: 15mm; size: A4; }
  * { box-sizing: border-box; }
  body { font-family: 'Nordique Pro', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-weight: 600; color: ${PRINT.ink}; margin: 0; }
  /* The letterhead footer repeats on every printed page via a <tfoot> with
     display:table-footer-group — the one CSS mechanism Chromium actually
     reserves per-page space for correctly. A position:fixed footer (the
     previous approach) hits a longstanding Chromium print bug: the last
     row before a page break bleeds a few mm into a fixed element regardless
     of how much @page margin is reserved for it — reproduces even in a
     bare table with zero custom CSS, so it isn't a tuning problem. Hence
     the whole page being one table: everything that needs to flow across
     pages safely (header, tasks, reconciliation) lives in its tbody. */
  table.doc { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px 10px; text-align: left; }
  .header-cell { border-bottom: 2px solid ${PRINT.ink}; padding-bottom: 14px; }
  .brand { font-family: 'Nordique Pro', sans-serif; color: ${PRINT.brand}; font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; }
  h1 { font-family: 'Nordique Pro', sans-serif; font-weight: 700; font-size: 26px; margin: 6px 0 0; letter-spacing: -0.01em; }
  .subtitle { color: ${PRINT.inkSoft}; font-size: 14px; margin-top: 4px; }
  .section-heading { font-family: 'Nordique Pro', sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: ${PRINT.brand}; font-weight: 600; padding-top: 22px; }
  .noborder td, tr.noborder { border: none; }
  .datarow { border-bottom: 1px solid ${PRINT.line}; page-break-inside: avoid; break-inside: avoid; font-weight: 300; }
  .right { text-align: right; font-variant-numeric: tabular-nums; font-family: Arial, "Segoe UI", sans-serif; }
  .total td { font-weight: 700; border-top: 2px solid ${PRINT.ink}; border-bottom: none; padding-top: 12px; }
  .label { color: ${PRINT.inkSoft}; }
  .note-cell { font-size: 11px; color: ${PRINT.inkSoft}; font-style: italic; padding-top: 4px; }
  .generated-note-cell { font-size: 9px; color: ${PRINT.inkSoft}; text-align: right; font-style: italic; padding-top: 24px; }
  .letterhead-footer-cell {
    height: 15mm; /* the footer image is cropped to fit exactly within a 15mm margin at full page width */
    padding: 0;
    border: none;
    background-image: url('data:image/png;base64,${LETTERHEAD_FOOTER_B64}');
    background-repeat: no-repeat;
    background-position: bottom center;
    background-size: 100% auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print { .noprint { display: none; } }
</style>
</head><body>
  <table class="doc">
    <tfoot>
      <tr><td colspan="2" class="letterhead-footer-cell"></td></tr>
    </tfoot>
    <tbody>
      <tr class="noborder"><td colspan="2" class="header-cell">
        <div class="brand">Purple Giraffe · client hours report</div>
        <h1>${esc(c.displayName)}</h1>
        <div class="subtitle">${esc(monthText)}</div>
      </td></tr>

      <tr class="noborder"><td colspan="2" class="section-heading">Tasks worked this month</td></tr>
      ${taskRows || `<tr class="datarow"><td colspan="2" class="label">No tasks in this filter.</td></tr>`}
      <tr class="total"><td>Total</td><td class="right">${fmt(workedRounded)} h</td></tr>

      ${reconciliation}

      <tr class="noborder"><td colspan="2" class="generated-note-cell">Generated ${esc(new Date().toLocaleString())}</td></tr>
    </tbody>
  </table>

  <script>
    window.addEventListener('load', function() {
      // Print as soon as fonts are ready, but never wait more than 1.5s for
      // them — a hung font-loading promise should never be able to silently
      // stop the print dialog (and the "download") from happening at all.
      var printed = false;
      function go() { if (!printed) { printed = true; window.print(); } }
      document.fonts.ready.then(go, go);
      setTimeout(go, 1500);
    });
  </script>
</body></html>`;
}

function printClientPdf(c, monthText, priorMonthText) {
  const html = buildPrintHtml(c, monthText, priorMonthText);
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) {
    // popup blocked — fall back to blob URL in the current tab
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ------------------------------- storage keys --------------------------------
const NAMEMAP_KEY = "pg-name-map-v1";
const CLICKUP_DB_KEY = "clickup";
const ACCRUED_DB_KEY = "accrued";
const VIEWSTATE_KEY = "pg-view-state-v1";
// Below this many hours of disagreement between the accrued sheet's recorded prior-month
// balance and what it recalculates to from current ClickUp data, treat it as rounding noise
// rather than a real edit-after-the-fact discrepancy worth flagging.
const MISMATCH_TOLERANCE_H = 0.2;

// ================================ COMPONENT =================================
export default function PGReconciliation() {
  const [clickup, setClickup] = useState(null);
  const [accrued, setAccrued] = useState(null);
  const [invoiceMonth, setInvoiceMonth] = useState("");
  const [dataMonthKey, setDataMonthKey] = useState("");
  const [priorMonthKey, setPriorMonthKey] = useState("");
  const [billableOnly, setBillableOnly] = useState(true);
  const [nameMap, setNameMap] = useState({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [clickupErr, setClickupErr] = useState(null);
  const [accruedErr, setAccruedErr] = useState(null);
  const [clientTypeFilter, setClientTypeFilter] = useState("package");
  const [consultantFilter, setConsultantFilter] = useState("");
  const [sortMode, setSortMode] = useState("risk");
  const clickupInput = useRef(null);
  const accruedInput = useRef(null);
  const saveTimer = useRef(null);
  const viewSaveTimer = useRef(null);
  const invoiceMonthAutoRef = useRef("");
  const justHydratedClickupRef = useRef(undefined);
  const justHydratedAccruedRef = useRef(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [syncMeta, setSyncMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [clickupSource, setClickupSource] = useState(null); // "supabase" | "manual"
  const manualOverrideRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAMEMAP_KEY);
      if (raw) setNameMap(JSON.parse(raw));
    } catch (e) {}
  }, []);

  // Restore the uploaded data and filters from a previous session. The parsed CSV can run
  // several MB as JSON, too close to localStorage's shared per-origin quota to risk — so the
  // two large datasets live in IndexedDB, and just the small filter/view settings use
  // localStorage. Both setClickup/setAccrued and the filter setters land in the same commit,
  // so the auto-select effects below (which only override an *invalid* selection) see the
  // restored values already in place and leave them alone.
  useEffect(() => {
    (async () => {
      const [savedClickup, savedAccrued] = await Promise.all([idbGet(CLICKUP_DB_KEY), idbGet(ACCRUED_DB_KEY)]);
      if (savedClickup) { setClickup(savedClickup); justHydratedClickupRef.current = savedClickup; }
      if (savedAccrued) { setAccrued(savedAccrued); justHydratedAccruedRef.current = savedAccrued; }
      try {
        const raw = window.localStorage.getItem(VIEWSTATE_KEY);
        if (raw) {
          const v = JSON.parse(raw);
          if (v.invoiceMonth != null) { setInvoiceMonth(v.invoiceMonth); invoiceMonthAutoRef.current = v.invoiceMonth; }
          if (v.dataMonthKey != null) setDataMonthKey(v.dataMonthKey);
          if (v.priorMonthKey != null) setPriorMonthKey(v.priorMonthKey);
          if (v.billableOnly != null) setBillableOnly(v.billableOnly);
          if (v.clientTypeFilter != null) setClientTypeFilter(v.clientTypeFilter);
          if (v.consultantFilter != null) setConsultantFilter(v.consultantFilter);
          if (v.sortMode != null) setSortMode(v.sortMode);
          if (v.search != null) setSearch(v.search);
        }
      } catch (e) { /* ignore */ }
      setHydrated(true);

      // Live ClickUp data, kept fresh by a Supabase-scheduled sync (see
      // clickupSync.js) — this is what makes the app auto-populate on every
      // reload, without waiting for a manual upload. A manual upload later in
      // this same session still wins until the next reload (see handleClickup
      // and handleManualSync below), guarded by manualOverrideRef so a slow
      // network response can't clobber a file the user just chose.
      fetchSyncMeta().then(setSyncMeta).catch(() => {});
      fetchClickupFromSupabase().then((live) => {
        if (!live || manualOverrideRef.current) return;
        setClickup(live);
        setClickupSource("supabase");
      }).catch((e) => console.error("Supabase ClickUp fetch failed:", e));
    })();
  }, []);

  const handleManualSync = async () => {
    setSyncing(true);
    manualOverrideRef.current = false; // an explicit "Sync now" click means: give me live data
    try {
      await triggerManualSync();
      const live = await fetchClickupFromSupabase();
      if (live) { setClickup(live); setClickupSource("supabase"); }
      setSyncMeta(await fetchSyncMeta());
    } catch (e) {
      setClickupErr("Sync failed: " + (e && e.message ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!hydrated) return;
    // skip the one redundant write-back right after hydration set this to the exact object
    // we just read out of IndexedDB — no need to round-trip several MB back in immediately
    if (clickup === justHydratedClickupRef.current) { justHydratedClickupRef.current = undefined; return; }
    idbSet(CLICKUP_DB_KEY, clickup);
  }, [clickup, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    if (accrued === justHydratedAccruedRef.current) { justHydratedAccruedRef.current = undefined; return; }
    idbSet(ACCRUED_DB_KEY, accrued);
  }, [accrued, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    if (viewSaveTimer.current) clearTimeout(viewSaveTimer.current);
    const snapshot = { invoiceMonth, dataMonthKey, priorMonthKey, billableOnly, clientTypeFilter, consultantFilter, sortMode, search };
    viewSaveTimer.current = setTimeout(() => {
      try { window.localStorage.setItem(VIEWSTATE_KEY, JSON.stringify(snapshot)); } catch (e) {}
    }, 400);
  }, [hydrated, invoiceMonth, dataMonthKey, priorMonthKey, billableOnly, clientTypeFilter, consultantFilter, sortMode, search]);

  useEffect(() => {
    if (!accrued) return;
    if (priorMonthKey && accrued.balanceCols.find((c) => monthKey(c.year, c.month) === priorMonthKey)) return;
    const last = accrued.balanceCols[accrued.balanceCols.length - 1];
    if (last) setPriorMonthKey(monthKey(last.year, last.month));
  }, [accrued]); // eslint-disable-line

  // when a new ClickUp export loads, default the reporting period to the most recent month
  // it contains (or "" — no filter — for older exports with no Start Text column to detect
  // months from at all) — but leave a still-valid selection alone, since that's exactly what
  // lets a restored session (see hydration effect above) keep its previously-chosen period.
  useEffect(() => {
    if (!clickup) { setDataMonthKey(""); return; }
    if (dataMonthKey && availableMonths.some((m) => m.key === dataMonthKey)) return;
    setDataMonthKey(availableMonths.length ? availableMonths[availableMonths.length - 1].key : "");
  }, [clickup]); // eslint-disable-line

  // cross-check historical months against the matching accrued-sheet column: whenever the
  // reporting period changes, chain "prior balance from" to the month right before it, if
  // the accrued sheet has that column — this is what makes reconciling an older month in a
  // multi-month export line up with the right historical balance instead of always the latest.
  useEffect(() => {
    if (!accrued || !dataMonthKey) return;
    const desired = prevMonthKeyStr(dataMonthKey);
    if (accrued.balanceCols.some((c) => monthKey(c.year, c.month) === desired)) setPriorMonthKey(desired);
  }, [dataMonthKey, accrued]); // eslint-disable-line

  // pre-fill the (still freely editable) invoice-month label from the detected period,
  // without clobbering anything the user typed themselves
  useEffect(() => {
    if (!dataMonthKey) return;
    const label = availableMonths.find((m) => m.key === dataMonthKey)?.label;
    if (!label) return;
    if (!invoiceMonth || invoiceMonth === invoiceMonthAutoRef.current) {
      setInvoiceMonth(label);
      invoiceMonthAutoRef.current = label;
    }
  }, [dataMonthKey]); // eslint-disable-line

  const persistNameMap = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { try { window.localStorage.setItem(NAMEMAP_KEY, JSON.stringify(next)); } catch (e) {} }, 400);
  }, []);

  const setManualMatch = (clickupName, accruedName) => {
    setNameMap((prev) => {
      const next = { ...prev };
      if (accruedName === "__none__") delete next[clickupName];
      else next[clickupName] = accruedName;
      persistNameMap(next);
      return next;
    });
  };

  const handleClickup = (file) => {
    if (!file) return;
    setClickupErr(null);
    setDataMonthKey(""); // force fresh period auto-detection for this new file, rather than
                          // keeping whatever was selected for the previous one
    manualOverrideRef.current = true; // wins over live sync until the next reload
    setClickupSource("manual");
    parseClickupCsv(file,
      (r) => setClickup({ ...r, fileName: file.name }),
      (msg) => { setClickupErr(msg); setClickup(null); });
  };
  const handleAccrued = (file) => {
    if (!file) return;
    setAccruedErr(null);
    const isXlsx = /\.xls[mx]?$/i.test(file.name);
    if (isXlsx) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try { setAccrued({ ...parseAccruedWorkbook(e.target.result), fileName: file.name }); }
        catch (err) { setAccruedErr("Couldn't read the accrued file: " + err.message); }
      };
      reader.onerror = () => setAccruedErr("Couldn't read the file.");
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: false, skipEmptyLines: "greedy",
        complete: (result) => {
          try {
            const ws = XLSX.utils.aoa_to_sheet(result.data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Accrued Hours");
            const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
            setAccrued({ ...parseAccruedWorkbook(out), fileName: file.name });
          } catch (err) { setAccruedErr("Couldn't read the accrued CSV: " + err.message); }
        },
        error: (e) => setAccruedErr("Couldn't read the file: " + e.message),
      });
    }
  };

  const accruedNames = useMemo(() => (accrued ? accrued.clients.map((c) => c.name) : []), [accrued]);

  // billable, non-internal minutes per folder for the PRIOR month specifically (not the
  // selected reporting month) — only populated when the export actually covers that period,
  // so this can independently re-derive what the prior month's ending balance would be from
  // current ClickUp data, to cross-check against what the accrued sheet already has recorded
  // for it. Returns null when the export doesn't cover that month at all (nothing to check).
  const priorMonthWorked = useMemo(() => {
    if (!clickup || !priorMonthKey) return null;
    const byFolder = new Map();
    let covered = false;
    for (const r of clickup.rows) {
      if (r.monthKey === priorMonthKey) covered = true; else continue;
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (r.isInternal) continue;
      byFolder.set(r.folder, (byFolder.get(r.folder) || 0) + r.minutes);
    }
    return covered ? byFolder : null;
  }, [clickup, priorMonthKey, billableOnly]);

  // per-client aggregation, WITHOUT consultant filter (this is the base data)
  const clients = useMemo(() => {
    if (!clickup) return [];
    const map = new Map();
    for (const r of clickup.rows) {
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (r.isInternal) continue;
      if (dataMonthKey && r.monthKey && r.monthKey !== dataMonthKey) continue;
      if (!map.has(r.folder))
        map.set(r.folder, { name: r.folder, totalMin: 0, tasksAll: new Map(), userMinutes: new Map(), tasksByUser: new Map(), taskUsers: new Map() });
      const c = map.get(r.folder);
      c.totalMin += r.minutes;
      c.tasksAll.set(r.task, (c.tasksAll.get(r.task) || 0) + r.minutes);
      const u = r.user || "";
      c.userMinutes.set(u, (c.userMinutes.get(u) || 0) + r.minutes);
      if (!c.tasksByUser.has(u)) c.tasksByUser.set(u, new Map());
      const t = c.tasksByUser.get(u);
      t.set(r.task, (t.get(r.task) || 0) + r.minutes);
      // who logged time against each task, regardless of the consultant filter
      if (!c.taskUsers.has(r.task)) c.taskUsers.set(r.task, new Map());
      const tu = c.taskUsers.get(r.task);
      tu.set(u, (tu.get(u) || 0) + r.minutes);
    }

    const out = [];
    for (const c of map.values()) {
      const worked = c.totalMin / 60;
      let accruedClient = null;
      let matchInfo = null;
      if (accrued) {
        if (nameMap[c.name]) {
          accruedClient = accrued.clients.find((a) => a.name === nameMap[c.name]) || null;
          if (accruedClient) matchInfo = { name: accruedClient.name, confidence: 1, method: "manual" };
        } else {
          const m = findMatch(c.name, accruedNames);
          if (m) { accruedClient = accrued.clients.find((a) => a.name === m.name) || null; matchInfo = m; }
        }
      }
      const pkg = accruedClient?.package ?? null;
      const priorBalance = accruedClient && priorMonthKey ? (accruedClient.balances[priorMonthKey] ?? null) : null;
      let newBalance = null, remaining = null, kpiPct = null, status = "no-pkg";
      if (pkg !== null && pkg > 0) {
        const prior = priorBalance ?? 0;
        newBalance = worked - pkg + prior;
        remaining = pkg - prior - worked;
        kpiPct = (newBalance / pkg) * 100;
        if (kpiPct > 10) status = "over";
        else if (kpiPct < -10) status = "under";
        else status = "ok";
      }
      // Cross-check the sheet's own recorded balance for the PRIOR month (the figure being
      // used as this month's carry-in) against what it would be if recalculated from the
      // ClickUp data we have for that month right now. A mismatch usually means ClickUp
      // entries were edited after the accrued sheet was last updated for that period.
      let priorMismatch = null;
      if (pkg !== null && pkg > 0 && priorBalance !== null && priorMonthWorked) {
        const priorWorkedH = (priorMonthWorked.get(c.name) || 0) / 60;
        const priorPriorBalance = accruedClient.balances[prevMonthKeyStr(priorMonthKey)] ?? 0;
        const recomputed = priorWorkedH - pkg + priorPriorBalance;
        if (Math.abs(recomputed - priorBalance) > MISMATCH_TOLERANCE_H) {
          priorMismatch = { sheetValue: priorBalance, recomputed };
        }
      }
      const clientObj = {
        ...c, worked, accruedClient, matchInfo,
        pkg, priorBalance, newBalance, remaining, kpiPct, status, priorMismatch,
        matched: !!accruedClient,
        displayName: accruedClient?.name ?? c.name,
      };
      clientObj.type = classifyClient(clientObj);
      out.push(clientObj);
    }
    return out;
  }, [clickup, accrued, accruedNames, nameMap, priorMonthKey, billableOnly, dataMonthKey, priorMonthWorked]);

  // counts by type
  const typeCounts = useMemo(() => {
    const counts = { package: 0, hourly: 0, queensland: 0, quoted: 0 };
    for (const c of clients) counts[c.type] = (counts[c.type] || 0) + 1;
    return counts;
  }, [clients]);

  // consultant list from clickup rows (across all clients, all types — same scope as `clients`)
  const consultants = useMemo(() => {
    if (!clickup) return [];
    const set = new Set();
    for (const r of clickup.rows) {
      if (r.isInternal) continue;
      if (dataMonthKey && r.monthKey && r.monthKey !== dataMonthKey) continue;
      if (r.user) set.add(r.user);
    }
    return [...set].sort();
  }, [clickup, dataMonthKey]);

  // distinct months detected in the export (from Start Text), for the data-period picker
  const availableMonths = useMemo(() => {
    if (!clickup) return [];
    const map = new Map();
    for (const r of clickup.rows) {
      if (!r.monthKey) continue;
      map.set(r.monthKey, r.monthLabel);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.key.localeCompare(b.key));
  }, [clickup]);

  // folders excluded as internal/non-client (Purple Giraffe, onboarding, WIP, etc.) — surfaced for
  // transparency rather than silently dropped, since the keyword rule can misfire on a client-named
  // onboarding folder (see the billable-hours guide, §3.1).
  const excludedInternal = useMemo(() => {
    if (!clickup) return { total: 0, folders: [] };
    const byFolder = new Map();
    for (const r of clickup.rows) {
      if (!r.isInternal) continue;
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (dataMonthKey && r.monthKey && r.monthKey !== dataMonthKey) continue;
      byFolder.set(r.folder, (byFolder.get(r.folder) || 0) + r.minutes);
    }
    const folders = [...byFolder.entries()].map(([folder, min]) => ({ folder, hours: min / 60 })).sort((a, b) => b.hours - a.hours);
    return { total: folders.reduce((a, f) => a + f.hours, 0), folders };
  }, [clickup, billableOnly, dataMonthKey]);

  // filtered + sorted + consultant-scoped clients for display
  const visible = useMemo(() => {
    let list = clients.filter((c) => c.type === clientTypeFilter);
    if (consultantFilter) list = list.filter((c) => c.userMinutes.has(consultantFilter));
    // per-consultant task view: if filter set, use tasksByUser for that consultant; else all tasks
    list = list.map((c) => {
      const tasksFiltered = consultantFilter ? (c.tasksByUser.get(consultantFilter) || new Map()) : c.tasksAll;
      const workedFiltered = consultantFilter ? ((c.userMinutes.get(consultantFilter) || 0) / 60) : c.worked;
      // narrow each task's contributor breakdown to the selected consultant too, when filtering
      const taskUsersFiltered = consultantFilter
        ? new Map([...tasksFiltered.keys()].map((task) => [task, new Map([[consultantFilter, tasksFiltered.get(task)]])]))
        : c.taskUsers;
      return { ...c, tasksFiltered, workedFiltered, taskUsersFiltered };
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.displayName || "").toLowerCase().includes(q));
    }
    // sort
    if (sortMode === "alpha") {
      list.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
    } else {
      // risk: package by |kpiPct| desc, others by worked desc
      list.sort((a, b) => {
        if (clientTypeFilter === "package") return Math.abs(b.kpiPct ?? 0) - Math.abs(a.kpiPct ?? 0);
        return (b.workedFiltered ?? b.worked) - (a.workedFiltered ?? a.worked);
      });
    }
    return list;
  }, [clients, clientTypeFilter, consultantFilter, search, sortMode]);

  const stats = useMemo(() => {
    const hrs = visible.reduce((a, c) => a + (c.workedFiltered ?? c.worked), 0);
    const over = visible.filter((c) => c.status === "over").length;
    const under = visible.filter((c) => c.status === "under").length;
    return { hrs, count: visible.length, over, under };
  }, [visible]);

  // Only meaningful when the reporting period IS the current real-world month — a mid-month
  // check on a still-open month, e.g. "accrued sheet stops at June, it's July 17th, how's the
  // team tracking against package so far this month". A closed historical month has no "pace".
  const monthProgress = useMemo(() => {
    if (!dataMonthKey) return null;
    const [y, m] = dataMonthKey.split("-").map(Number); // m is 1-12
    const now = new Date();
    if (now.getFullYear() !== y || now.getMonth() + 1 !== m) return null;
    const totalDays = new Date(y, m, 0).getDate();
    const dayOfMonth = now.getDate();
    return { dayOfMonth, totalDays, pct: (dayOfMonth / totalDays) * 100 };
  }, [dataMonthKey]);

  // ------------------------------- exports ----------------------------------
  const priorMonthPretty = useMemo(() => {
    if (!priorMonthKey || !accrued) return "";
    const bc = accrued.balanceCols.find((c) => monthKey(c.year, c.month) === priorMonthKey);
    return bc ? bc.label : "";
  }, [priorMonthKey, accrued]);
  const fileMonthTag = (invoiceMonth || new Date().toLocaleString(undefined, { month: "short", year: "numeric" }))
    .replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
  };
  const buildSummaryRows = () =>
    clients.map((c) => ({
      "Client (ClickUp)": c.name,
      "Client type": TYPE_LABELS[c.type],
      "Matched to (Accrued)": c.accruedClient?.name ?? "",
      "Match confidence": c.matchInfo ? `${Math.round(c.matchInfo.confidence * 100)}% (${c.matchInfo.method})` : "unmatched",
      "Package (h/month)": c.pkg ?? "",
      "Prior balance (signed)": c.priorBalance ?? "",
      "Carried in (h)": c.priorBalance != null && c.priorBalance < 0 ? Math.abs(c.priorBalance) : "",
      "Over used prior (h)": c.priorBalance != null && c.priorBalance > 0 ? c.priorBalance : "",
      "Worked this month (h)": Math.round(c.worked * 100) / 100,
      "Remaining (h)": c.remaining != null ? Math.round(c.remaining * 100) / 100 : "",
      "New balance (signed)": c.newBalance != null ? Math.round(c.newBalance * 100) / 100 : "",
      "KPI variance (%)": c.kpiPct != null ? Math.round(c.kpiPct * 10) / 10 : "",
      "Status": { over: "OVER (+10%)", under: "UNDER (−10%)", ok: "on track", "no-pkg": "no package" }[c.status],
      "Consultants": [...c.userMinutes.entries()].map(([u, m]) => `${u || "—"} (${fmt(m / 60)}h)`).join("; "),
    }));
  const buildPendingRows = () =>
    clients
      .filter((c) => c.type === "package" && (c.status === "over" || c.status === "under"))
      .sort((a, b) => Math.abs(b.newBalance) - Math.abs(a.newBalance))
      .map((c) => ({
        "Client": c.accruedClient?.name ?? c.name,
        "Package (h/month)": c.pkg,
        "Prior month balance": Math.round((c.priorBalance ?? 0) * 100) / 100,
        "Worked this month (h)": Math.round(c.worked * 100) / 100,
        "New balance (h)": Math.round(c.newBalance * 100) / 100,
        "Direction": c.newBalance > 0 ? "OVER-SERVED (owe next month)" : "UNDER-SERVED (client credit)",
        "Available next month (h)": Math.round((c.pkg - c.newBalance) * 100) / 100,
        "KPI variance (%)": Math.round(c.kpiPct * 10) / 10,
      }));
  const exportCsv = (rows, filename) => {
    if (rows.length === 0) { download(new Blob(["No records"], { type: "text/csv" }), filename); return; }
    download(new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8" }), filename);
  };
  const exportXlsx = (rows, filename, sheetName) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
  };
  const doExport = (kind, format) => {
    setExportOpen(false);
    const rows = kind === "pending" ? buildPendingRows() : buildSummaryRows();
    const stem = kind === "pending" ? `PG-pending-hours-${fileMonthTag}` : `PG-monthly-summary-${fileMonthTag}`;
    if (format === "csv") exportCsv(rows, `${stem}.csv`);
    else exportXlsx(rows, `${stem}.xlsx`, kind === "pending" ? "Pending" : "Summary");
  };

  // -------------------- per-client copy summary & PDF -----------------------
  const summaryText = (c) => {
    const lines = [];
    const monthText = invoiceMonth || "this month";
    lines.push(`${c.displayName}: hours for ${monthText}`);
    if (c.accruedClient && c.accruedClient.name !== c.name) lines.push(`(ClickUp folder: ${c.name})`);
    lines.push(`Client type: ${TYPE_LABELS[c.type]}`);
    if (consultantFilter) lines.push(`Filtered to consultant: ${consultantFilter}`);
    lines.push("");
    lines.push("Tasks:");
    for (const [task, min] of [...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1]))
      lines.push(`  ${fmt(min / 60)} h  ${task}`);
    lines.push("");
    if (c.userMinutes.size > 0) {
      lines.push("Consultants involved:");
      for (const [u, min] of [...c.userMinutes.entries()].sort((a, b) => b[1] - a[1]))
        lines.push(`  ${fmt(min / 60)} h  ${u || "—"}`);
      lines.push("");
    }
    lines.push(`Time tracked this month: ${fmt(c.workedFiltered)} h`);
    if (c.type === "package" && c.pkg != null) {
      lines.push(`Package: ${fmt(c.pkg)} h`);
      const p = c.priorBalance ?? 0;
      if (p < 0) lines.push(`Carried in from ${priorMonthPretty}: ${fmt(Math.abs(p))} h`);
      else if (p > 0) lines.push(`Over-used in ${priorMonthPretty}: ${fmt(p)} h`);
      else lines.push(`Prior balance: 0 h`);
      lines.push(`Total accrued time: ${fmt(c.worked + p)} h`);
      lines.push(c.remaining >= 0 ? `Remaining this month: ${fmt(c.remaining)} h` : `Over by ${fmt(Math.abs(c.remaining))} h`);
      if (c.status === "over") lines.push(`⚠ Over the +10% KPI (${fmt(c.kpiPct, 1)}% of package)`);
      if (c.status === "under") lines.push(`⚠ Under the −10% KPI (${fmt(c.kpiPct, 1)}% of package), accruing`);
    }
    return lines.join("\n");
  };
  const copySummary = async (c) => {
    try { await navigator.clipboard.writeText(summaryText(c)); setCopied(c.name); setTimeout(() => setCopied(null), 1500); }
    catch (e) {}
  };
  const downloadPdf = (c) => {
    const monthText = invoiceMonth || new Date().toLocaleString(undefined, { month: "long", year: "numeric" });
    printClientPdf(c, monthText, priorMonthPretty);
  };

  // ------------------------------- render -----------------------------------
  const ready = clickup && accrued;

  return (
    <div className="pg-app">
      <div className="pg-container">
        {/* header */}
        <div className="pg-app-header">
          <div>
            <span className="pg-eyebrow">Purple Giraffe · Internal</span>
            <h1 className="pg-app-header__title">Monthly hour reconciliation.</h1>
            <p className="pg-app-header__sub">
              Upload both files, pick the client type, then narrow by consultant. Copy a summary or print a PDF per client.
            </p>
          </div>
        </div>

        {/* file inputs */}
        <div className="pg-grid-2">
          <FileCard title="ClickUp time export" hint="Full time-tracking export CSV from ClickUp (billable + non-billable rows)." file={clickup?.fileName} err={clickupErr} onClick={() => clickupInput.current?.click()} />
          <FileCard title="Accrued Hours report" hint="Master accrued/package spreadsheet (.xlsx)." file={accrued?.fileName} err={accruedErr} onClick={() => accruedInput.current?.click()} />
          <input ref={clickupInput} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleClickup(e.target.files?.[0])} />
          <input ref={accruedInput} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }} onChange={(e) => handleAccrued(e.target.files?.[0])} />
        </div>

        {/* live-sync status — the ClickUp side can auto-populate from a Supabase-scheduled
            sync instead of a manual upload; this shows which source is currently in play */}
        <div className="pg-panel" style={{ alignItems: "center" }}>
          {clickupSource === "manual" ? (
            <>
              <WifiOff size={14} style={{ color: "var(--fg-tertiary)" }} />
              <span style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Showing a manually uploaded file, overrides live sync until the next reload.</span>
            </>
          ) : syncMeta?.last_sync_status === "error" ? (
            <>
              <WifiOff size={14} style={{ color: "var(--status-warn)" }} />
              <span style={{ fontSize: 13, color: "var(--status-warn)" }}>Live sync not set up yet ({syncMeta.last_sync_message}). Upload a CSV below in the meantime.</span>
            </>
          ) : syncMeta?.last_synced_at ? (
            <>
              <Wifi size={14} style={{ color: "var(--status-ok)" }} />
              <span style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Live sync from ClickUp · last synced {timeAgo(syncMeta.last_synced_at)} · {syncMeta.rows_synced ?? "—"} entries</span>
            </>
          ) : (
            <>
              <WifiOff size={14} style={{ color: "var(--fg-tertiary)" }} />
              <span style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Live sync hasn't run yet.</span>
            </>
          )}
          <button className="pg-btn-ghost" style={{ marginLeft: "auto" }} onClick={handleManualSync} disabled={syncing}>
            <RefreshCw size={12} style={syncing ? { animation: "pg-spin 1s linear infinite" } : undefined} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {clickup?.warnings?.length > 0 && (
          <div className="pg-banner-warn">
            {clickup.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}
        {accrued?.warnings?.length > 0 && (
          <div className="pg-banner-warn">
            {accrued.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        {/* config row */}
        {ready && (
          <div className="pg-panel">
            {availableMonths.length > 1 && (
              <label className="pg-field pg-field--emphasis">
                <span className="pg-field__label">Reporting period</span>
                <select value={dataMonthKey} onChange={(e) => setDataMonthKey(e.target.value)}
                  className="pg-select" style={{ minWidth: 170 }}>
                  {availableMonths.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="pg-field">
              <span className="pg-field__label">Invoice month</span>
              <input value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} placeholder="e.g. July 2026"
                className="pg-input" style={{ width: 160 }} />
            </label>
            <label className="pg-field">
              <span className="pg-field__label">Prior balance from</span>
              <select value={priorMonthKey} onChange={(e) => setPriorMonthKey(e.target.value)}
                className="pg-select" style={{ minWidth: 180 }}>
                {accrued.balanceCols.map((bc) => (
                  <option key={monthKey(bc.year, bc.month)} value={monthKey(bc.year, bc.month)}>{bc.label}</option>
                ))}
              </select>
            </label>
            {clickup.hasBillable && (
              <label className="pg-checkbox-row">
                <input type="checkbox" checked={billableOnly} onChange={(e) => setBillableOnly(e.target.checked)} />
                billable only
              </label>
            )}
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <button onClick={() => setExportOpen((x) => !x)} className="pg-btn">
                <Download size={14} /> Export <ChevronDown size={12} />
              </button>
              {exportOpen && (
                <div className="pg-menu">
                  <ExportItem icon={<FileText size={14} />} label="Pending hours (CSV)" onClick={() => doExport("pending", "csv")} />
                  <ExportItem icon={<FileSpreadsheet size={14} />} label="Pending hours (Excel)" onClick={() => doExport("pending", "xlsx")} />
                  <div className="pg-menu-sep" />
                  <ExportItem icon={<FileText size={14} />} label="Full monthly summary (CSV)" onClick={() => doExport("summary", "csv")} />
                  <ExportItem icon={<FileSpreadsheet size={14} />} label="Full monthly summary (Excel)" onClick={() => doExport("summary", "xlsx")} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* filter row: type, consultant, sort */}
        {ready && (
          <div className="pg-panel">
            <label className="pg-field pg-field--emphasis">
              <span className="pg-field__label">Client type</span>
              <select value={clientTypeFilter} onChange={(e) => setClientTypeFilter(e.target.value)}
                className="pg-select" style={{ minWidth: 260 }}>
                <option value="package">Clients on a Package ({typeCounts.package})</option>
                <option value="hourly">Clients on Hourly rate ({typeCounts.hourly})</option>
                <option value="quoted" disabled>Quoted Clients ({typeCounts.quoted}), coming later</option>
                <option value="queensland">Queensland Clients (prv) ({typeCounts.queensland})</option>
              </select>
            </label>
            <label className="pg-field">
              <span className="pg-field__label"><Users size={11} /> Consultant</span>
              <select value={consultantFilter} onChange={(e) => setConsultantFilter(e.target.value)}
                className="pg-select" style={{ minWidth: 200 }}
                disabled={!clickup?.hasUser}>
                <option value="">All consultants</option>
                {consultants.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="pg-field">
              <span className="pg-field__label"><ArrowUpDown size={11} /> Sort</span>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}
                className="pg-select" style={{ minWidth: 150 }}>
                <option value="risk">Risk</option>
                <option value="alpha">Alphabetical</option>
              </select>
            </label>
            <label className="pg-field" style={{ flex: 1, minWidth: 180 }}>
              <span className="pg-field__label"><Search size={11} /> Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a client" className="pg-input" />
            </label>
          </div>
        )}

        {/* mid-month pace banner — only shown when the reporting period is the current, still-open month */}
        {ready && monthProgress && (
          <div className="pg-banner-warn" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            Mid-month check: day {monthProgress.dayOfMonth} of {monthProgress.totalDays} ({fmt(monthProgress.pct, 0)}% of the month elapsed). Package figures below are hours worked so far this month, not a final total.
          </div>
        )}

        {/* stat strip */}
        {ready && (
          <div className="pg-panel" style={{ gap: 40 }}>
            <Stat value={fmt(stats.hrs)} label={`hours ${clickup.hasBillable && billableOnly ? "(billable) " : ""}${consultantFilter ? "by " + consultantFilter : "in view"}${monthProgress ? " so far" : ""}`} />
            <Stat value={stats.count} label={`${TYPE_LABELS[clientTypeFilter].toLowerCase()} in view`} />
            {clientTypeFilter === "package" && (
              <>
                <Stat value={stats.over} label="over +10% KPI" tone={stats.over > 0 ? "var(--status-over)" : undefined} />
                <Stat value={stats.under} label="accruing past −10%" tone={stats.under > 0 ? "var(--status-warn)" : undefined} />
              </>
            )}
            <div style={{ marginLeft: "auto", alignSelf: "center", textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-tertiary)" }}>
                {clickup.fileName} · {accrued.fileName}
              </div>
              {availableMonths.length === 1 && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-tertiary)", marginTop: 2 }}>
                  detected period: {availableMonths[0].label}
                </div>
              )}
            </div>
          </div>
        )}

        {/* excluded internal / non-client folders — transparency, not a warning */}
        {ready && excludedInternal.folders.length > 0 && (
          <div className="pg-panel" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span className="pg-tag pg-tag--muted">[excluded as internal / non-client]</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-tertiary)" }}>
                {fmt(excludedInternal.total)} h across {excludedInternal.folders.length} folder{excludedInternal.folders.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
              {excludedInternal.folders.map((f) => (
                <span key={f.folder} style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-secondary)" }}>
                  {f.folder} <span style={{ color: "var(--fg-tertiary)" }}>({fmt(f.hours)} h)</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* client cards */}
        {ready && (
          <div>
            {visible.map((c) => (
              <ClientCard
                key={c.name}
                client={c}
                priorMonthPretty={priorMonthPretty}
                monthProgress={monthProgress}
                hasUser={clickup.hasUser}
                clientTypeFilter={clientTypeFilter}
                consultantFilter={consultantFilter}
                accruedNames={accruedNames}
                usedAccruedNames={new Set(clients.filter((x) => x.matched).map((x) => x.accruedClient.name))}
                open={!!expanded[c.name]}
                onToggle={() => setExpanded((p) => ({ ...p, [c.name]: !p[c.name] }))}
                onSetMatch={(v) => setManualMatch(c.name, v)}
                onCopy={() => copySummary(c)}
                onPdf={() => downloadPdf(c)}
                copied={copied === c.name}
              />
            ))}
            {visible.length === 0 && (
              <div className="pg-empty">
                {clientTypeFilter === "quoted"
                  ? "Quoted clients aren't tracked here yet, this bucket is a placeholder."
                  : consultantFilter
                    ? `${consultantFilter} didn't work on any ${TYPE_LABELS[clientTypeFilter].toLowerCase()} this month.`
                    : `No ${TYPE_LABELS[clientTypeFilter].toLowerCase()} in this view.`}
              </div>
            )}
          </div>
        )}

        {ready && (
          <p className="pg-footnote">
            <b>Maths:</b> new balance = worked − package + prior · remaining = package − prior − worked · total accrued = worked + prior (signed).{" "}
            <b>Signs:</b> negative prior = client credit carried in; positive prior = over-used prior month.{" "}
            <b>Types:</b> matched to accrued sheet → Package; unmatched with (Qld) in name → Queensland; unmatched otherwise → Hourly rate.{" "}
            <b>Name matches</b> you set here are saved between sessions.
          </p>
        )}
      </div>
    </div>
  );
}

// ================================ subcomponents =============================
function FileCard({ title, hint, file, err, onClick }) {
  return (
    <button onClick={onClick} className={"pg-filecard" + (file ? " pg-filecard--filled" : "")}>
      <Upload size={16} className="pg-filecard__icon" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pg-filecard__title">{title}</div>
        <div className="pg-filecard__hint">{hint}</div>
        {file && <div className="pg-filecard__file">{file}</div>}
        {err && <div className="pg-filecard__err">{err}</div>}
      </div>
    </button>
  );
}
function Stat({ value, label, tone }) {
  return (
    <div>
      <div className="pg-stat__value" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="pg-stat__label">{label}</div>
    </div>
  );
}
function ExportItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="pg-menu-item">
      {icon}
      {label}
    </button>
  );
}

function ClientCard({ client: c, priorMonthPretty, monthProgress, hasUser, clientTypeFilter, consultantFilter, accruedNames, usedAccruedNames, open, onToggle, onSetMatch, onCopy, onPdf, copied }) {
  const isPackage = c.type === "package";
  const isQld = c.type === "queensland";

  const statusChip = () => {
    if (!isPackage) return null;
    if (c.pkg == null) return <span className="pg-tag pg-tag--muted">[no package on file]</span>;
    const m = {
      ok: { t: "on track", c: "var(--status-ok)" },
      over: { t: `over-serving by ${fmt(c.newBalance)} h`, c: "var(--status-over)" },
      under: { t: `accruing ${fmt(Math.abs(c.newBalance))} h`, c: "var(--status-warn)" },
    }[c.status];
    if (!m) return null;
    return <span className="pg-tag" style={{ color: m.c }}>[{m.t}]</span>;
  };

  const typeChip = () => <span className="pg-tag" style={{ color: TYPE_TONES[c.type] }}>[{TYPE_LABELS[c.type]}]</span>;

  const borderColor = isPackage
    ? (c.status === "over" ? "var(--status-over)" : c.status === "under" ? "var(--status-warn)" : "var(--status-ok)")
    : isQld ? "var(--status-info)" : "var(--accent-orchid)";

  const consultantEntries = [...c.userMinutes.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="pg-client" style={{ borderLeftColor: borderColor }}>
      <div className="pg-client__row">
        <button onClick={onToggle} className="pg-client__name" aria-expanded={open}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {c.displayName}
        </button>
        {c.matched && c.accruedClient.name !== c.name && (
          <span className="pg-client__linked">
            <Link2 size={12} /> ClickUp: {c.name}
            {c.matchInfo && c.matchInfo.confidence < 1 && (
              <span className="pg-tag" style={{ color: "var(--accent)" }}>{Math.round(c.matchInfo.confidence * 100)}%</span>
            )}
          </span>
        )}
        {typeChip()}
        {statusChip()}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onCopy} className="pg-btn-ghost">
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "copied" : "copy summary"}
          </button>
          <button onClick={onPdf} className="pg-btn">
            <Printer size={12} /> PDF
          </button>
        </div>
      </div>

      {!isPackage && (
        <div className="pg-alertbar" style={{ background: isQld ? "var(--status-info-soft)" : "var(--accent-soft)", color: isQld ? "var(--status-info)" : "var(--accent-orchid)" }}>
          <AlertTriangle size={13} />
          <span className="pg-alertbar__text">
            {isQld
              ? "Queensland (previously) client, not on the accrued sheet, no reconciliation."
              : "Hourly-rate client, no package on file. If this looks like a name mismatch, match it below."}
          </span>
          <select defaultValue="__none__" onChange={(e) => onSetMatch(e.target.value)}>
            <option value="__none__">Match to accrued client…</option>
            {accruedNames.map((n) => (
              <option key={n} value={n} disabled={usedAccruedNames.has(n)}>{n} {usedAccruedNames.has(n) ? "(taken)" : ""}</option>
            ))}
          </select>
        </div>
      )}
      {isPackage && c.matchInfo?.method === "manual" && (
        <div className="pg-manual-note">
          <span>Manual match set.</span>
          <button onClick={() => onSetMatch("__none__")}>clear</button>
        </div>
      )}

      {/* metrics */}
      {isPackage ? (
        <div className="pg-metrics">
          <Metric label={consultantFilter ? `Worked (by ${consultantFilter})` : "Worked this month"} value={`${fmt(c.workedFiltered)} h`} big />
          <Metric label="Package" value={c.pkg != null ? `${fmt(c.pkg)} h` : "—"} />
          <Metric
            label={c.priorBalance != null && c.priorBalance < 0 ? "Carried in" : c.priorBalance != null && c.priorBalance > 0 ? "Over-used prior" : "Prior balance"}
            value={c.priorBalance != null ? `${fmt(Math.abs(c.priorBalance))} h` : "—"}
            tone={c.priorBalance != null && c.priorBalance > 0 ? "var(--status-over)" : c.priorBalance != null && c.priorBalance < 0 ? "var(--status-ok)" : undefined}
            sub={priorMonthPretty ? `from ${priorMonthPretty}` : null}
            flag={c.priorMismatch ? {
              text: "mismatch identified",
              title: `Accrued sheet says ${fmt(c.priorMismatch.sheetValue)} h${priorMonthPretty ? ` for ${priorMonthPretty}` : ""}, but recalculating from the current ClickUp data for that month gives ${fmt(c.priorMismatch.recomputed)} h. Likely a ClickUp entry was edited after the sheet was last updated.`,
            } : null} />
          <Metric
            label={c.remaining != null && c.remaining < 0 ? "Over by" : "Remaining this month"}
            value={c.remaining != null ? `${fmt(Math.abs(c.remaining))} h` : "—"}
            tone={c.remaining != null && c.remaining < 0 ? "var(--status-over)" : c.remaining != null && c.remaining > 0 ? "var(--status-ok)" : undefined} />
        </div>
      ) : (
        <div className="pg-metrics pg-metrics--2">
          <Metric label={consultantFilter ? `Worked (by ${consultantFilter})` : "Worked this month"} value={`${fmt(c.workedFiltered)} h`} big />
          <Metric label="All consultants total" value={`${fmt(c.worked)} h`} sub={consultantFilter ? "regardless of filter" : null} />
        </div>
      )}

      {/* progress bar - package only */}
      {isPackage && c.pkg != null && c.pkg > 0 && (
        <PackageBar pkg={c.pkg} worked={c.worked} prior={c.priorBalance ?? 0} status={c.status} monthProgress={monthProgress} />
      )}

      {/* consultant summary — always visible */}
      {consultantEntries.length > 0 && (
        <div className="pg-consultants">
          <div className="pg-consultants__label"><Users size={11} /> Consultants involved</div>
          <div className="pg-consultants__list">
            {consultantEntries.map(([u, min]) => {
              const active = consultantFilter && u === consultantFilter;
              return (
                <span key={u || "unknown"} className={"pg-consultants__item" + (active ? " pg-consultants__item--active" : "")}>
                  {u || "—"} <span>({fmt(min / 60)} h)</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* expanded task table */}
      {open && (
        <div className="pg-table-wrap">
          <div className="pg-table-head">
            Tasks {consultantFilter ? `worked by ${consultantFilter}` : "worked this month"}
          </div>
          <table className="pg-table">
            <thead>
              <tr>
                <th>Task</th>
                {hasUser && <th>Logged by</th>}
                <th className="right num" style={{ width: 110 }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {[...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1]).map(([task, min]) => (
                <tr key={task}>
                  <td>{task}</td>
                  {hasUser && <td>{formatTaskUsers(c.taskUsersFiltered?.get(task))}</td>}
                  <td className="right num">{fmt(min / 60)}</td>
                </tr>
              ))}
              {c.tasksFiltered.size === 0 && (
                <tr><td colSpan={hasUser ? 3 : 2} className="empty">No tasks in this filter.</td></tr>
              )}
              <tr className="total">
                <td>Total</td>
                {hasUser && <td></td>}
                <td className="right num">{fmt(c.workedFiltered)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone, big, flag }) {
  return (
    <div>
      <div className="pg-metric__label">{label}</div>
      <div className={"pg-metric__value" + (big ? " pg-metric__value--big" : "")} style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="pg-metric__sub">{sub}</div>}
      {flag && (
        <div className="pg-metric__flag" title={flag.title}>
          <AlertTriangle size={11} />
          {flag.text}
        </div>
      )}
    </div>
  );
}

// A 15-point cushion between "% of package used" and "% of month elapsed" before
// calling it ahead/behind pace — small day-to-day swings shouldn't flip the label.
const PACE_MARGIN = 15;
function paceStatus(usagePct, elapsedPct) {
  if (usagePct == null || elapsedPct == null) return null;
  const diff = usagePct - elapsedPct;
  if (diff > PACE_MARGIN) return { label: "trending over pace", tone: "var(--status-over)" };
  if (diff < -PACE_MARGIN) return { label: "trending under pace", tone: "var(--status-warn)" };
  return { label: "on pace", tone: "var(--status-ok)" };
}

function PackageBar({ pkg, worked, prior, status, monthProgress }) {
  const effective = pkg - prior;
  const max = Math.max(worked, effective, pkg) * 1.15;
  const workedPct = Math.max(0, Math.min(100, (worked / max) * 100));
  const pkgPct = (pkg / max) * 100;
  const effPct = (effective / max) * 100;
  const barColor = status === "over" ? "var(--status-over)" : status === "under" ? "var(--status-warn)" : "var(--status-ok)";
  const usagePct = effective > 0 ? (worked / effective) * 100 : null;
  const pace = monthProgress ? paceStatus(usagePct, monthProgress.pct) : null;
  return (
    <div>
      <div className="pg-bar-track">
        <div className="pg-bar-fill" style={{ width: `${workedPct}%`, background: barColor }} />
        <div className="pg-bar-mark" style={{ left: `${pkgPct}%` }} />
        {Math.abs(effective - pkg) > 0.01 && (
          <div className="pg-bar-mark pg-bar-mark--accent" style={{ left: `${effPct}%` }} />
        )}
      </div>
      <div className="pg-bar-caption">
        <span>worked {fmt(worked)} h</span>
        <span>package {fmt(pkg)} h{Math.abs(effective - pkg) > 0.01 && <> · adjusted {fmt(effective)} h</>}</span>
      </div>
      {pace && (
        <div className="pg-bar-caption" style={{ marginTop: 2 }}>
          <span>{fmt(usagePct, 0)}% of package used · {fmt(monthProgress.pct, 0)}% of month elapsed</span>
          <span style={{ color: pace.tone }}>{pace.label}</span>
        </div>
      )}
    </div>
  );
}
