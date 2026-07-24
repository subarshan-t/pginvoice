// Bridges the pginvoice_accruals table into the same client/month/comment shape
// the Client Accruals module renders, and provides the manual-upload fallback
// parser + the matching xlsx exporter — mirrors the clickupSync.js pattern.
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient.js";
import { fetchClickupFromSupabase } from "./clickupSync.js";
import { findMatch, isInternalFolder } from "./nameMatch.js";
import { fetchClients, fetchClientEvents, typeForMonth } from "./clientsSync.js";

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
      .select("client, account_manager, agreed_hpm, month_key, accrual_value, accrual_note, pct_over_under, comment, worked_hours, is_override, hours_flagged")
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
      hoursFlagged: !!r.hours_flagged,
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

// -------------------------- auto-compute from live ClickUp hours --------------------------
// Chains newBalance = worked - agreedHours + prior forward, replaying every non-override
// month from each client's earliest month on file through the current one (not just gap-
// filling forward) — because a retroactive ClickUp edit to an earlier closed month changes
// that month's "prior" for everything after it. Only clients on a package that month (per
// the Clients module's type history) accrue at all; a human-entered month (is_override) is
// a frozen baseline the chain treats as fact and never recalculates. If a past, already-
// closed month's freshly-computed worked hours differ from what's stored, the row is
// updated but flagged (hours_flagged) so a retroactive timesheet edit is visible rather than
// silently changing the numbers underneath everyone.
export async function recomputeAccruals(clients) {
  const [live, profiles, events] = await Promise.all([fetchClickupFromSupabase(), fetchClients(), fetchClientEvents()]);
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
  const profileByClient = new Map(profiles.map((p) => [p.client, p]));
  const cur = currentMonthKey();
  const updatedRows = [];
  const nextClients = clients.map((c) => ({ ...c, months: { ...c.months } }));

  for (const c of nextClients) {
    const profile = profileByClient.get(c.client);
    if (!profile) continue; // no client profile on file — nothing to compute against
    const match = findMatch(c.client, folderNames);
    const folderMinutes = match ? workedByFolderMonth.get(match.name) : null;

    const existingMonths = Object.keys(c.months).sort();
    const startMonth = existingMonths.length ? existingMonths[0] : (profile.startDate ? profile.startDate.slice(0, 7) : cur);

    let prior = 0;
    let mk = startMonth;
    let guard = 0;
    while (mk <= cur && guard++ < 240) {
      const seg = typeForMonth(profile, events, mk);
      if (seg.type !== "package" || seg.agreedHours === null) { mk = shiftMonthKey(mk, 1); continue; }
      const agreedNum = Number(seg.agreedHours);

      const existing = c.months[mk];
      if (existing?.isOverride) {
        prior = existing.accrualValue ?? prior;
      } else {
        const worked = (folderMinutes?.get(mk) || 0) / 60;
        const workedHours = Math.round(worked * 100) / 100;
        const accrualValue = Math.round((worked - agreedNum + prior) * 100) / 100;
        const pct = agreedNum ? Math.round((accrualValue / agreedNum) * 10000) / 10000 : null;
        const isClosedMonth = mk < cur;
        const hoursFlagged = isClosedMonth && existing?.workedHours != null && Math.abs(existing.workedHours - workedHours) > 0.01;
        const cell = { accrualValue, accrualNote: null, pct, comment: existing?.comment ?? null, workedHours, isOverride: false, hoursFlagged };
        const changed = !existing || existing.accrualValue !== accrualValue || existing.workedHours !== workedHours;
        c.months[mk] = cell;
        if (changed) {
          updatedRows.push({
            client: c.client, account_manager: c.manager || null, agreed_hpm: c.agreedHpm || null,
            month_key: mk, accrual_value: accrualValue, accrual_note: null, pct_over_under: pct,
            comment: cell.comment, worked_hours: workedHours, is_override: false, hours_flagged: hoursFlagged,
          });
        }
        prior = accrualValue;
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
