// Bridges the pginvoice_accruals table into the same client/month/comment shape
// the Client Accruals module renders, and provides the manual-upload fallback
// parser + the matching xlsx exporter — mirrors the clickupSync.js pattern.
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { fetchClickupFromSupabase } from "./clickupSync.js";
import { findMatch, isInternalFolder } from "./nameMatch.js";

const PAGE_SIZE = 1000;

// First number in strings like "24 (Aug)" or "8 (increased to 10 Aug)" — the same
// convention parseAccruedWorkbook in App.jsx already uses for the package figure.
export function parseAgreedHours(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const m = String(raw).match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function monthKeyOf(year, month) { return `${year}-${String(month + 1).padStart(2, "0")}`; }
export function currentMonthKey() {
  const d = new Date();
  return monthKeyOf(d.getFullYear(), d.getMonth());
}
export function monthLabelOf(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}
export function shiftMonthKey(key, delta) {
  const [y, m] = key.split("-").map(Number); // m is 1-12
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

export async function fetchAccrualsFromSupabase() {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("pginvoice_accruals")
      .select("client, account_manager, agreed_hpm, month_key, accrual_value, accrual_note, pct_over_under, comment, worked_hours, is_override")
      .order("client", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  if (!all.length) return null;
  return rowsToClients(all);
}

function rowsToClients(rows) {
  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.client)) {
      byClient.set(r.client, { client: r.client, manager: r.account_manager || null, agreedHpm: r.agreed_hpm || null, months: {} });
    }
    const c = byClient.get(r.client);
    if (r.account_manager) c.manager = r.account_manager;
    if (r.agreed_hpm) c.agreedHpm = r.agreed_hpm;
    c.months[r.month_key] = {
      accrualValue: r.accrual_value === null ? null : Number(r.accrual_value),
      accrualNote: r.accrual_note || null,
      pct: r.pct_over_under === null ? null : Number(r.pct_over_under),
      comment: r.comment || null,
      workedHours: r.worked_hours === null || r.worked_hours === undefined ? null : Number(r.worked_hours),
      isOverride: !!r.is_override,
    };
  }
  return [...byClient.values()].sort((a, b) => a.client.localeCompare(b.client));
}

// Upserts a single client/month cell (used when the user edits a comment or accrual
// value in the Client Accruals module). Pass is_override: true whenever a human is
// setting the accrual value directly — recomputeAccruals then treats that month as a
// fixed baseline instead of something to keep recalculating from ClickUp hours.
export async function upsertAccrualCell(client, monthKey, patch, extra = {}) {
  const row = {
    client,
    month_key: monthKey,
    account_manager: extra.manager ?? null,
    agreed_hpm: extra.agreedHpm ?? null,
    ...patch,
  };
  const { error } = await supabase.from("pginvoice_accruals").upsert(row, { onConflict: "client,month_key" });
  if (error) throw error;
}

export async function upsertAccrualRows(rows) {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("pginvoice_accruals").upsert(chunk, { onConflict: "client,month_key" });
    if (error) throw error;
  }
}

// -------------------------- manual-upload fallback parser --------------------------
// Reads the same "Accrued Hours" workbook the user maintains by hand: a client column,
// an "Agreed h.p.m" column, then repeating month triplets (a date/label header, an
// optional "% over/under" header, and an optional "Comments" header). Rows whose second
// column literally reads "Agreed h.p.m" are account-manager separators, not clients.
export function parseAccrualsWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /accrued/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  let headerIdx = rows.findIndex((r) => r && ((r[0] && /client/i.test(String(r[0]))) || (r[1] && /agreed/i.test(String(r[1])))));
  if (headerIdx < 0) headerIdx = 2;
  const header = rows[headerIdx] || [];

  const monthCols = []; // { col, monthKey, pctCol, commentCol }
  for (let c = 2; c < header.length; c++) {
    const mk = headerToMonthKey(header[c]);
    if (!mk) continue;
    let pctCol = null, commentCol = null;
    for (let look = c + 1; look <= c + 3 && look < header.length; look++) {
      if (headerToMonthKey(header[look])) break; // next month column — stop looking
      const h = header[look] ? String(header[look]) : "";
      if (!commentCol && /comment/i.test(h)) commentCol = look;
      else if (!pctCol && /%|over|under/i.test(h)) pctCol = look;
    }
    monthCols.push({ col: c, monthKey: mk, pctCol, commentCol });
  }

  const clients = [];
  const warnings = [];
  let manager = null;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = row[0];
    const pkgRaw = row[1];
    if (!name || typeof name !== "string" || !name.trim()) continue;
    if (typeof pkgRaw === "string" && /agreed\s*h\.?p\.?m/i.test(pkgRaw)) { manager = name.trim(); continue; }

    const agreedHpm = pkgRaw === null || pkgRaw === undefined ? null : String(pkgRaw);
    const months = {};
    let hasAny = false;
    for (const mc of monthCols) {
      const raw = row[mc.col];
      const comment = mc.commentCol !== null ? row[mc.commentCol] : null;
      const pct = mc.pctCol !== null ? row[mc.pctCol] : null;
      if (raw === null && comment === null && pct === null) continue;
      hasAny = true;
      months[mc.monthKey] = {
        accrualValue: typeof raw === "number" ? raw : null,
        accrualNote: typeof raw === "string" ? raw : null,
        pct: typeof pct === "number" ? pct : null,
        comment: comment ? String(comment) : null,
        workedHours: null,
        isOverride: true,
      };
    }
    if (!hasAny && agreedHpm === null) continue;
    clients.push({ client: name.trim(), manager, agreedHpm, months });
  }

  if (!clients.length) warnings.push("No client rows were found — check this is the Accrued Hours workbook.");
  return { clients, monthKeys: monthCols.map((m) => m.monthKey), sheetName, warnings };
}

