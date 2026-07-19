import React, { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Search, Download, ChevronDown, Plus, X, Users,
} from "lucide-react";
import { idbGet, PG_DATA_EVENT } from "./idbStore.js";
import { findMatch, isInternalFolder } from "./nameMatch.js";
import { SEED_CLIENTS, SEED_PEOPLE, FIXED_BASES, loadKey } from "./CapacityDashboard.jsx";

const CLICKUP_DB_KEY = "clickup";
const NOTES_KEY = "perf_notes_v1";

function monthLabelShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const fmt1 = (n) => (n === null || n === undefined || isNaN(n)) ? "—" : n.toFixed(1);
const fmt0 = (n) => (n === null || n === undefined || isNaN(n)) ? "—" : n.toFixed(0);

/* ============================================================
   PICKER / SEARCHBOX — same pattern as Capacity Planning's, kept
   local since it's a small dumb dropdown, not worth sharing.
============================================================ */
function Picker({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button type="button" className="pg-select" style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span>{current ? current.label : (placeholder || "All")}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="pg-menu" style={{ minWidth: 200, maxHeight: 260, overflow: "auto" }}>
          {options.map((o) => (
            <button key={o.value ?? "__all"} type="button" className="pg-menu-item" onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function SearchBox({ label, value, onChange, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const matches = useMemo(() => {
    if (!options) return [];
    const q = (value || "").trim().toLowerCase();
    const pool = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return pool.slice(0, 8);
  }, [options, value]);
  return (
    <label className="pg-field" style={{ position: "relative", width: 220 }} ref={ref}>
      <span className="pg-field__label"><Search size={11} /> {label}</span>
      <input className="pg-input" value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={`Search ${label.toLowerCase()}…`} autoComplete="off" />
      {open && options && matches.length > 0 && (
        <div className="pg-menu" style={{ width: "100%", top: "calc(100% + 2px)" }}>
          {matches.map((m) => (
            <button key={m} type="button" className="pg-menu-item" onClick={() => { onChange(m); if (onSelect) onSelect(m); setOpen(false); }}>{m}</button>
          ))}
        </div>
      )}
    </label>
  );
}

/* ============================================================
   LINE CHART (SVG) — restyled to the Purple Giraffe palette; same
   shape as Capacity Planning's data, just plotted over time.
============================================================ */
function LineChart({ series, months }) {
  const W = 640, H = 280, padL = 40, padR = 16, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const allVals = series.flatMap((s) => s.points.filter((v) => v !== null && v !== undefined));
  const maxV = allVals.length ? Math.max(...allVals) * 1.15 : 10;
  const x = (i) => (months.length <= 1 ? padL + plotW / 2 : padL + (i / (months.length - 1)) * plotW);
  const y = (v) => padT + plotH - (maxV ? (v / maxV) * plotH : 0);
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  if (months.length === 0) {
    return <div className="pg-empty">No months of ClickUp data to chart yet.</div>;
  }

  function handleMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0, best = Infinity;
    months.forEach((_, i) => { const d = Math.abs(x(i) - relX); if (d < best) { best = d; nearest = i; } });
    setHoverIdx(nearest);
  }

  return (
    <div className="pg-linechart" style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = maxV * f;
          const gy = y(v);
          return (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={gy} y2={gy} stroke="var(--border-soft)" strokeWidth="1" />
              <text x={2} y={gy + 4} fill="var(--fg-tertiary)" fontSize="9" fontFamily="var(--font-mono)">{v.toFixed(0)}</text>
            </g>
          );
        })}
        {series.map((s, si) => {
          const pts = s.points.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
          const segments = [];
          let cur = [];
          pts.forEach((p) => { if (p === null) { if (cur.length) segments.push(cur); cur = []; } else cur.push(p); });
          if (cur.length) segments.push(cur);
          return (
            <g key={si}>
              {segments.map((seg, gi) => (
                <path key={gi} d={seg.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ")} fill="none" stroke={s.color} strokeWidth="2.25" />
              ))}
              {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r={hoverIdx === i ? 4 : 2.75} fill={s.color} /> : null))}
            </g>
          );
        })}
        {months.map((m, i) => (
          <text key={m} x={x(i)} y={H - 8} fill="var(--fg-tertiary)" fontSize="10" textAnchor="middle" fontFamily="var(--font-mono)">{monthLabelShort(m)}</text>
        ))}
        {hoverIdx !== null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={padT + plotH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
        )}
      </svg>
      {hoverIdx !== null && (
        <div style={{
          position: "absolute", left: `${(x(hoverIdx) / W) * 100}%`, top: 4, transform: "translateX(-50%)",
          background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: "var(--app-radius-sm)",
          padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-primary)",
          pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}>
          <div style={{ color: "var(--fg-tertiary)", marginBottom: 4 }}>{monthLabelShort(months[hoverIdx])}</div>
          {series.map((s) => {
            const v = s.points[hoverIdx];
            if (v === null || v === undefined) return null;
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: s.color }} />
                {s.label}: <b>{v.toFixed(1)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("PerformanceScorecard error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, padding: 24, margin: 24, color: "var(--status-over)", background: "var(--status-over-soft)", borderRadius: "var(--app-radius)", whiteSpace: "pre-wrap" }}>
          <b>Something broke while rendering this dashboard:</b>
          {"\n\n"}{String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   MAIN
============================================================ */
function PerformanceInner() {
  const [tab, setTab] = useState("client");
  const [loaded, setLoaded] = useState(false);
  const [clickup, setClickup] = useState(null);
  const [clients, setClients] = useState(SEED_CLIENTS);
  const [people, setPeople] = useState(SEED_PEOPLE);

  const [notes, setNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");

  const [qClient, setQClient] = useState("");
  const [qBasis, setQBasis] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  const [qConsultant, setQConsultant] = useState("");
  const [selectedConsultant, setSelectedConsultant] = useState(null);

  const [rangeFrom, setRangeFrom] = useState(null);
  const [rangeTo, setRangeTo] = useState(null);

  // Clearing the search box resets the chart back to the whole-business view, the
  // mirror image of picking a match auto-populating it — only fires when the box
  // itself transitions to empty, so selecting a row directly (search left blank)
  // is never clobbered by this.
  useEffect(() => { if (qClient.trim() === "") setSelectedClient(null); }, [qClient]);
  useEffect(() => { if (qConsultant.trim() === "") setSelectedConsultant(null); }, [qConsultant]);

  // Live data: the ClickUp export lives in IndexedDB (Client Invoicing uploads it), and
  // the roster/client master lives in localStorage (Capacity Planning edits it) — both
  // broadcast PG_DATA_EVENT on change, so re-reading on that signal keeps this module in
  // sync with the rest of the app without a reload, the same bridge Capacity Planning uses.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const cu = await idbGet(CLICKUP_DB_KEY);
      if (cancelled) return;
      setClickup(cu || null);
      setClients(loadKey("cap_clients", SEED_CLIENTS));
      setPeople(loadKey("cap_people", SEED_PEOPLE));
      setNotes(loadKey(NOTES_KEY, []));
      setLoaded(true);
    };
    load();
    const onUpdate = (e) => { if (!e.detail || ["clickup", "cap_clients", "cap_people"].includes(e.detail.key)) load(); };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);

  const addNote = () => {
    if (!noteDraft.trim()) return;
    setNotes((ns) => {
      const next = [{ id: uid("n"), text: noteDraft.trim(), ts: Date.now() }, ...ns];
      try { window.localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
    setNoteDraft("");
  };
  const removeNote = (id) => {
    setNotes((ns) => {
      const next = ns.filter((n) => n.id !== id);
      try { window.localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  /* ---- months actually present in the ClickUp export ---- */
  const availableMonths = useMemo(() => {
    if (!clickup?.rows?.length) return [];
    const set = new Set();
    for (const r of clickup.rows) if (r.monthKey) set.add(r.monthKey);
    return [...set].sort();
  }, [clickup]);

  // Selected date range (month-to-month) — defaults to the full span of whatever data
  // is loaded, and snaps back to the full span if the current selection stops being
  // valid (a fresh/shorter export). Otherwise a user-picked range survives new uploads.
  useEffect(() => {
    if (!availableMonths.length) { setRangeFrom(null); setRangeTo(null); return; }
    setRangeFrom((prev) => (prev && availableMonths.includes(prev)) ? prev : availableMonths[0]);
    setRangeTo((prev) => (prev && availableMonths.includes(prev)) ? prev : availableMonths[availableMonths.length - 1]);
  }, [availableMonths]);

  // The months actually driving every chart/table below — a sub-window of
  // availableMonths bounded by the From/To pickers (order-independent).
  const activeMonths = useMemo(() => {
    if (!rangeFrom || !rangeTo) return availableMonths;
    const i0 = availableMonths.indexOf(rangeFrom), i1 = availableMonths.indexOf(rangeTo);
    if (i0 === -1 || i1 === -1) return availableMonths;
    const [lo, hi] = i0 <= i1 ? [i0, i1] : [i1, i0];
    return availableMonths.slice(lo, hi + 1);
  }, [availableMonths, rangeFrom, rangeTo]);

  const latestMonth = activeMonths.length ? activeMonths[activeMonths.length - 1] : null;
  const rangeLabel = activeMonths.length
    ? (activeMonths.length === 1 ? monthLabelShort(activeMonths[0]) : `${monthLabelShort(activeMonths[0])}–${monthLabelShort(latestMonth)}`)
    : "no data yet";
  const isFullRange = rangeFrom === (availableMonths[0] ?? null) && rangeTo === (availableMonths[availableMonths.length - 1] ?? null);

  /* ---- client groups, same grouping Capacity Planning uses ---- */
  const groups = useMemo(() => {
    const map = new Map();
    clients.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, { group: c.group, lead: c.lead, rows: [] });
      map.get(c.group).rows.push(c);
    });
    return [...map.values()];
  }, [clients]);
  function groupMeta(g) {
    const isFixed = g.rows.some((r) => FIXED_BASES.includes(r.basis));
    const agreedTotal = g.rows.reduce((s, r) => s + (r.agreed || 0), 0);
    const basisLabel = g.rows.length > 1 ? "Combined" : g.rows[0].basis;
    return { isFixed, agreedTotal, basisLabel };
  }

  /* ---- per-group monthly actuals, matched to a ClickUp folder by fuzzy name ----
     Billable, non-internal minutes only — the same "worked" definition Client
     Invoicing and Capacity Planning's dynamic average already use. */
  const clientMonthly = useMemo(() => {
    const result = new Map();
    if (!clickup?.rows?.length) return result;
    const folderMonth = new Map();
    const folders = new Set();
    for (const r of clickup.rows) {
      if (isInternalFolder(r.folder)) continue;
      if (clickup.hasBillable && !r.billable) continue;
      if (!r.monthKey) continue;
      folders.add(r.folder);
      if (!folderMonth.has(r.folder)) folderMonth.set(r.folder, new Map());
      const byMonth = folderMonth.get(r.folder);
      byMonth.set(r.monthKey, (byMonth.get(r.monthKey) || 0) + r.minutes);
    }
    const folderList = [...folders];
    groups.forEach((g) => {
      const match = findMatch(g.group, folderList);
      if (!match) return;
      const byMonth = folderMonth.get(match.name) || new Map();
      const monthHours = new Map();
      activeMonths.forEach((m) => monthHours.set(m, (byMonth.get(m) || 0) / 60));
      result.set(g.group, { matchedFolder: match.name, confidence: match.confidence, monthHours });
    });
    return result;
  }, [clickup, groups, activeMonths]);

  // expanding-window average — same semantics as Capacity Planning's trailingAverage:
  // the mean of every month in the selected range strictly before `m`.
  function expandingAvgAt(monthHours, m) {
    const idx = activeMonths.indexOf(m);
    if (idx <= 0) return null;
    const prior = activeMonths.slice(0, idx).map((k) => monthHours.get(k) || 0);
    return prior.reduce((a, b) => a + b, 0) / prior.length;
  }

  const filteredGroups = useMemo(() => groups.filter((g) =>
    (!qClient || g.group.toLowerCase().includes(qClient.toLowerCase())) &&
    (!qBasis || g.rows.some((r) => r.basis === qBasis))
  ), [groups, qClient, qBasis]);

  const clientTableRows = useMemo(() => filteredGroups.map((g) => {
    const meta = groupMeta(g);
    const cm = clientMonthly.get(g.group);
    const monthHours = cm ? cm.monthHours : new Map();
    const last = latestMonth ? (monthHours.get(latestMonth) || 0) : null;
    const idx = latestMonth ? activeMonths.indexOf(latestMonth) : -1;
    const window3 = idx >= 0 ? activeMonths.slice(Math.max(0, idx - 2), idx + 1) : [];
    const avg3 = cm && window3.length ? window3.reduce((s, m) => s + (monthHours.get(m) || 0), 0) / window3.length : null;
    const variance = meta.agreedTotal > 0 && avg3 !== null ? ((avg3 - meta.agreedTotal) / meta.agreedTotal) * 100 : null;
    return { ...g, ...meta, matched: !!cm, matchedFolder: cm?.matchedFolder, last, avg3, variance };
  }).sort((a, b) => {
    const av = a.variance === null ? -999 : Math.abs(a.variance), bv = b.variance === null ? -999 : Math.abs(b.variance);
    return bv - av;
  }), [filteredGroups, clientMonthly, latestMonth, activeMonths]);

  const clientChart = useMemo(() => {
    if (selectedClient) {
      const g = groups.find((x) => x.group === selectedClient);
      if (!g) return { series: [], isFixed: null, ytd: {}, current: {} };
      const meta = groupMeta(g);
      const cm = clientMonthly.get(g.group);
      const monthHours = cm ? cm.monthHours : new Map();
      const actualsPts = activeMonths.map((m) => monthHours.get(m) ?? 0);
      const agreedPts = meta.isFixed ? activeMonths.map(() => meta.agreedTotal) : activeMonths.map(() => null);
      const hourlyPts = meta.isFixed ? activeMonths.map(() => null) : activeMonths.map((m) => expandingAvgAt(monthHours, m));
      const series = [
        { label: "Agreed", color: "var(--fg-tertiary)", points: agreedPts },
        { label: "Hourly (trailing)", color: "var(--accent-orchid)", points: hourlyPts },
        { label: "Actuals", color: "var(--accent)", points: actualsPts },
      ].filter((s) => s.points.some((v) => v !== null));
      const ytdActuals = actualsPts.reduce((s, v) => s + (v || 0), 0);
      return {
        series, isFixed: meta.isFixed, matched: !!cm, matchedFolder: cm?.matchedFolder,
        ytd: { agreed: meta.isFixed ? meta.agreedTotal * activeMonths.length : null, hourly: meta.isFixed ? null : (activeMonths.length ? ytdActuals / activeMonths.length : null), actuals: ytdActuals },
        current: { agreed: meta.isFixed ? meta.agreedTotal : null, hourly: meta.isFixed ? null : expandingAvgAt(monthHours, latestMonth), actuals: latestMonth ? (monthHours.get(latestMonth) ?? 0) : null },
      };
    }
    // aggregate — every matched group
    const matchedGroups = groups.filter((g) => clientMonthly.has(g.group));
    const fixedGroups = matchedGroups.filter((g) => groupMeta(g).isFixed);
    const hourlyGroups = matchedGroups.filter((g) => !groupMeta(g).isFixed);
    const agreedTotal = fixedGroups.reduce((s, g) => s + groupMeta(g).agreedTotal, 0);
    const hourlyByMonth = activeMonths.map((m) => hourlyGroups.reduce((s, g) => s + (clientMonthly.get(g.group).monthHours.get(m) || 0), 0));
    const actualsByMonth = activeMonths.map((m) => matchedGroups.reduce((s, g) => s + (clientMonthly.get(g.group).monthHours.get(m) || 0), 0));
    const agreedByMonth = activeMonths.map(() => agreedTotal);
    const series = [
      { label: "Agreed", color: "var(--fg-tertiary)", points: agreedByMonth },
      { label: "Hourly clients (actual)", color: "var(--accent-orchid)", points: hourlyByMonth },
      { label: "Actuals (all)", color: "var(--accent)", points: actualsByMonth },
    ];
    const totYtd = actualsByMonth.reduce((a, b) => a + b, 0);
    const lastIdx = activeMonths.length - 1;
    return {
      series, isFixed: null, matched: matchedGroups.length > 0,
      ytd: { agreed: agreedTotal * activeMonths.length, hourly: activeMonths.length ? hourlyByMonth.reduce((a, b) => a + b, 0) / activeMonths.length : null, actuals: totYtd },
      current: { agreed: agreedTotal, hourly: lastIdx >= 0 ? hourlyByMonth[lastIdx] : null, actuals: lastIdx >= 0 ? actualsByMonth[lastIdx] : null },
    };
  }, [selectedClient, groups, clientMonthly, activeMonths, latestMonth]);

  /* ---- team: match real ClickUp usernames to the roster by fuzzy name ---- */
  const userMatch = useMemo(() => {
    const map = new Map();
    if (!clickup?.rows?.length) return map;
    const usernames = new Set();
    for (const r of clickup.rows) if (r.user) usernames.add(r.user);
    const rosterNames = people.map((p) => p.name);
    usernames.forEach((u) => {
      if (u.trim().toLowerCase() === "purple giraffe") { map.set(u, null); return; }
      const m = findMatch(u, rosterNames);
      map.set(u, m ? m.name : null);
    });
    return map;
  }, [clickup, people]);

  const botHours = useMemo(() => {
    if (!clickup?.rows?.length) return 0;
    const monthSet = new Set(activeMonths);
    return clickup.rows.filter((r) => r.monthKey && monthSet.has(r.monthKey) && (r.user || "").trim().toLowerCase() === "purple giraffe").reduce((s, r) => s + r.minutes, 0) / 60;
  }, [clickup, activeMonths]);

  // key -> Map(monthKey -> {total, clientBillable, pgBillable, unbillable}). Unmatched real
  // usernames get their own key (raw name) rather than being silently folded into nothing —
  // same "never hide real logged hours" rule the rest of the app follows.
  const teamMonthly = useMemo(() => {
    const map = new Map();
    if (!clickup?.rows?.length) return map;
    const monthSet = new Set(activeMonths);
    for (const r of clickup.rows) {
      if (!r.monthKey || !r.user || !monthSet.has(r.monthKey)) continue;
      if (r.user.trim().toLowerCase() === "purple giraffe") continue;
      const key = userMatch.get(r.user) || r.user;
      if (!map.has(key)) map.set(key, new Map());
      const byMonth = map.get(key);
      if (!byMonth.has(r.monthKey)) byMonth.set(r.monthKey, { total: 0, clientBillable: 0, pgBillable: 0, unbillable: 0 });
      const bucket = byMonth.get(r.monthKey);
      const hrs = r.minutes / 60;
      bucket.total += hrs;
      if (clickup.hasBillable) {
        if (r.billable && !r.isInternal) bucket.clientBillable += hrs;
        else if (r.billable && r.isInternal) bucket.pgBillable += hrs;
        else bucket.unbillable += hrs;
      } else if (r.isInternal) bucket.pgBillable += hrs;
      else bucket.clientBillable += hrs;
    }
    return map;
  }, [clickup, userMatch, activeMonths]);

  const rosterNamesSet = useMemo(() => new Set(people.map((p) => p.name)), [people]);
  const unmatchedNames = useMemo(() => [...teamMonthly.keys()].filter((k) => !rosterNamesSet.has(k)).sort(), [teamMonthly, rosterNamesSet]);
  const teamRoster = useMemo(() => [
    ...people.map((p) => ({ name: p.name, role: p.role, state: p.state })),
    ...unmatchedNames.map((n) => ({ name: n, role: "Unmatched", state: "—" })),
  ], [people, unmatchedNames]);

  const filteredTeam = useMemo(() => teamRoster.filter((t) => !qConsultant || t.name.toLowerCase().includes(qConsultant.toLowerCase())), [teamRoster, qConsultant]);
  const teamTableRows = useMemo(() => filteredTeam.map((t) => {
    const byMonth = teamMonthly.get(t.name);
    const totals = activeMonths.reduce((acc, m) => {
      const b = byMonth?.get(m);
      if (b) { acc.total += b.total; acc.clientBillable += b.clientBillable; acc.pgBillable += b.pgBillable; acc.unbillable += b.unbillable; }
      return acc;
    }, { total: 0, clientBillable: 0, pgBillable: 0, unbillable: 0 });
    return { ...t, totals, hasData: !!byMonth };
  }), [filteredTeam, teamMonthly, activeMonths]);

  const teamChart = useMemo(() => {
    const sumField = (byMonthGetter, field) => activeMonths.map((m) => {
      let s = 0;
      byMonthGetter().forEach((byMonth) => { const b = byMonth.get(m); if (b) s += b[field]; });
      return s;
    });
    if (selectedConsultant) {
      const byMonth = teamMonthly.get(selectedConsultant);
      if (!byMonth) return { series: [], ytd: {}, current: {} };
      const totalPts = activeMonths.map((m) => byMonth.get(m)?.total || 0);
      const cbPts = activeMonths.map((m) => byMonth.get(m)?.clientBillable || 0);
      const pgPts = activeMonths.map((m) => byMonth.get(m)?.pgBillable || 0);
      const unbPts = activeMonths.map((m) => byMonth.get(m)?.unbillable || 0);
      const series = [
        { label: "Total Timelog", color: "var(--fg-secondary)", points: totalPts },
        { label: "Client Billable", color: "var(--status-ok)", points: cbPts },
        { label: "PG Billable", color: "var(--accent-orchid)", points: pgPts },
        { label: "Unbillable", color: "var(--status-over)", points: unbPts },
      ];
      const totYtd = totalPts.reduce((a, b) => a + b, 0), cbYtd = cbPts.reduce((a, b) => a + b, 0), pgYtd = pgPts.reduce((a, b) => a + b, 0), unbYtd = unbPts.reduce((a, b) => a + b, 0);
      const lastIdx = activeMonths.length - 1;
      const last = lastIdx >= 0 ? (byMonth.get(activeMonths[lastIdx]) || { total: 0, clientBillable: 0, pgBillable: 0, unbillable: 0 }) : null;
      return {
        series,
        ytd: { clientPct: totYtd ? (cbYtd / totYtd) * 100 : 0, pgPct: totYtd ? (pgYtd / totYtd) * 100 : 0, unbPct: totYtd ? (unbYtd / totYtd) * 100 : 0 },
        current: last ? { clientPct: last.total ? (last.clientBillable / last.total) * 100 : 0, pgPct: last.total ? (last.pgBillable / last.total) * 100 : 0, unbPct: last.total ? (last.unbillable / last.total) * 100 : 0 } : { clientPct: 0, pgPct: 0, unbPct: 0 },
      };
    }
    const allByMonth = [...teamMonthly.values()];
    const totalPts = sumField(() => allByMonth, "total"), cbPts = sumField(() => allByMonth, "clientBillable"), pgPts = sumField(() => allByMonth, "pgBillable"), unbPts = sumField(() => allByMonth, "unbillable");
    const series = [
      { label: "Total Timelog", color: "var(--fg-secondary)", points: totalPts },
      { label: "Client Billable", color: "var(--status-ok)", points: cbPts },
      { label: "PG Billable", color: "var(--accent-orchid)", points: pgPts },
      { label: "Unbillable", color: "var(--status-over)", points: unbPts },
    ];
    const totYtd = totalPts.reduce((a, b) => a + b, 0), cbYtd = cbPts.reduce((a, b) => a + b, 0), pgYtd = pgPts.reduce((a, b) => a + b, 0), unbYtd = unbPts.reduce((a, b) => a + b, 0);
    const lastIdx = activeMonths.length - 1;
    return {
      series,
      ytd: { clientPct: totYtd ? (cbYtd / totYtd) * 100 : 0, pgPct: totYtd ? (pgYtd / totYtd) * 100 : 0, unbPct: totYtd ? (unbYtd / totYtd) * 100 : 0 },
      current: { clientPct: lastIdx >= 0 && totalPts[lastIdx] ? (cbPts[lastIdx] / totalPts[lastIdx]) * 100 : 0, pgPct: lastIdx >= 0 && totalPts[lastIdx] ? (pgPts[lastIdx] / totalPts[lastIdx]) * 100 : 0, unbPct: lastIdx >= 0 && totalPts[lastIdx] ? (unbPts[lastIdx] / totalPts[lastIdx]) * 100 : 0 },
    };
  }, [selectedConsultant, teamMonthly, activeMonths]);

  const basisOptions = [{ value: null, label: "All types" }, ...Array.from(new Set(clients.map((c) => c.basis))).sort().map((b) => ({ value: b, label: b }))];

  function exportXlsx() {
    const wb = XLSX.utils.book_new();
    const setCols = (ws, headerLen, widths) => { ws["!cols"] = widths; ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headerLen - 1)}1` }; };

    const clientHeader = ["Client", "Lead", "Type", "Agreed Hrs", "3-month Avg", `Last month (${latestMonth ? monthLabelShort(latestMonth) : "—"})`, "Variance %", "Matched ClickUp folder"];
    const clientRows = [clientHeader, ...clientTableRows.map((c) => [c.group, c.lead, c.basisLabel, c.agreedTotal || "", c.avg3 !== null ? Number(c.avg3.toFixed(1)) : "", c.last !== null ? Number(c.last.toFixed(1)) : "", c.variance !== null ? Number(c.variance.toFixed(0)) : "", c.matchedFolder || "unmatched"])];
    const wsClient = XLSX.utils.aoa_to_sheet(clientRows);
    setCols(wsClient, clientHeader.length, clientHeader.map((h) => ({ wch: Math.max(16, h.length + 2) })));
    XLSX.utils.book_append_sheet(wb, wsClient, "Client Performance");

    const teamHeader = ["Consultant", "Role", "Total Timelog", "Client Billable", "PG Billable", "Unbillable"];
    const teamRows = [teamHeader, ...teamTableRows.map((t) => [t.name, t.role, Number(t.totals.total.toFixed(1)), Number(t.totals.clientBillable.toFixed(1)), Number(t.totals.pgBillable.toFixed(1)), Number(t.totals.unbillable.toFixed(1))])];
    const wsTeam = XLSX.utils.aoa_to_sheet(teamRows);
    setCols(wsTeam, teamHeader.length, teamHeader.map((h) => ({ wch: Math.max(16, h.length + 2) })));
    XLSX.utils.book_append_sheet(wb, wsTeam, "Team Performance");

    const notesHeader = ["Date", "Note"];
    const notesRows = [notesHeader, ...notes.map((n) => [new Date(n.ts).toLocaleString(), n.text])];
    const wsNotes = XLSX.utils.aoa_to_sheet(notesRows);
    wsNotes["!cols"] = [{ wch: 20 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, "Notes");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `performance-scorecard-${rangeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!loaded) return <div className="pg-cap-container"><div className="pg-empty">Loading…</div></div>;

  const hasData = availableMonths.length > 0;

  return (
    <div className="pg-cap-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">Performance scorecard — how is the business actually doing?</h1>
          <p className="pg-app-header__sub">Select a client or consultant to see their own trend; leave it blank for the whole-business view. Figures come live from whatever ClickUp export is loaded in Client Invoicing, and the roster/client list from Capacity Planning.</p>
        </div>
      </div>

      {!hasData && (
        <div className="pg-banner-warn">
          No ClickUp data loaded yet — upload a CSV in Client Invoicing to see real trends here. The roster and client list below are shown with no actuals until then.
        </div>
      )}
      {hasData && botHours > 0.05 && (
        <div className="pg-banner-warn">
          {fmt1(botHours)} h logged under the shared "Purple Giraffe" ClickUp account are excluded from the by-person breakdown below (not a real team member).
        </div>
      )}

      <div className="pg-tabs">
        <button className={`pg-tab ${tab === "client" ? "pg-tab--active" : ""}`} onClick={() => setTab("client")}>Client</button>
        <button className={`pg-tab ${tab === "team" ? "pg-tab--active" : ""}`} onClick={() => setTab("team")}>Team</button>
      </div>

      {hasData && (
        <div className="pg-panel" style={{ alignItems: "center" }}>
          <label className="pg-field">
            <span className="pg-field__label">From</span>
            <select className="pg-select" value={rangeFrom || ""} onChange={(e) => setRangeFrom(e.target.value)} style={{ minWidth: 120 }}>
              {availableMonths.map((m) => <option key={m} value={m}>{monthLabelShort(m)}</option>)}
            </select>
          </label>
          <label className="pg-field">
            <span className="pg-field__label">To</span>
            <select className="pg-select" value={rangeTo || ""} onChange={(e) => setRangeTo(e.target.value)} style={{ minWidth: 120 }}>
              {availableMonths.map((m) => <option key={m} value={m}>{monthLabelShort(m)}</option>)}
            </select>
          </label>
          {!isFullRange && (
            <button className="pg-btn-ghost" onClick={() => { setRangeFrom(availableMonths[0]); setRangeTo(availableMonths[availableMonths.length - 1]); }}>
              Reset to full range
            </button>
          )}
          <span className="pg-footnote" style={{ marginLeft: "auto", marginTop: 0 }}>Applies to both the Client and Team tabs · {activeMonths.length} of {availableMonths.length} month{availableMonths.length === 1 ? "" : "s"} shown</span>
        </div>
      )}

      {tab === "client" && (
        <>
          <div className="pg-panel">
            <SearchBox label="Client" value={qClient} onChange={setQClient} options={groups.map((g) => g.group)} onSelect={(name) => setSelectedClient(name)} />
            <label className="pg-field">
              <span className="pg-field__label">Type</span>
              <div style={{ width: 170 }}><Picker value={qBasis} options={basisOptions} onChange={setQBasis} /></div>
            </label>
            <button className="pg-btn" style={{ marginLeft: "auto" }} onClick={exportXlsx}><Download size={14} /> Export</button>
          </div>

          <div className="pg-cap-grid">
            <div>
              <div className="pg-panel" style={{ flexDirection: "column", flexWrap: "nowrap", alignItems: "stretch" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
                  {clientChart.series.map((s) => (
                    <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-tertiary)" }}>
                      <i style={{ width: 14, height: 3, borderRadius: 2, display: "inline-block", background: s.color }} />{s.label}
                    </span>
                  ))}
                </div>
                <LineChart series={clientChart.series} months={activeMonths} />
                {selectedClient && (
                  <p className="pg-footnote" style={{ marginTop: 6 }}>
                    Showing <b>{selectedClient}</b> — {clientChart.isFixed ? "no Hourly line, since this is a fixed-agreement client." : "no Agreed line, since this client has no fixed agreement."}
                    {!clientChart.matched && " No matching ClickUp folder found for this client — actuals are 0."}
                  </p>
                )}
              </div>

              <div className="pg-panel" style={{ flexDirection: "column", flexWrap: "nowrap", alignItems: "stretch" }}>
                <div className="pg-table-wrap" style={{ overflowX: "auto" }}>
                  <table className="pg-table">
                    <thead><tr><th>Client</th><th>Lead</th><th className="right num">Agreed Hrs</th><th className="right num">3-month Avg</th><th className="right num">Last month</th><th className="right num">Variance</th><th>Flag</th></tr></thead>
                    <tbody>
                      {clientTableRows.map((c) => (
                        <tr key={c.group} onClick={() => setSelectedClient(c.group === selectedClient ? null : c.group)} style={{ cursor: "pointer", background: selectedClient === c.group ? "var(--accent-soft)" : "transparent" }}>
                          <td>{c.group} {c.rows.length > 1 && <span className="pg-tag pg-tag--muted" style={{ marginLeft: 4 }}>[Combined]</span>}</td>
                          <td>{c.lead}</td>
                          <td className="right num">{c.agreedTotal ? fmt1(c.agreedTotal) : "—"}</td>
                          <td className="right num">{fmt1(c.avg3)}</td>
                          <td className="right num">{fmt1(c.last)}</td>
                          <td className="right num">{c.variance === null ? "—" : `${c.variance > 0 ? "+" : ""}${c.variance.toFixed(0)}%`}</td>
                          <td>
                            {!c.matched && <span className="pg-tag pg-tag--muted">[No ClickUp match]</span>}
                            {c.matched && c.variance !== null && c.variance > 30 && <span className="pg-tag" style={{ color: "var(--status-over)" }}>[Over-serviced]</span>}
                            {c.matched && c.variance !== null && c.variance < -30 && <span className="pg-tag" style={{ color: "var(--status-warn)" }}>[Under-serviced]</span>}
                            {c.matched && (c.variance === null || Math.abs(c.variance) <= 30) && <span className="pg-tag" style={{ color: "var(--status-ok)" }}>[On track]</span>}
                          </td>
                        </tr>
                      ))}
                      {clientTableRows.length === 0 && <tr><td colSpan={7} className="pg-empty">No clients match this filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="pg-footnote" style={{ marginTop: 10 }}>Click a row to see that client's own chart above. Variance flags at ±30% of agreed hours (fixed-agreement clients only).</p>
              </div>
            </div>

            <div className="pg-cap-pane">
              <div className="pg-cap-stat">
                <div className="pg-field__label" style={{ marginBottom: 8 }}>All data ({rangeLabel})</div>
                <StatRow label="Agreed" value={clientChart.ytd.agreed === null || clientChart.ytd.agreed === undefined ? "—" : fmt0(clientChart.ytd.agreed)} />
                <StatRow label="Hourly" value={clientChart.ytd.hourly === null || clientChart.ytd.hourly === undefined ? "—" : fmt1(clientChart.ytd.hourly)} />
                <StatRow label="Actuals" value={fmt0(clientChart.ytd.actuals)} />
              </div>
              <div className="pg-cap-stat" style={{ marginTop: 12 }}>
                <div className="pg-field__label" style={{ marginBottom: 8 }}>Current month {latestMonth ? `(${monthLabelShort(latestMonth)})` : ""}</div>
                <StatRow label="Agreed" value={clientChart.current.agreed === null || clientChart.current.agreed === undefined ? "—" : fmt0(clientChart.current.agreed)} />
                <StatRow label="Hourly" value={clientChart.current.hourly === null || clientChart.current.hourly === undefined ? "—" : fmt1(clientChart.current.hourly)} />
                <StatRow label="Actuals" value={fmt0(clientChart.current.actuals)} />
              </div>

              <NotesPanel notes={notes} noteDraft={noteDraft} setNoteDraft={setNoteDraft} addNote={addNote} removeNote={removeNote} />
            </div>
          </div>
        </>
      )}

      {tab === "team" && (
        <>
          <div className="pg-panel">
            <SearchBox label="Consultant" value={qConsultant} onChange={setQConsultant} options={teamRoster.map((t) => t.name)} onSelect={(name) => setSelectedConsultant(name)} />
            <button className="pg-btn" style={{ marginLeft: "auto" }} onClick={exportXlsx}><Download size={14} /> Export</button>
          </div>

          <div className="pg-cap-grid">
            <div>
              <div className="pg-panel" style={{ flexDirection: "column", flexWrap: "nowrap", alignItems: "stretch" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
                  {teamChart.series.map((s) => (
                    <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-tertiary)" }}>
                      <i style={{ width: 14, height: 3, borderRadius: 2, display: "inline-block", background: s.color }} />{s.label}
                    </span>
                  ))}
                </div>
                <LineChart series={teamChart.series} months={activeMonths} />
                {selectedConsultant && <p className="pg-footnote" style={{ marginTop: 6 }}>Showing <b>{selectedConsultant}</b>.</p>}
              </div>

              <div className="pg-panel" style={{ flexDirection: "column", flexWrap: "nowrap", alignItems: "stretch" }}>
                <div className="pg-table-wrap" style={{ overflowX: "auto" }}>
                  <table className="pg-table">
                    <thead><tr><th><Users size={11} /> Consultant</th><th className="right num">Total Timelog</th><th className="right num">Client Billable</th><th className="right num">PG Billable</th><th className="right num">Unbillable</th></tr></thead>
                    <tbody>
                      {teamTableRows.map((t) => (
                        <tr key={t.name} onClick={() => setSelectedConsultant(t.name === selectedConsultant ? null : t.name)} style={{ cursor: "pointer", background: selectedConsultant === t.name ? "var(--accent-soft)" : "transparent" }}>
                          <td>{t.name} {t.role === "Unmatched" ? <span className="pg-tag pg-tag--muted" style={{ marginLeft: 4 }}>[not on roster]</span> : <span className="pg-tag" style={{ color: t.role === "Consultant" ? "var(--accent)" : "var(--accent-orchid)", marginLeft: 4 }}>[{t.role[0]}]</span>}</td>
                          <td className="right num">{t.totals.total.toFixed(1)}</td>
                          <td className="right num">{t.totals.clientBillable.toFixed(1)}</td>
                          <td className="right num">{t.totals.pgBillable.toFixed(1)}</td>
                          <td className="right num">{t.totals.unbillable.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pg-footnote" style={{ marginTop: 10 }}>Click a row to see that person's own chart above. Totals shown are for {rangeLabel}, the real ClickUp data currently loaded. "[not on roster]" means a real logged name that didn't match anyone in Capacity Planning's team roster.</p>
              </div>
            </div>

            <div className="pg-cap-pane">
              <div className="pg-cap-stat">
                <div className="pg-field__label" style={{ marginBottom: 8 }}>All data ({rangeLabel})</div>
                <StatRow label="Client billable %" value={`${fmt0(teamChart.ytd.clientPct)}%`} />
                <StatRow label="PG Billable %" value={`${fmt0(teamChart.ytd.pgPct)}%`} />
                <StatRow label="Unbillable %" value={`${fmt0(teamChart.ytd.unbPct)}%`} />
              </div>
              <div className="pg-cap-stat" style={{ marginTop: 12 }}>
                <div className="pg-field__label" style={{ marginBottom: 8 }}>Current month {latestMonth ? `(${monthLabelShort(latestMonth)})` : ""}</div>
                <StatRow label="Client billable %" value={`${fmt0(teamChart.current.clientPct)}%`} />
                <StatRow label="PG Billable %" value={`${fmt0(teamChart.current.pgPct)}%`} />
                <StatRow label="Unbillable %" value={`${fmt0(teamChart.current.unbPct)}%`} />
              </div>

              <NotesPanel notes={notes} noteDraft={noteDraft} setNoteDraft={setNoteDraft} addNote={addNote} removeNote={removeNote} />
            </div>
          </div>
        </>
      )}

      <p className="pg-footnote">Purple Giraffe · Performance Scorecard · Client and Team figures are computed live from the ClickUp export loaded in Client Invoicing.</p>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: "1px dashed var(--border-soft)" }}>
      <span style={{ fontSize: 12.5, color: "var(--fg-secondary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--fg-primary)" }}>{value}</span>
    </div>
  );
}

function NotesPanel({ notes, noteDraft, setNoteDraft, addNote, removeNote }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="pg-cap-card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="pg-field__label">Notes</span>
          <button className="pg-btn-ghost" onClick={() => setEditing((v) => !v)}>{editing ? "done" : "edit"}</button>
        </div>
        {notes.length === 0 && <p style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--fg-tertiary)", marginTop: 8 }}>No notes yet.</p>}
        {notes.map((n) => (
          <div key={n.id} className="pg-cap-note-row">
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--fg-secondary)" }}>{n.text}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-tertiary)", marginTop: 2 }}>{new Date(n.ts).toLocaleString()}</div>
            </div>
            {editing && <button className="pg-btn-ghost" style={{ color: "var(--status-over)", padding: "4px 7px" }} onClick={() => removeNote(n.id)}><X size={12} /></button>}
          </div>
        ))}
      </div>
      <div className="pg-cap-card" style={{ marginTop: 14 }}>
        <span className="pg-field__label">Add a note</span>
        <textarea className="pg-cap-textarea" style={{ marginTop: 8 }} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a comment for this month…" />
        <button className="pg-btn" style={{ marginTop: 8 }} onClick={addNote} disabled={!noteDraft.trim()}><Plus size={13} /> Add note</button>
      </div>
    </>
  );
}

export default function PerformanceScorecard() {
  return (
    <ErrorBoundary>
      <PerformanceInner />
    </ErrorBoundary>
  );
}
