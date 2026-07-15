import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload, Copy, Check, ChevronDown, ChevronUp, Download, Search,
  AlertTriangle, Link2, FileSpreadsheet, FileText, Printer, Users, ArrowUpDown,
} from "lucide-react";
import { LETTERHEAD_FOOTER_B64 } from "./letterheadFooter.js";

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

// ------------------------------ name matching --------------------------------
function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(s) { return normalizeName(s).split(" ").filter((t) => t.length > 1); }
function tokenSim(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function findMatch(clickupName, accruedNames) {
  const norm = normalizeName(clickupName);
  for (const a of accruedNames) if (normalizeName(a) === norm) return { name: a, confidence: 1, method: "exact" };
  for (const a of accruedNames) {
    const na = normalizeName(a);
    if (na && (norm.includes(na) || na.includes(norm))) return { name: a, confidence: 0.85, method: "substring" };
  }
  let best = null;
  for (const a of accruedNames) {
    const sim = tokenSim(clickupName, a);
    if (sim > (best?.confidence ?? 0)) best = { name: a, confidence: sim, method: "tokens" };
  }
  if (best && best.confidence >= 0.5) return best;
  return null;
}

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

// ------------------------------ accrued parser -------------------------------
function parseAccruedWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /accrued/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  let headerIdx = rows.findIndex((r) => r && ((r[0] && /client/i.test(String(r[0]))) || (r[1] && /agreed/i.test(String(r[1])))));
  if (headerIdx < 0) headerIdx = 2;
  const header = rows[headerIdx] || [];

  const balanceCols = [];
  let contextYear = null;
  for (let c = 2; c < header.length; c++) {
    const m = parseHeaderToMonth(header[c], contextYear);
    if (m) { balanceCols.push({ col: c, ...m }); contextYear = m.year; }
  }

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
  return { clients, balanceCols, sheetName };
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
      const hTimeNum = findHeader(headers, "Time Tracked");
      const hBillable = findHeader(headers, "Billable");
      const hUser = findHeader(headers, "Username");
      if (!hFolder) { onErr("Couldn't find a \"Folder Name\" column. This should be the ClickUp billable time summary export."); return; }
      let zeroCount = 0;
      const rows = [];
      for (const r of result.data) {
        const folder = String(r[hFolder] || "").trim();
        if (SKIP_FOLDERS.has(folder.toLowerCase())) continue;
        let minutes = 0;
        if (hTimeText && r[hTimeText] !== undefined && String(r[hTimeText]).trim() !== "") minutes = parseTimeTextToMinutes(r[hTimeText]);
        else if (hTimeNum) minutes = msToMinutes(r[hTimeNum]);
        if (minutes === 0) zeroCount++;
        const billableRaw = hBillable ? String(r[hBillable] || "").trim().toLowerCase() : "";
        const billable = ["true", "yes", "1", "billable"].includes(billableRaw);
        rows.push({
          folder,
          task: hTask ? String(r[hTask] || "").trim() || "Untitled" : "Untitled",
          minutes, billable, hasBillableCol: !!hBillable,
          user: hUser ? String(r[hUser] || "").trim() : "",
        });
      }
      if (rows.length && zeroCount === rows.length) warnings.push("Every row parsed to zero hours — the ClickUp export format may have changed.");
      onDone({ rows, hasBillable: !!hBillable, hasUser: !!hUser, warnings });
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
const PRINT = { ink: "#1F1B24", inkSoft: "#6B6172", brand: "#3F008E", line: "#E7E1F0", brandSoft: "#F1EAFB" };

function buildPrintHtml(c, monthText, priorMonthText) {
  const type = c.type;
  const isPkg = type === "package";
  const taskRows = [...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1])
    .map(([task, min]) => `<tr><td>${esc(task)}</td><td class="right">${fmt(min / 60)}</td></tr>`).join("");
  const workedRounded = Math.round(c.workedFiltered * 100) / 100;
  const priorSigned = c.priorBalance ?? 0;
  const priorLabel = priorSigned < 0 ? "Carried in from previous month"
                    : priorSigned > 0 ? "Over-used in previous month"
                    : "Prior month balance";
  const priorAbs = Math.abs(priorSigned);
  const totalAccrued = workedRounded + priorSigned; // as spec'd: current spent + prior signed

  const reconciliation = isPkg ? `
    <div class="section">
      <h2>Reconciliation</h2>
      <table>
        <tr><td class="label">Package</td><td class="right">${fmt(c.pkg)} h / month</td></tr>
        <tr><td class="label">${priorLabel}${priorMonthText ? ` (${esc(priorMonthText)})` : ""}</td><td class="right">${fmt(priorAbs)} h</td></tr>
        <tr><td class="label">Time tracked this month</td><td class="right">${fmt(workedRounded)} h</td></tr>
        <tr class="total"><td>Total accrued time</td><td class="right">${fmt(totalAccrued)} h</td></tr>
        <tr><td class="label">New balance going forward</td><td class="right">${fmt(c.newBalance)} h ${c.newBalance > 0 ? "over" : c.newBalance < 0 ? "credit" : ""}</td></tr>
        <tr><td class="label">Remaining this month</td><td class="right">${c.remaining >= 0 ? fmt(c.remaining) + " h left" : fmt(Math.abs(c.remaining)) + " h over"}</td></tr>
      </table>
      <p class="note">Total accrued time = time tracked this month + prior balance (signed). Negative prior = client credit carried in; positive prior = over-served last month.</p>
    </div>` : `
    <div class="section">
      <h2>Summary</h2>
      <table>
        <tr><td class="label">Time tracked this month</td><td class="right">${fmt(workedRounded)} h</td></tr>
      </table>
      <p class="note">${type === "hourly" ? "Hourly-rate client — invoice at the agreed hourly rate for these hours." : "Queensland (previously) client — no accrued balance on record."}</p>
    </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${esc(c.displayName)} ${esc(monthText)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap');
  @page { margin: 18mm 18mm 34mm 18mm; size: A4; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: ${PRINT.ink}; margin: 0; padding: 20px; }
  .header { border-bottom: 2px solid ${PRINT.ink}; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { font-family: 'JetBrains Mono', monospace; color: ${PRINT.brand}; font-size: 10px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; }
  h1 { font-family: 'Playfair Display', Georgia, serif; font-weight: 600; font-size: 26px; margin: 6px 0 0; letter-spacing: -0.01em; }
  .subtitle { color: ${PRINT.inkSoft}; font-size: 14px; margin-top: 4px; }
  .section { margin-top: 22px; page-break-inside: avoid; }
  .section h2 { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: ${PRINT.brand}; margin: 0 0 10px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; }
  thead th { background: ${PRINT.brandSoft}; font-weight: 600; font-size: 12px; color: ${PRINT.ink}; border-bottom: 1px solid ${PRINT.line}; }
  tbody tr, table tr { border-bottom: 1px solid ${PRINT.line}; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 700; border-top: 2px solid ${PRINT.ink}; border-bottom: none; padding-top: 12px; }
  .label { color: ${PRINT.inkSoft}; }
  .note { margin-top: 10px; font-size: 11px; color: ${PRINT.inkSoft}; font-style: italic; }
  .generated-note { margin-top: 24px; font-size: 9px; color: ${PRINT.inkSoft}; text-align: right; font-style: italic; }
  .letterhead-footer {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    width: 100%;
    height: 26mm;
    background-image: url('data:image/jpeg;base64,${LETTERHEAD_FOOTER_B64}');
    background-repeat: no-repeat;
    background-position: bottom center;
    background-size: 100% auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style>
</head><body>
  <div class="header">
    <div class="brand">Purple Giraffe · client hours report</div>
    <h1>${esc(c.displayName)}</h1>
    <div class="subtitle">${esc(monthText)}</div>
  </div>

  <div class="section">
    <h2>Tasks worked this month</h2>
    <table>
      <thead><tr><th>Task</th><th class="right" style="width: 120px;">Time tracked (h)</th></tr></thead>
      <tbody>${taskRows || `<tr><td colspan="2" class="label">No tasks in this filter.</td></tr>`}
      <tr class="total"><td>Total</td><td class="right">${fmt(workedRounded)} h</td></tr>
      </tbody>
    </table>
  </div>

  ${reconciliation}

  <div class="generated-note">Generated ${esc(new Date().toLocaleString())}</div>

  <div class="letterhead-footer"></div>

  <script>window.addEventListener('load', function() { setTimeout(function() { window.print(); }, 300); });</script>
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

// ================================ COMPONENT =================================
export default function PGReconciliation() {
  const [clickup, setClickup] = useState(null);
  const [accrued, setAccrued] = useState(null);
  const [invoiceMonth, setInvoiceMonth] = useState("");
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAMEMAP_KEY);
      if (raw) setNameMap(JSON.parse(raw));
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!accrued) return;
    if (priorMonthKey && accrued.balanceCols.find((c) => monthKey(c.year, c.month) === priorMonthKey)) return;
    const last = accrued.balanceCols[accrued.balanceCols.length - 1];
    if (last) setPriorMonthKey(monthKey(last.year, last.month));
  }, [accrued]); // eslint-disable-line

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

  // per-client aggregation, WITHOUT consultant filter (this is the base data)
  const clients = useMemo(() => {
    if (!clickup) return [];
    const map = new Map();
    for (const r of clickup.rows) {
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (!map.has(r.folder))
        map.set(r.folder, { name: r.folder, totalMin: 0, tasksAll: new Map(), userMinutes: new Map(), tasksByUser: new Map() });
      const c = map.get(r.folder);
      c.totalMin += r.minutes;
      c.tasksAll.set(r.task, (c.tasksAll.get(r.task) || 0) + r.minutes);
      const u = r.user || "";
      c.userMinutes.set(u, (c.userMinutes.get(u) || 0) + r.minutes);
      if (!c.tasksByUser.has(u)) c.tasksByUser.set(u, new Map());
      const t = c.tasksByUser.get(u);
      t.set(r.task, (t.get(r.task) || 0) + r.minutes);
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
      const clientObj = {
        ...c, worked, accruedClient, matchInfo,
        pkg, priorBalance, newBalance, remaining, kpiPct, status,
        matched: !!accruedClient,
        displayName: accruedClient?.name ?? c.name,
      };
      clientObj.type = classifyClient(clientObj);
      out.push(clientObj);
    }
    return out;
  }, [clickup, accrued, accruedNames, nameMap, priorMonthKey, billableOnly]);

  // counts by type
  const typeCounts = useMemo(() => {
    const counts = { package: 0, hourly: 0, queensland: 0, quoted: 0 };
    for (const c of clients) counts[c.type] = (counts[c.type] || 0) + 1;
    return counts;
  }, [clients]);

  // consultant list from clickup rows (across all clients, all types)
  const consultants = useMemo(() => {
    if (!clickup) return [];
    const set = new Set();
    for (const r of clickup.rows) if (r.user) set.add(r.user);
    return [...set].sort();
  }, [clickup]);

  // filtered + sorted + consultant-scoped clients for display
  const visible = useMemo(() => {
    let list = clients.filter((c) => c.type === clientTypeFilter);
    if (consultantFilter) list = list.filter((c) => c.userMinutes.has(consultantFilter));
    // per-consultant task view: if filter set, use tasksByUser for that consultant; else all tasks
    list = list.map((c) => {
      const tasksFiltered = consultantFilter ? (c.tasksByUser.get(consultantFilter) || new Map()) : c.tasksAll;
      const workedFiltered = consultantFilter ? ((c.userMinutes.get(consultantFilter) || 0) / 60) : c.worked;
      return { ...c, tasksFiltered, workedFiltered };
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
    lines.push(`${c.displayName} — hours for ${monthText}`);
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
      if (c.status === "under") lines.push(`⚠ Under the −10% KPI (${fmt(c.kpiPct, 1)}% of package) — accruing`);
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
          <img src="/assets/giraffe-mark.png" alt="" className="pg-app-header__mark" />
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
          <FileCard title="ClickUp time export" hint="Billable time summary CSV from ClickUp." file={clickup?.fileName} err={clickupErr} onClick={() => clickupInput.current?.click()} />
          <FileCard title="Accrued Hours report" hint="Master accrued/package spreadsheet (.xlsx)." file={accrued?.fileName} err={accruedErr} onClick={() => accruedInput.current?.click()} />
          <input ref={clickupInput} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleClickup(e.target.files?.[0])} />
          <input ref={accruedInput} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }} onChange={(e) => handleAccrued(e.target.files?.[0])} />
        </div>

        {clickup?.warnings?.length > 0 && (
          <div className="pg-banner-warn">
            {clickup.warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        {/* config row */}
        {ready && (
          <div className="pg-panel">
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
                <option value="quoted" disabled>Quoted Clients ({typeCounts.quoted}) — coming later</option>
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

        {/* stat strip */}
        {ready && (
          <div className="pg-panel" style={{ gap: 40 }}>
            <Stat value={fmt(stats.hrs)} label={`hours ${clickup.hasBillable && billableOnly ? "(billable) " : ""}${consultantFilter ? "by " + consultantFilter : "in view"}`} />
            <Stat value={stats.count} label={`${TYPE_LABELS[clientTypeFilter].toLowerCase()} in view`} />
            {clientTypeFilter === "package" && (
              <>
                <Stat value={stats.over} label="over +10% KPI" tone={stats.over > 0 ? "var(--status-over)" : undefined} />
                <Stat value={stats.under} label="accruing past −10%" tone={stats.under > 0 ? "var(--status-warn)" : undefined} />
              </>
            )}
            <div style={{ marginLeft: "auto", alignSelf: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-tertiary)" }}>
              {clickup.fileName} · {accrued.fileName}
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
                  ? "Quoted clients aren't tracked here yet — this bucket is a placeholder."
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

function ClientCard({ client: c, priorMonthPretty, clientTypeFilter, consultantFilter, accruedNames, usedAccruedNames, open, onToggle, onSetMatch, onCopy, onPdf, copied }) {
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
              ? "Queensland (previously) client — not on the accrued sheet, no reconciliation."
              : "Hourly-rate client — no package on file. If this looks like a name mismatch, match it below."}
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
            sub={priorMonthPretty ? `from ${priorMonthPretty}` : null} />
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
        <PackageBar pkg={c.pkg} worked={c.worked} prior={c.priorBalance ?? 0} status={c.status} />
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
                <th className="right num" style={{ width: 110 }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {[...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1]).map(([task, min]) => (
                <tr key={task}>
                  <td>{task}</td>
                  <td className="right num">{fmt(min / 60)}</td>
                </tr>
              ))}
              {c.tasksFiltered.size === 0 && (
                <tr><td colSpan={2} className="empty">No tasks in this filter.</td></tr>
              )}
              <tr className="total">
                <td>Total</td>
                <td className="right num">{fmt(c.workedFiltered)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone, big }) {
  return (
    <div>
      <div className="pg-metric__label">{label}</div>
      <div className={"pg-metric__value" + (big ? " pg-metric__value--big" : "")} style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="pg-metric__sub">{sub}</div>}
    </div>
  );
}

function PackageBar({ pkg, worked, prior, status }) {
  const effective = pkg - prior;
  const max = Math.max(worked, effective, pkg) * 1.15;
  const workedPct = Math.max(0, Math.min(100, (worked / max) * 100));
  const pkgPct = (pkg / max) * 100;
  const effPct = (effective / max) * 100;
  const barColor = status === "over" ? "var(--status-over)" : status === "under" ? "var(--status-warn)" : "var(--status-ok)";
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
    </div>
  );
}
