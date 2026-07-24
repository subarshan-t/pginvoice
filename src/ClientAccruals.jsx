import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Download, RefreshCw, ChevronLeft, ChevronRight, Upload, Pencil } from "lucide-react";
import {
  fetchAccrualsFromSupabase, parseAccrualsWorkbook, clientsToRows, upsertAccrualCell,
  upsertAccrualRows, recomputeAccruals, exportAccrualsWorkbook, currentMonthKey,
  monthLabelOf, shiftMonthKey, parseAgreedHours,
} from "./accrualsSync.js";

function monthRange(start, end) {
  const out = [];
  let k = start;
  let guard = 0;
  while (guard++ < 240) {
    out.push(k);
    if (k === end) break;
    k = shiftMonthKey(k, 1);
  }
  return out;
}

const fmt = (n) => (typeof n === "number" ? (Math.round(n * 100) / 100).toLocaleString() : "—");

export default function ClientAccruals() {
  const [clients, setClients] = useState(null); // null = not loaded yet
  const [source, setSource] = useState(null); // "supabase" | "manual"
  const [loadError, setLoadError] = useState(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState(null);
  const [search, setSearch] = useState("");
  const [rangeMode, setRangeMode] = useState("month"); // "month" | "range"
  const [month, setMonth] = useState(currentMonthKey());
  const [rangeStart, setRangeStart] = useState(shiftMonthKey(currentMonthKey(), -2));
  const [rangeEnd, setRangeEnd] = useState(currentMonthKey());
  const [showAll, setShowAll] = useState(false); // false = only clients with an accrual in the visible months
  const [signFilter, setSignFilter] = useState("all"); // "all" | "positive" | "negative"
  const [editingCell, setEditingCell] = useState(null); // "client|monthKey|field"
  const [draftValue, setDraftValue] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const manualOverrideRef = useRef(false);
  const autoRecomputedRef = useRef(false);

  useEffect(() => {
    fetchAccrualsFromSupabase()
      .then(async (data) => {
        if (manualOverrideRef.current) return;
        if (data) {
          setClients(data);
          setSource("supabase");
          // Fill in any months missing since the sheet was last updated (e.g. the
          // current month) from live ClickUp hours, so they show real numbers
          // instead of a blank row the first time anyone opens this module.
          if (!autoRecomputedRef.current) {
            autoRecomputedRef.current = true;
            try {
              const { clients: next, updatedCount } = await recomputeAccruals(data);
              if (!manualOverrideRef.current && updatedCount) setClients(next);
            } catch (e) { /* best-effort — leave whatever loaded from Supabase */ }
          }
        } else { setClients([]); setSource(null); }
      })
      .catch((e) => { if (!manualOverrideRef.current) setLoadError(e.message || String(e)); setClients((c) => c ?? []); });
  }, []);

  const months = rangeMode === "month" ? [month] : monthRange(rangeStart, rangeEnd);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (q && !c.client.toLowerCase().includes(q) && !(c.manager || "").toLowerCase().includes(q)) return false;
      const values = months.map((mk) => c.months[mk]?.accrualValue).filter((v) => typeof v === "number" && v !== 0);
      if (!showAll && values.length === 0) return false;
      if (signFilter === "positive" && !values.some((v) => v > 0)) return false;
      if (signFilter === "negative" && !values.some((v) => v < 0)) return false;
      return true;
    });
  }, [clients, search, month, rangeStart, rangeEnd, rangeMode, showAll, signFilter]);

  async function handleUpload(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    try {
      const parsed = parseAccrualsWorkbook(buf);
      manualOverrideRef.current = true;
      setClients(parsed.clients);
      setSource("manual");
      setLoadError(null);
      // Populate Supabase from the upload too, so the sheet stays the source of truth
      // for the live module even before anyone edits a comment in-app.
      upsertAccrualRows(clientsToRows(parsed.clients)).catch((e) => setLoadError("Parsed the file, but couldn't sync it to Supabase: " + (e.message || e)));
    } catch (e) {
      setLoadError("Couldn't read that workbook: " + (e.message || e));
    }
  }

  async function runRecompute() {
    if (!clients) return;
    setRecomputing(true);
    setRecomputeMsg(null);
    try {
      const { clients: next, updatedCount } = await recomputeAccruals(clients);
      setClients(next);
      setRecomputeMsg(updatedCount ? `Filled in ${updatedCount} month${updatedCount === 1 ? "" : "s"} from ClickUp hours.` : "Everything is already up to date.");
    } catch (e) {
      setLoadError("Couldn't recompute from ClickUp: " + (e.message || e));
    } finally {
      setRecomputing(false);
    }
  }

  async function saveCell(client, monthKey, field) {
    setSaving(true);
    try {
      const existing = client.months[monthKey] || { accrualValue: null, accrualNote: null, pct: null, comment: null, workedHours: null, isOverride: false };
      let patch, nextCell;
      if (field === "comment") {
        patch = { comment: draftValue || null };
        nextCell = { ...existing, comment: draftValue || null };
      } else {
        const num = draftValue.trim() === "" ? null : Number(draftValue);
        if (draftValue.trim() !== "" && Number.isNaN(num)) throw new Error("That's not a number.");
        const agreedNum = parseAgreedHours(client.agreedHpm);
        const pct = num !== null && agreedNum ? num / agreedNum : existing.pct;
        patch = { accrual_value: num, accrual_note: null, pct_over_under: pct, is_override: true };
        nextCell = { ...existing, accrualValue: num, accrualNote: null, pct, isOverride: true };
      }
      await upsertAccrualCell(client.client, monthKey, patch, { manager: client.manager, agreedHpm: client.agreedHpm });
      setClients((prev) => prev.map((c) => (c.client !== client.client ? c : { ...c, months: { ...c.months, [monthKey]: nextCell } })));
      setEditingCell(null);
    } catch (e) {
      setLoadError("Couldn't save that: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  function exportRange() {
    exportAccrualsWorkbook(filtered, months, `client-accruals-${months[0]}_to_${months[months.length - 1]}`);
  }

  if (clients === null) return <div className="pg-cap-container"><div className="pg-empty">Loading…</div></div>;

  return (
    <div className="pg-cap-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">Client Accruals</h1>
          <p className="pg-app-header__sub">Agreed hours, hours worked, and running accrual per client, synced with Supabase. New months compute automatically from ClickUp hours unless a figure has been entered by hand.</p>
        </div>
      </div>

      {loadError && <div className="pg-banner-warn">{loadError}</div>}
      {recomputeMsg && <div className="pg-banner-warn" style={{ borderColor: "var(--status-ok)" }}>{recomputeMsg}</div>}
      {!clients.length && (
        <div className="pg-panel" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <div>No accrual data in Supabase yet. Upload the Accrued Hours workbook to populate it.</div>
          <button className="pg-btn" onClick={() => fileInput.current?.click()}><Upload size={14} /> Upload workbook</button>
        </div>
      )}
      <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }} onChange={(e) => handleUpload(e.target.files?.[0])} />

      <div className="pg-panel" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <label className="pg-field" style={{ width: 240 }}>
          <span className="pg-field__label"><Search size={11} /> Client</span>
          <input className="pg-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" />
        </label>

        <label className="pg-field">
          <span className="pg-field__label">Range</span>
          <select className="pg-input" value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}>
            <option value="month">By Month</option>
            <option value="range">By Month Range</option>
          </select>
        </label>

        {rangeMode === "month" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button className="pg-btn-ghost" onClick={() => setMonth((m) => shiftMonthKey(m, -1))}><ChevronLeft size={13} /></button>
            <span className="pg-tag">{monthLabelOf(month)}</span>
            <button className="pg-btn-ghost" onClick={() => setMonth((m) => shiftMonthKey(m, 1))}><ChevronRight size={13} /></button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="pg-field__label">Start</span>
              <button className="pg-btn-ghost" onClick={() => setRangeStart((m) => shiftMonthKey(m, -1))}><ChevronLeft size={13} /></button>
              <span className="pg-tag">{monthLabelOf(rangeStart)}</span>
              <button className="pg-btn-ghost" onClick={() => setRangeStart((m) => shiftMonthKey(m, 1))}><ChevronRight size={13} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span className="pg-field__label">End</span>
              <button className="pg-btn-ghost" onClick={() => setRangeEnd((m) => shiftMonthKey(m, -1))}><ChevronLeft size={13} /></button>
              <span className="pg-tag">{monthLabelOf(rangeEnd)}</span>
              <button className="pg-btn-ghost" onClick={() => setRangeEnd((m) => shiftMonthKey(m, 1))}><ChevronRight size={13} /></button>
            </div>
          </>
        )}

        <label className="pg-field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <span className="pg-field__label" style={{ margin: 0 }}>Select all clients</span>
        </label>

        <label className="pg-field">
          <span className="pg-field__label">Accrual sign</span>
          <select className="pg-input" value={signFilter} onChange={(e) => setSignFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="positive">Positive only</option>
            <option value="negative">Negative only</option>
          </select>
        </label>

        <button className="pg-btn-ghost" onClick={() => fileInput.current?.click()}><Upload size={14} /> Upload</button>
        <button className="pg-btn-ghost" disabled={recomputing} onClick={runRecompute}><RefreshCw size={14} /> {recomputing ? "Recomputing…" : "Recompute from ClickUp"}</button>
        <button className="pg-btn" style={{ marginLeft: "auto" }} onClick={exportRange}><Download size={14} /> Export</button>
      </div>

      {source === "manual" && <div className="pg-banner-warn">Showing the uploaded file — this overrides the live Supabase data until you reload.</div>}

      <div className="pg-cap-card" style={{ overflowX: "auto" }}>
        <table className="pg-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Manager</th>
              <th>Agreed hrs</th>
              {months.map((mk) => <th key={mk} colSpan={4}>{monthLabelOf(mk)}</th>)}
            </tr>
            <tr>
              <th /><th /><th />
              {months.map((mk) => (
                <React.Fragment key={mk}>
                  <th style={{ fontWeight: 400 }}>Worked</th>
                  <th style={{ fontWeight: 400 }}>Accrual</th>
                  <th style={{ fontWeight: 400 }}>Accrual %</th>
                  <th style={{ fontWeight: 400 }}>Comments</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const agreedNum = parseAgreedHours(c.agreedHpm);
              return (
                <tr key={c.client}>
                  <td>{c.client}</td>
                  <td>{c.manager || "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{agreedNum ?? c.agreedHpm ?? "—"}</td>
                  {months.map((mk) => {
                    const cell = c.months[mk] || {};
                    const accrualKey = `${c.client}|${mk}|accrual`;
                    const commentKey = `${c.client}|${mk}|comment`;
                    return (
                      <React.Fragment key={mk}>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmt(cell.workedHours)}</td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", cursor: "pointer" }}
                          title={cell.isOverride ? "Manually entered — won't be overwritten by Recompute" : "Computed from ClickUp hours"}
                          onClick={() => { setEditingCell(accrualKey); setDraftValue(cell.accrualValue != null ? String(cell.accrualValue) : ""); }}
                        >
                          {editingCell === accrualKey ? (
                            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                              <input
                                className="pg-input" style={{ width: 80, textAlign: "right" }} autoFocus
                                value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveCell(c, mk, "accrual"); if (e.key === "Escape") setEditingCell(null); }}
                              />
                              <button className="pg-btn-ghost" disabled={saving} onClick={() => saveCell(c, mk, "accrual")}>Save</button>
                            </div>
                          ) : (
                            <>{cell.accrualValue ?? cell.accrualNote ?? "—"}{cell.isOverride && <span className="pg-tag pg-tag--muted" style={{ marginLeft: 4 }}>manual</span>}</>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{cell.pct != null ? `${(cell.pct * 100).toFixed(1)}%` : "—"}</td>
                        <td style={{ minWidth: 200 }}>
                          {editingCell === commentKey ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <input
                                className="pg-input" autoFocus value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveCell(c, mk, "comment"); if (e.key === "Escape") setEditingCell(null); }}
                              />
                              <button className="pg-btn-ghost" disabled={saving} onClick={() => saveCell(c, mk, "comment")}>Save</button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                              onClick={() => { setEditingCell(commentKey); setDraftValue(cell.comment || ""); }}
                            >
                              <span style={{ flex: 1 }}>{cell.comment || <span style={{ opacity: 0.5 }}>Add comment</span>}</span>
                              <Pencil size={12} />
                            </div>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pg-footnote">Purple Giraffe · Client Accruals · Accrual = hours worked − agreed hours + prior month's accrual. Data lives in Supabase (pginvoice_accruals); "manual" months were entered by hand and are never overwritten by Recompute.</p>
    </div>
  );
}