function headerToMonthKey(cell) {
  if (cell instanceof Date) return monthKeyOf(cell.getFullYear(), cell.getMonth());
  if (typeof cell === "string") {
    const m = cell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return monthKeyOf(parseInt(m[3], 10), parseInt(m[2], 10) - 1);
  }
  return null;
}

// Flattens the client-list shape back into (client, month_key) rows for Supabase upserts.
// A manual workbook upload represents a human's authoritative figure for that month, so
// it's flagged as an override — recomputeAccruals below will never overwrite it.
export function clientsToRows(clients) {
  const out = [];
  for (const c of clients) {
    for (const [mk, cell] of Object.entries(c.months)) {
      out.push({
        client: c.client,
        account_manager: c.manager || null,
        agreed_hpm: c.agreedHpm || null,
        month_key: mk,
        accrual_value: cell.accrualValue ?? null,
        accrual_note: cell.accrualNote ?? null,
        pct_over_under: cell.pct ?? null,
        comment: cell.comment ?? null,
        worked_hours: cell.workedHours ?? null,
        is_override: true,
      });
    }
  }
  return out;
}

// -------------------------- auto-compute from live ClickUp hours --------------------------
// Chains newBalance = worked - agreedHours + prior forward from the latest month already
// on file for each client, through the current month — the same formula Client Invoicing
// already uses to reconcile the accrued sheet against ClickUp. Only fills months that don't
// exist yet or were previously computed (never touches a human-entered/overridden month),
// so one-off adjustments (payouts, write-offs, etc.) recorded by hand are never clobbered.
export async function recomputeAccruals(clients) {
  const live = await fetchClickupFromSupabase();
  if (!live) return { clients, updatedCount: 0 };

  const workedByFolderMonth = new Map(); // folder -> Map(monthKey -> minutes)
  for (const r of live.rows) {
    if (isInternalFolder(r.folder)) continue;
    if (live.hasBillable && !r.billable) continue;
    if (!r.monthKey) continue;
    if (!workedByFolderMonth.has(r.folder)) workedByFolderMonth.set(r.folder, new Map());
    const m = workedByFolderMonth.get(r.folder);
    m.set(r.monthKey, (m.get(r.monthKey) || 0) + r.minutes);
  }
  const folderNames = [...workedByFolderMonth.keys()];
  const cur = currentMonthKey();
  const updatedRows = [];
  const nextClients = clients.map((c) => ({ ...c, months: { ...c.months } }));

  for (const c of nextClients) {
    const agreedNum = parseAgreedHours(c.agreedHpm);
    if (agreedNum === null) continue;
    const match = findMatch(c.client, folderNames);
    const folderMinutes = match ? workedByFolderMonth.get(match.name) : null;

    const existingMonths = Object.keys(c.months).sort();
    const lastMonth = existingMonths.length ? existingMonths[existingMonths.length - 1] : shiftMonthKey(cur, -1);
    let prior = existingMonths.length ? (c.months[lastMonth].accrualValue ?? 0) : 0;

    let mk = shiftMonthKey(lastMonth, 1);
    while (mk <= cur) {
      const existing = c.months[mk];
      if (!existing || !existing.isOverride) {
        const worked = (folderMinutes?.get(mk) || 0) / 60;
        const accrualValue = Math.round((worked - agreedNum + prior) * 100) / 100;
        const pct = agreedNum ? Math.round((accrualValue / agreedNum) * 10000) / 10000 : null;
        const workedHours = Math.round(worked * 100) / 100;
        const cell = { accrualValue, accrualNote: null, pct, comment: existing?.comment ?? null, workedHours, isOverride: false };
        c.months[mk] = cell;
        updatedRows.push({
          client: c.client, account_manager: c.manager || null, agreed_hpm: c.agreedHpm || null,
          month_key: mk, accrual_value: accrualValue, accrual_note: null, pct_over_under: pct,
          comment: cell.comment, worked_hours: workedHours, is_override: false,
        });
        prior = accrualValue;
      } else {
        prior = existing.accrualValue ?? prior;
      }
      mk = shiftMonthKey(mk, 1);
    }
  }

  if (updatedRows.length) await upsertAccrualRows(updatedRows);
  return { clients: nextClients, updatedCount: updatedRows.length };
}

// -------------------------- export, same layout as the source sheet --------------------------
export function exportAccrualsWorkbook(clients, monthKeys, fileLabel) {
  const header = ["Client", "Agreed h.p.m"];
  for (const mk of monthKeys) header.push(`Worked hrs (${monthLabelOf(mk)})`, monthLabelOf(mk) + " Accrued", "% over/under hours", `Comments (${monthLabelOf(mk)})`);
  const aoa = [["PG Weekly Hours Summary (Accumulative Total)"], [], header];
  for (const c of clients) {
    const row = [c.client, c.agreedHpm ?? ""];
    for (const mk of monthKeys) {
      const cell = c.months[mk] || {};
      row.push(cell.workedHours ?? "", cell.accrualValue ?? cell.accrualNote ?? "", cell.pct ?? "", cell.comment ?? "");
    }
    aoa.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, { wch: 12 }, ...monthKeys.flatMap(() => [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 40 }])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Accrued Hours");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${fileLabel || "client-accruals"}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
