import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload, Copy, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Search,
  AlertTriangle, Link2, FileSpreadsheet, FileText, Printer, Users, ArrowUpDown, BarChart3, Clock,
  RefreshCw, Wifi, WifiOff, X, ArrowLeft, MoreVertical, TrendingUp, TrendingDown,
  Calendar, SlidersHorizontal,
} from "lucide-react";
import { idbGet, idbSet, PG_DATA_EVENT } from "./idbStore.js";
import { findMatch, findPersonMatch, isInternalFolder, CLIENT_TYPE_LABELS, CLIENT_TYPE_TONES, dominantClientType, basisToClientType } from "./nameMatch.js";
import { fetchClickupFromSupabase, fetchSyncMeta, triggerManualSync, LIVE_SYNC_LABEL } from "./clickupSync.js";
import { SEED_CLIENTS as CAP_SEED_CLIENTS, SEED_PEOPLE, loadKey as loadCapKey } from "./capacityData.js";
import { fetchClients as fetchPgClients, fetchClientEvents, applyDueClientEvents, typeForMonth } from "./clientsSync.js";
import { PersonAvatar, ClientAvatar } from "./avatar.jsx";
import { useDismissable, useEscape } from "./useDismissable.js";
import { fmt, esc, filenameSafe, timeAgo, formatTaskUsers, clickupTaskUrl, isPackageLikeType } from "./format.js";
import {
  parseTimeTextToMinutes, msToMinutes, parseHeaderToMonth, monthLabel, monthKey, prevMonthKeyStr,
  parseAccruedWorkbook, findHeader, SKIP_FOLDERS, parseStartTextMonth, dateKeyStr, parseClickupCsv,
} from "./parsers.js";
import { buildPrintHtml, printClientPdf } from "./printTemplate.js";
import { CLICKUP_DB_KEY, ACCRUED_DB_KEY, CAP_CLIENTS_KEY, CAP_PEOPLE_KEY, PG_CLIENTS_KEY } from "./storageKeys.js";
// A <label> wrapping a <select> only focuses it on click in most browsers -- opening
// the dropdown itself needs a second click directly on the control. Used as the
// onClick for every pill-style filter label so one click anywhere on the pill
// (icon, padding, chevron, not just the select's own text) opens the picker.
// showPicker() is the real native/system dropdown; falls back to a focus+click
// nudge on browsers that don't support it yet (still native, just one extra tick).
function openPillPicker(e) {
  const select = e.currentTarget.querySelector("select");
  if (!select || select.disabled || e.target === select) return;
  e.preventDefault();
  select.focus();
  if (typeof select.showPicker === "function") select.showPicker();
}

// Same link as the task itself (see clickupTaskUrl's note above) -- ClickUp doesn't expose
// a way to deep-link to one specific person's time entry within a task, only the task page
// itself (where the Time Tracked panel shows everyone who logged against it).
function TaskUsersCell({ userMinutesMap, taskUrl }) {
  if (!userMinutesMap || userMinutesMap.size === 0) return "—";
  const entries = [...userMinutesMap.entries()].sort((a, b) => b[1] - a[1]);
  const single = entries.length === 1;
  return (
    <>
      {entries.map(([u, min], i) => (
        <React.Fragment key={u || i}>
          {i > 0 && ", "}
          {taskUrl ? (
            <a href={taskUrl} target="_blank" rel="noopener noreferrer" title="Open this task in ClickUp" className="pg-clickup-link">
              {u || "—"}
            </a>
          ) : (u || "—")}
          {!single && ` (${fmt(min / 60)}h)`}
        </React.Fragment>
      ))}
    </>
  );
}

// ------------------------------ classification ------------------------------
function classifyClient(c) {
  if (c.matched && c.pkg != null) return "package";
  if (/\(qld\)/i.test(c.name)) return "queensland";
  return "hourly";
}

const TYPE_LABELS = {
  all: "All Clients",
  package: "Clients on a Package",
  hourly: "Clients on Hourly rate",
  quoted: "Quoted Clients",
  map: "MAP Clients",
  project: "Project Clients",
  strategy: "Strategy Clients",
  ad_hoc: "Ad hoc Clients",
  queensland: "Queensland Clients (prv)",
};

// isPackageLikeType now lives in ./format.js, shared with the print template.

// Short canonical name for each client type — the shared vocabulary (nameMatch.js)
// Capacity Planning and Performance also fold their finer-grained "basis" categories
// down to, so a chip, export column, or copied summary reads identically across every
// module instead of Client Invoicing's own longer phrasing above.
const TYPE_LABELS_SHORT = { all: "All", ...CLIENT_TYPE_LABELS };

// Category tags borrow the brand's purple family; Queensland (an inactive/
// legacy bucket) is the one deliberate step outside it.
const TYPE_TONES = CLIENT_TYPE_TONES;

// ------------------------------- storage keys --------------------------------
const NAMEMAP_KEY = "pg-name-map-v1";
const VIEWSTATE_KEY = "pg-view-state-v1";
// Below this many hours of disagreement between the accrued sheet's recorded prior-month
// balance and what it recalculates to from current ClickUp data, treat it as rounding noise
// rather than a real edit-after-the-fact discrepancy worth flagging.
const MISMATCH_TOLERANCE_H = 0.2;

// ================================ COMPONENT =================================
export default function PGReconciliation({ onNavigateClients }) {
  const [clickup, setClickup] = useState(null);
  const [accrued, setAccrued] = useState(null);
  const [invoiceMonth, setInvoiceMonth] = useState("");
  const [dataMonthKey, setDataMonthKey] = useState("");
  const [priorMonthKey, setPriorMonthKey] = useState("");
  const [billableOnly, setBillableOnly] = useState(true);
  const [nameMap, setNameMap] = useState({});
  const [search, setSearch] = useState("");
  const [drawerClientName, setDrawerClientName] = useState(null);
  const [copied, setCopied] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [clickupErr, setClickupErr] = useState(null);
  const [accruedErr, setAccruedErr] = useState(null);
  const [clientTypeFilter, setClientTypeFilter] = useState("package");
  const [consultantFilter, setConsultantFilter] = useState("");
  const [sortMode, setSortMode] = useState("risk");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
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

  // Capacity Planning's client list (Supabase-backed), read-only here — used only to
  // cross-reference a client's current "basis" (Package/Project/Quoted/MAP/Strategy/
  // Hourly/Ad hoc) so a client on a Marketing Action Plan shows up as its own "MAP"
  // type below instead of whatever Client Invoicing's own package/hourly heuristic
  // would otherwise guess. Reactive to the same PG_DATA_EVENT Capacity Planning
  // broadcasts on every edit, so a basis change there is reflected here live.
  const [capClients, setCapClients] = useState(CAP_SEED_CLIENTS);
  useEffect(() => {
    let cancelled = false;
    const load = () => loadCapKey(CAP_CLIENTS_KEY, CAP_SEED_CLIENTS).then((v) => { if (!cancelled) setCapClients(v || CAP_SEED_CLIENTS); });
    load();
    const onUpdate = (e) => { if (!e.detail || e.detail.key === CAP_CLIENTS_KEY) load(); };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);

  // The Consultants module's roster (Supabase-backed), read-only here — used only to look
  // up a consultant's photo by their ClickUp username, so an avatar uploaded once in
  // Consultants shows up in the Consultant contributions list below without duplicating it.
  const [capPeople, setCapPeople] = useState(SEED_PEOPLE);
  useEffect(() => {
    let cancelled = false;
    const load = () => loadCapKey(CAP_PEOPLE_KEY, SEED_PEOPLE).then((v) => { if (!cancelled) setCapPeople(v || SEED_PEOPLE); });
    load();
    const onUpdate = (e) => { if (!e.detail || e.detail.key === CAP_PEOPLE_KEY) load(); };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);
  const capTypeByGroup = useMemo(() => {
    const byGroup = new Map();
    capClients.forEach((c) => { if (!byGroup.has(c.group)) byGroup.set(c.group, []); byGroup.get(c.group).push(c); });
    const result = new Map();
    byGroup.forEach((rows, group) => result.set(group, dominantClientType(rows)));
    return result;
  }, [capClients]);
  // A group is offboarded once every sub-project/row under it is inactive — as long as
  // even one row is still active, the group as a whole is still live. offboardedFrom is
  // the latest of its rows' dates, since that's when the last bit of work actually stopped.
  const capOffboardedByGroup = useMemo(() => {
    const byGroup = new Map();
    capClients.forEach((c) => { if (!byGroup.has(c.group)) byGroup.set(c.group, []); byGroup.get(c.group).push(c); });
    const result = new Map();
    byGroup.forEach((rows, group) => {
      if (!rows.every((r) => r.status === "inactive")) return;
      const dates = rows.map((r) => r.offboardedFrom).filter(Boolean).sort();
      result.set(group, { offboardedFrom: dates.length ? dates[dates.length - 1] : null, note: rows.find((r) => r.offboardNote)?.offboardNote || "" });
    });
    return result;
  }, [capClients]);
  const capGroupNames = useMemo(() => [...capTypeByGroup.keys()], [capTypeByGroup]);
  // Exact folder-name -> Capacity Planning row, for clients with more than one real
  // ClickUp folder under the same group (e.g. Warrina Homes: a Package folder plus a
  // separate one-off Quoted sub-project folder). classifyClient() below only asks "did
  // some accrued-sheet row match this folder's name," so when a sub-project's name is
  // close enough to fuzzy-match the SAME accrued row as the main package, it silently
  // inherited that package's full $ balance/pacing treatment -- two folders both showing
  // the exact same "package 24h, over-used 7.67h" figures as if each were its own
  // independent copy of the same commitment, which is exactly backwards. Capacity
  // Planning's own per-row basis is more precise than the accrued sheet can be here (the
  // accrued sheet only tracks Package-type clients at all), so it wins when they disagree.
  const capRowByClientName = useMemo(() => new Map(capClients.map((c) => [c.client, c])), [capClients]);

  // The Clients module's roster + scheduled type-change events (Supabase-backed) — the
  // authoritative source for "what type was this client actually on in a given month,"
  // including temporary transitions like a package client billing hourly for a couple of
  // months before reverting (e.g. GPEx, June-July 2026). Client Accruals already replays
  // this history correctly (see accrualsSync.js's recomputeAccruals); Client Invoicing's
  // own classifyClient() below only ever guessed from whatever accrued workbook happened
  // to be uploaded, with no month- or history-awareness, so a scheduled transition never
  // showed up here. Cross-referenced by ClickUp folder name below so each client card's
  // type reflects whatever was actually in effect for the month currently in view.
  const [pgClients, setPgClients] = useState([]);
  const [pgClientEvents, setPgClientEvents] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try { await applyDueClientEvents(); } catch (e) { /* best-effort */ }
      const [profiles, events] = await Promise.all([fetchPgClients(), fetchClientEvents()]);
      if (!cancelled) { setPgClients(profiles); setPgClientEvents(events); }
    };
    load();
    const onUpdate = (e) => { if (!e.detail || e.detail.key === PG_CLIENTS_KEY) load(); };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);
  const pgClientNames = useMemo(() => pgClients.map((p) => p.client), [pgClients]);
  // Exact ClickUp-folder -> profile lookup first (the authoritative mapping set via the
  // Clients module's own folder field), falling back to fuzzy name matching only for
  // profiles that haven't had their folder set yet.
  const pgProfileByFolder = useMemo(() => {
    const m = new Map();
    pgClients.forEach((p) => {
      if (!p.clickupFolder) return;
      const existing = m.get(p.clickupFolder);
      // More than one Clients-module record can point at the same ClickUp folder
      // (e.g. a since-offboarded sub-engagement that used to share a client's
      // main folder) -- prefer whichever one is still active, so lookups here
      // (type, logo, consultant, …) reflect the client actually using that
      // folder today rather than whichever row happened to sort last.
      if (!existing || (existing.status !== "active" && p.status === "active")) {
        m.set(p.clickupFolder, p);
      }
    });
    return m;
  }, [pgClients]);
  const pgClientByName = useMemo(() => new Map(pgClients.map((p) => [p.client, p])), [pgClients]);

  // Restore the uploaded data and filters from a previous session. The parsed CSV can run
  // several MB as JSON, too close to localStorage's shared per-origin quota to risk — so the
  // two large datasets live in IndexedDB, and just the small filter/view settings use
  // localStorage. Both setClickup/setAccrued and the filter setters land in the same commit,
  // so the auto-select effects below (which only override an *invalid* selection) see the
  // restored values already in place and leave them alone.
  useEffect(() => {
    (async () => {
      const [savedClickup, savedAccrued] = await Promise.all([idbGet(CLICKUP_DB_KEY), idbGet(ACCRUED_DB_KEY)]);
      if (savedClickup) {
        setClickup(savedClickup);
        justHydratedClickupRef.current = savedClickup;
        // IndexedDB caches whatever's in `clickup` state regardless of its origin --
        // both a manual upload AND a successful live sync end up here (see the
        // idbSet(CLICKUP_DB_KEY, clickup) effect below). Unconditionally marking
        // restored data "manual" was wrong: once live sync had ever run once, every
        // later reload restored that live data from cache and permanently mislabeled
        // it manual, which also set manualOverrideRef -- silently blocking the live
        // fetch below from ever taking over again, even on a working sync. Only
        // treat it as manual if it's NOT the live-sync payload (fetchClickupFromSupabase
        // always stamps its own fileName; a real manual upload never matches it).
        if (savedClickup.fileName !== LIVE_SYNC_LABEL) {
          manualOverrideRef.current = true;
          setClickupSource("manual");
        } else {
          setClickupSource("supabase");
        }
      }
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

  // Whenever the reporting period changes, chain "prior balance from" to the month
  // right before it — this is what makes reconciling an older month in a multi-month
  // export line up with the right historical balance instead of always the latest.
  // Chains there even when the accrued sheet doesn't have that column yet (rather than
  // silently falling back to whatever the last available column happens to be, which
  // would understate the real carry-in by a month or more); buildClientsForMonth
  // estimates the missing balance from ClickUp hours in that case, and the dropdown
  // below shows it as an "(estimated)" option so it's never mistaken for sheet data.
  useEffect(() => {
    if (!accrued || !dataMonthKey) return;
    setPriorMonthKey(prevMonthKeyStr(dataMonthKey));
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
      (r) => setClickup({ ...r, fileName: file.name, uploadedAt: Date.now() }),
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

  // billable, non-internal minutes per folder for a given month — used to independently
  // re-derive what that month's ending balance would be from current ClickUp data, to
  // cross-check against what the accrued sheet already has recorded for it. Parametrized
  // (rather than reading priorMonthKey directly) so the KPI trend comparison below can
  // run this same check for the month before priorMonthKey too. Returns null when the
  // export doesn't cover that month at all (nothing to check).
  const computeMonthWorked = useCallback((monthKey) => {
    if (!clickup || !monthKey) return null;
    const byFolder = new Map();
    let covered = false;
    for (const r of clickup.rows) {
      if (r.monthKey === monthKey) covered = true; else continue;
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (r.isInternal) continue;
      byFolder.set(r.folder, (byFolder.get(r.folder) || 0) + r.minutes);
    }
    return covered ? byFolder : null;
  }, [clickup, billableOnly]);
  const priorMonthWorked = useMemo(() => computeMonthWorked(priorMonthKey), [computeMonthWorked, priorMonthKey]);

  // Full per-client reconciliation, parametrized by (monthKey, priorKey) instead of
  // reading dataMonthKey/priorMonthKey directly — so the KPI trend row below can call
  // this exact same logic for the previous month too, instead of a separate, drift-prone
  // copy of the classification/matching pipeline. WITHOUT consultant filter (base data).
  const buildClientsForMonth = useCallback((monthKey, priorKey) => {
    if (!clickup) return [];
    const monthWorked = computeMonthWorked(priorKey);
    const map = new Map();
    for (const r of clickup.rows) {
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (r.isInternal) continue;
      if (monthKey && r.monthKey && r.monthKey !== monthKey) continue;
      if (!map.has(r.folder))
        map.set(r.folder, { name: r.folder, totalMin: 0, tasksAll: new Map(), userMinutes: new Map(), tasksByUser: new Map(), taskUsers: new Map(), taskIds: new Map() });
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
      // Every row sharing a task NAME should also share the same real ClickUp task id --
      // but names aren't actually unique (e.g. two different "Untitled"/task-less rows,
      // or two genuinely different tasks that happen to be named the same). Track every
      // distinct id seen per name; a link is only shown when there's exactly one, so an
      // ambiguous name never links to the wrong task.
      if (r.taskId) {
        if (!c.taskIds.has(r.task)) c.taskIds.set(r.task, new Set());
        c.taskIds.get(r.task).add(r.taskId);
      }
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
      let priorBalance = accruedClient && priorKey ? (accruedClient.balances[priorKey] ?? null) : null;
      // The accrued sheet doesn't have a column for the prior month (e.g. it hasn't
      // been re-uploaded with last month's closing balance yet) — estimate it the same
      // way the mismatch cross-check below does: worked hours that month (from the
      // live ClickUp data, if it covers that month) minus package, plus whatever
      // balance the sheet DOES have for the month before that. Flagged as estimated
      // rather than presented as verified accrued-sheet data.
      let priorBalanceEstimated = false;
      if (priorBalance === null && accruedClient && pkg !== null && pkg > 0 && monthWorked) {
        const priorWorkedH = (monthWorked.get(c.name) || 0) / 60;
        const priorPriorBalance = accruedClient.balances[prevMonthKeyStr(priorKey)] ?? 0;
        priorBalance = priorWorkedH - pkg + priorPriorBalance;
        priorBalanceEstimated = true;
      }
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
      if (!priorBalanceEstimated && pkg !== null && pkg > 0 && priorBalance !== null && monthWorked) {
        const priorWorkedH = (monthWorked.get(c.name) || 0) / 60;
        const priorPriorBalance = accruedClient.balances[prevMonthKeyStr(priorKey)] ?? 0;
        const recomputed = priorWorkedH - pkg + priorPriorBalance;
        if (Math.abs(recomputed - priorBalance) > MISMATCH_TOLERANCE_H) {
          priorMismatch = { sheetValue: priorBalance, recomputed };
        }
      }
      const clientObj = {
        ...c, worked, accruedClient, matchInfo,
        pkg, priorBalance, priorBalanceEstimated, newBalance, remaining, kpiPct, status, priorMismatch,
        matched: !!accruedClient,
        displayName: accruedClient?.name ?? c.name,
      };
      clientObj.type = classifyClient(clientObj);
      // The Clients module knows what this client was actually billing as for THIS
      // specific month (typeForMonth replays its scheduled type-change events) — that
      // always wins over the accrued-workbook guess above, since a temporary transition
      // (e.g. GPEx briefly moving to hourly for a couple of months before reverting to
      // its package) has no way to be reflected in classifyClient()'s static, upload-only
      // logic otherwise. Falls back to classifyClient()'s result for any client not yet
      // registered in the Clients module.
      const pgProfile = pgProfileByFolder.get(c.name) || (() => {
        const m = findMatch(c.name, pgClientNames);
        return m ? pgClientByName.get(m.name) : null;
      })();
      if (pgProfile && monthKey) {
        const seg = typeForMonth(pgProfile, pgClientEvents, monthKey);
        if (seg?.type) {
          clientObj.type = seg.type;
          // Only worth flagging as a transition when it actually changed something from
          // the client's normal baseline — otherwise every already-registered client would
          // show a "scheduled" badge for no reason.
          clientObj.typeTransitioned = seg.type !== pgProfile.baseType;
          clientObj.typeTransitionNote = seg.note;
        }
      }
      // This exact folder's own Capacity Planning row (not just a fuzzy group match) --
      // corrects classifyClient()'s "matched an accrued row with a package figure, so it
      // must be a package" assumption for a sub-project folder that only fuzzy-matched
      // the MAIN package's accrued-sheet row by name coincidence. When Capacity Planning
      // already knows this specific folder is really Quoted/Hourly/etc, that overrides
      // the false "package" guess -- this folder stops carrying the main package's $
      // balance/pacing math (which was never really its own), instead of two folders
      // both showing an identical "package 24h, over-used 7.67h" as if each independently
      // owned the same commitment.
      const capRow = capRowByClientName.get(c.name);
      if (capRow) {
        const capType = basisToClientType(capRow.basis);
        if (!isPackageLikeType(capType) && isPackageLikeType(clientObj.type)) {
          clientObj.type = capType;
          clientObj.packageOverriddenBy = capRow.basis;
        }
        clientObj.capGroup = capRow.group;
      }
      // Client Invoicing has no independent way to know a client is on a Marketing
      // Action Plan (MAP) — that's tracked only in Capacity Planning's "basis" field.
      // Cross-reference it here by name, purely additively: c.type (which the
      // package/hourly/Queensland UI below is built around, including the real
      // accrued-balance tracking) is left exactly as classifyClient() already
      // determines it, so a MAP client that's also tracked with a package-style
      // accrual keeps that UI. isMap just layers a separate "MAP" filter option and
      // an inline tag on top, visible regardless of which type bucket a client
      // otherwise falls into. Reads live capacity data, so a client moving off MAP
      // is reflected here automatically next time this recomputes.
      const capMatch = findMatch(c.name, capGroupNames);
      clientObj.isMap = capMatch ? capTypeByGroup.get(capMatch.name) === "map" : false;
      const offboarded = capMatch ? capOffboardedByGroup.get(capMatch.name) : null;
      clientObj.isOffboarded = !!offboarded && (!monthKey || !offboarded.offboardedFrom || monthKey >= offboarded.offboardedFrom);
      clientObj.offboardNote = offboarded?.note || "";
      if (!clientObj.capGroup && capMatch) clientObj.capGroup = capMatch.name;
      // Logo set in the Clients module (uploaded, or auto-fetched from the client's
      // website favicon) — purely cosmetic, falls back to initials when absent.
      clientObj.logoUrl = pgProfile?.logoUrl || null;
      out.push(clientObj);
    }
    return out;
  }, [clickup, accrued, accruedNames, nameMap, billableOnly, computeMonthWorked, capGroupNames, capTypeByGroup, capOffboardedByGroup, capRowByClientName, pgProfileByFolder, pgClientNames, pgClientByName, pgClientEvents]);

  const clients = useMemo(() => buildClientsForMonth(dataMonthKey, priorMonthKey), [buildClientsForMonth, dataMonthKey, priorMonthKey]);

  // Same reconciliation, one month earlier — real, fully-computed numbers (not a
  // fabricated estimate), used only to power the "vs last month" KPI comparisons.
  // Shifts both the reporting month and the balance-lookup month back by one, mirroring
  // what the "prior balance from" auto-chain effect does when you step the month picker.
  const prevMonthDataKey = dataMonthKey ? prevMonthKeyStr(dataMonthKey) : "";
  const prevClients = useMemo(
    () => (dataMonthKey ? buildClientsForMonth(prevMonthDataKey, prevMonthKeyStr(priorMonthKey || prevMonthDataKey)) : []),
    [buildClientsForMonth, dataMonthKey, prevMonthDataKey, priorMonthKey]
  );

  // counts by type — "map" counts c.isMap (an overlay tag), not c.type, since a MAP
  // client keeps whatever c.type its own package/hourly classification landed on.
  const typeCounts = useMemo(() => {
    const counts = { all: clients.length, package: 0, hourly: 0, queensland: 0, quoted: 0, map: 0, project: 0, strategy: 0, ad_hoc: 0 };
    for (const c of clients) {
      counts[c.type] = (counts[c.type] || 0) + 1;
      if (c.isMap) counts.map++;
    }
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

  // folders excluded as internal/non-client (onboarding, WIP, etc. — NOT Purple Giraffe, which is
  // DMA's real consultant hours) — surfaced for transparency rather than silently dropped, since the
  // keyword rule can misfire on a client-named onboarding folder (see the billable-hours guide, §3.1).
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

  // A client with more than one real ClickUp folder under the same Capacity Planning
  // group (e.g. Warrina Homes: the main Package folder plus a one-off Quoted sub-project
  // folder) previously showed as two unrelated-looking top-level cards, both titled the
  // same thing -- easy to mistake for a duplicate/broken entry. Pick one member per group
  // as the "primary" (the Package one, since that's the ongoing relationship; otherwise
  // whichever logged the most hours) so the other(s) can nest underneath it instead.
  const primaryNameByGroup = useMemo(() => {
    const byGroup = new Map();
    clients.forEach((c) => { if (!c.capGroup) return; if (!byGroup.has(c.capGroup)) byGroup.set(c.capGroup, []); byGroup.get(c.capGroup).push(c); });
    const result = new Map();
    byGroup.forEach((members, group) => {
      if (members.length < 2) return;
      const primary = members.find((m) => isPackageLikeType(m.type)) || [...members].sort((a, b) => b.worked - a.worked)[0];
      result.set(group, primary.name);
    });
    return result;
  }, [clients]);
  // primary's folder name -> its sibling sub-project(s), computed against the FULL client
  // list (not the type-filtered one below) -- a sub-project's own type would otherwise make
  // it invisible whenever the view is scoped to its parent's type, which is exactly the
  // "where did the other Warrina Homes card go" confusion this is meant to fix.
  const siblingsByPrimaryName = useMemo(() => {
    const byGroup = new Map();
    clients.forEach((c) => { if (!c.capGroup) return; if (!byGroup.has(c.capGroup)) byGroup.set(c.capGroup, []); byGroup.get(c.capGroup).push(c); });
    const result = new Map();
    byGroup.forEach((members, group) => {
      const primaryName = primaryNameByGroup.get(group);
      if (!primaryName) return;
      result.set(primaryName, members.filter((m) => m.name !== primaryName));
    });
    return result;
  }, [clients, primaryNameByGroup]);

  function withConsultantFilter(c, consultant) {
    const tasksFiltered = consultant ? (c.tasksByUser.get(consultant) || new Map()) : c.tasksAll;
    const workedFiltered = consultant ? ((c.userMinutes.get(consultant) || 0) / 60) : c.worked;
    // narrow each task's contributor breakdown to the selected consultant too, when filtering
    const taskUsersFiltered = consultant
      ? new Map([...tasksFiltered.keys()].map((task) => [task, new Map([[consultant, tasksFiltered.get(task)]])]))
      : c.taskUsers;
    return { ...c, tasksFiltered, workedFiltered, taskUsersFiltered };
  }

  // filtered + sorted + consultant-scoped clients for display
  const visible = useMemo(() => {
    let list = clientTypeFilter === "all" ? clients.slice()
      : clientTypeFilter === "map" ? clients.filter((c) => c.isMap)
      : clients.filter((c) => c.type === clientTypeFilter);
    if (consultantFilter) list = list.filter((c) => c.userMinutes.has(consultantFilter));
    // A non-primary member of a multi-folder group is only ever shown nested under its
    // primary (see siblingsByPrimaryName above), never again as its own top-level card.
    list = list.filter((c) => {
      if (!c.capGroup) return true;
      const primaryName = primaryNameByGroup.get(c.capGroup);
      return !primaryName || c.name === primaryName;
    });
    list = list.map((c) => withConsultantFilter(c, consultantFilter));
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
        if (isPackageLikeType(clientTypeFilter)) return Math.abs(b.kpiPct ?? 0) - Math.abs(a.kpiPct ?? 0);
        return (b.workedFiltered ?? b.worked) - (a.workedFiltered ?? a.worked);
      });
    }
    return list;
  }, [clients, clientTypeFilter, consultantFilter, search, sortMode, primaryNameByGroup]);

  // Same filter pipeline as `visible` above, applied to prevClients — real,
  // fully-computed prior-month numbers (not an estimate) so the KPI cards can show a
  // genuine "vs last month" comparison on an apples-to-apples basis with what's on
  // screen right now (same type/consultant/search filters).
  const prevPrimaryNameByGroup = useMemo(() => {
    const byGroup = new Map();
    prevClients.forEach((c) => { if (!c.capGroup) return; if (!byGroup.has(c.capGroup)) byGroup.set(c.capGroup, []); byGroup.get(c.capGroup).push(c); });
    const result = new Map();
    byGroup.forEach((members, group) => {
      if (members.length < 2) return;
      const primary = members.find((m) => isPackageLikeType(m.type)) || [...members].sort((a, b) => b.worked - a.worked)[0];
      result.set(group, primary.name);
    });
    return result;
  }, [prevClients]);

  const prevMonthShortLabel = useMemo(() => {
    if (!prevMonthDataKey) return "";
    const [y, m] = prevMonthDataKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
  }, [prevMonthDataKey]);

  // Flat lookup (visible clients + their nested sub-project siblings) so the drawer
  // can resolve whichever client name was clicked, regardless of nesting.
  const allDisplayable = useMemo(() => {
    const map = new Map();
    visible.forEach((c) => map.set(c.name, c));
    visible.forEach((c) => {
      const siblings = siblingsByPrimaryName.get(c.name);
      if (siblings) siblings.forEach((s) => map.set(s.name, withConsultantFilter(s, consultantFilter)));
    });
    return map;
  }, [visible, siblingsByPrimaryName, consultantFilter]);
  const drawerClient = drawerClientName ? allDisplayable.get(drawerClientName) : null;

  // The set of ClickUp folder names the KPI row/sparkline currently represent -- a
  // single client (plus its sub-project siblings) while its drawer is open, so the
  // header snapshot reads as "this client's numbers" instead of staying pinned to
  // the whole filtered list; otherwise every folder behind the currently filtered/
  // searched client list, so the snapshot tracks search/type/consultant filtering
  // the same way the row list below it already does.
  const kpiScopeFolders = useMemo(() => {
    if (drawerClient) {
      const names = new Set([drawerClient.name]);
      (siblingsByPrimaryName.get(drawerClient.name) || []).forEach((s) => names.add(s.name));
      return names;
    }
    const names = new Set();
    visible.forEach((c) => {
      names.add(c.name);
      (siblingsByPrimaryName.get(c.name) || []).forEach((s) => names.add(s.name));
    });
    return names;
  }, [drawerClient, visible, siblingsByPrimaryName]);

  // KPI row scope: the selected client (+ siblings) while its drawer is open,
  // otherwise every currently filtered/searched client -- same idea as
  // kpiScopeFolders above, just as client objects rather than folder names.
  const statsScope = useMemo(() => {
    if (drawerClient) {
      const sibs = siblingsByPrimaryName.get(drawerClient.name) || [];
      return [drawerClient, ...sibs.map((s) => withConsultantFilter(s, consultantFilter))];
    }
    return visible;
  }, [drawerClient, visible, siblingsByPrimaryName, consultantFilter]);

  const stats = useMemo(() => {
    const hrs = statsScope.reduce((a, c) => a + (c.workedFiltered ?? c.worked), 0);
    const over = statsScope.filter((c) => c.status === "over").length;
    const under = statsScope.filter((c) => c.status === "under").length;
    // "Carry-over / Accrued" KPI — total absolute prior-month balance across every
    // package client currently in view, whichever direction (credit carried in or
    // over-used), since both represent a balance still being carried forward.
    const carry = statsScope.reduce((a, c) => a + (c.priorBalance != null ? Math.abs(c.priorBalance) : 0), 0);
    return { hrs, count: statsScope.length, over, under, carry };
  }, [statsScope]);

  const prevStats = useMemo(() => {
    let list;
    if (drawerClient) {
      const sibNames = new Set((siblingsByPrimaryName.get(drawerClient.name) || []).map((s) => s.name));
      list = prevClients.filter((c) => c.name === drawerClient.name || sibNames.has(c.name));
    } else {
      list = clientTypeFilter === "all" ? prevClients.slice()
        : clientTypeFilter === "map" ? prevClients.filter((c) => c.isMap)
        : prevClients.filter((c) => c.type === clientTypeFilter);
      if (consultantFilter) list = list.filter((c) => c.userMinutes.has(consultantFilter));
      list = list.filter((c) => {
        if (!c.capGroup) return true;
        const primaryName = prevPrimaryNameByGroup.get(c.capGroup);
        return !primaryName || c.name === primaryName;
      });
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.displayName || "").toLowerCase().includes(q));
      }
    }
    list = list.map((c) => withConsultantFilter(c, consultantFilter));
    const hrs = list.reduce((a, c) => a + (c.workedFiltered ?? c.worked), 0);
    const over = list.filter((c) => c.status === "over").length;
    const carry = list.reduce((a, c) => a + (c.priorBalance != null ? Math.abs(c.priorBalance) : 0), 0);
    // Only meaningful once the export actually has rows for that month — otherwise
    // "0 vs last month" would misleadingly read as a 100% drop rather than "no data".
    const available = !!(clickup && prevMonthDataKey && clickup.rows.some((r) => r.monthKey === prevMonthDataKey));
    return { hrs, count: list.length, over, carry, available };
  }, [drawerClient, prevClients, clientTypeFilter, consultantFilter, search, prevPrimaryNameByGroup, siblingsByPrimaryName, clickup, prevMonthDataKey]);

  // Trailing up-to-6-month hours trend for the "Total billable hours" sparkline —
  // scoped to kpiScopeFolders above, so it tracks the same client(s) the KPI cards
  // currently represent (search/type/consultant filters, or a single selected client).
  const hoursTrend = useMemo(() => {
    if (!clickup) return [];
    const byMonth = new Map();
    for (const r of clickup.rows) {
      if (clickup.hasBillable && billableOnly && !r.billable) continue;
      if (r.isInternal) continue;
      if (consultantFilter && r.user !== consultantFilter) continue;
      if (!kpiScopeFolders.has(r.folder)) continue;
      if (!r.monthKey) continue;
      byMonth.set(r.monthKey, (byMonth.get(r.monthKey) || 0) + r.minutes);
    }
    const keys = [...byMonth.keys()].sort();
    const upto = dataMonthKey ? keys.filter((k) => k <= dataMonthKey) : keys;
    return upto.slice(-6).map((k) => byMonth.get(k) / 60);
  }, [clickup, billableOnly, consultantFilter, dataMonthKey, kpiScopeFolders]);
  const usedAccruedNames = useMemo(() => new Set(clients.filter((x) => x.matched).map((x) => x.accruedClient.name)), [clients]);

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
    if (bc) return bc.label;
    // Not in the sheet yet — still show a readable month name rather than blank
    // (the value itself is the ClickUp-estimated fallback, flagged separately).
    const [py, pm] = priorMonthKey.split("-").map(Number);
    return monthLabel(py, pm - 1);
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
      "Client type": TYPE_LABELS_SHORT[c.type],
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
      .filter((c) => isPackageLikeType(c.type) && (c.status === "over" || c.status === "under"))
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
  // Ready-to-merge accrued-hours export for the real last calendar month (not
  // whatever reporting period happens to be selected) — e.g. if it's August
  // right now, this always exports July's closing balances. Uses the same
  // buildClientsForMonth pipeline as everything else, so a client whose July
  // balance the sheet doesn't have yet gets the same ClickUp-estimated
  // fallback the rest of the app uses, clearly labelled as such.
  const buildLastMonthAccruedRows = () => {
    const now = new Date();
    const thisRealMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastMonthKey = prevMonthKeyStr(thisRealMonthKey);
    const priorToLast = prevMonthKeyStr(lastMonthKey);
    const [ly, lm] = lastMonthKey.split("-").map(Number);
    const colLabel = monthLabel(ly, lm - 1);
    const list = buildClientsForMonth(lastMonthKey, priorToLast).filter((c) => c.pkg != null && c.pkg > 0);
    return {
      rows: list.map((c) => ({
        "Client": c.displayName,
        "Agreed h.p.m": c.pkg,
        [colLabel]: c.newBalance != null ? Math.round(c.newBalance * 100) / 100 : "",
        "Estimated (no sheet data for this month yet)": c.priorBalanceEstimated ? "Yes" : "",
      })),
      lastMonthKey, colLabel,
    };
  };
  const exportLastMonthAccrued = () => {
    setExportOpen(false);
    const { rows, lastMonthKey, colLabel } = buildLastMonthAccruedRows();
    exportXlsx(rows, `PG-accrued-${lastMonthKey}.xlsx`, colLabel);
  };

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
    lines.push(`Client type: ${TYPE_LABELS_SHORT[c.type]}`);
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
    if (isPackageLikeType(c.type) && c.pkg != null) {
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
    <div className={"pg-app pg-app--invoicing" + (drawerClient ? " pg-app--drawer-open" : "")}>
      <div className={"pg-container" + (drawerClient ? " pg-container--dimmed" : "")}>
        {/* header + command row combined — title on the left, search centered in
            the remaining space, actions pinned right, all on the same top line. */}
        <div className="pg-app-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div className="pg-app-header__icon"><FileText size={18} /></div>
            <div>
              <span className="pg-eyebrow">Purple Giraffe · Internal</span>
              <h1 className="pg-app-header__title">Client Invoicing</h1>
              <p className="pg-app-header__sub">
                Reconcile monthly hours, review client servicing and generate invoice-ready summaries.
              </p>
            </div>
          </div>

          <div className="pg-cmdrow">
            <CommandSearch clients={clients} onSelect={(name) => setDrawerClientName(name)} />
          </div>

          <div className="pg-cmdrow__actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="pg-btn-ghost" onClick={handleManualSync} disabled={syncing} title={syncing ? "Syncing…" : "Sync now"}>
              <RefreshCw size={12} style={syncing ? { animation: "pg-spin 1s linear infinite" } : undefined} /> <span className="pg-btn-label">{syncing ? "Syncing…" : "Sync now"}</span>
            </button>
            {ready && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setExportOpen((x) => !x)} className="pg-btn-ghost" title="Export">
                  <Download size={12} /> <span className="pg-btn-label">Export</span> <ChevronDown size={12} />
                </button>
                {exportOpen && (
                  <div className="pg-menu">
                    <ExportItem icon={<Printer size={14} />} label="Generate PDF" onClick={() => { setExportOpen(false); drawerClient && downloadPdf(drawerClient); }} disabled={!drawerClient} title={drawerClient ? undefined : "Select a client first"} />
                    <div className="pg-menu-sep" />
                    <ExportItem icon={<FileText size={14} />} label="Pending hours (CSV)" onClick={() => doExport("pending", "csv")} />
                    <ExportItem icon={<FileSpreadsheet size={14} />} label="Pending hours (Excel)" onClick={() => doExport("pending", "xlsx")} />
                    <div className="pg-menu-sep" />
                    <ExportItem icon={<FileText size={14} />} label="Full monthly summary (CSV)" onClick={() => doExport("summary", "csv")} />
                    <ExportItem icon={<FileSpreadsheet size={14} />} label="Full monthly summary (Excel)" onClick={() => doExport("summary", "xlsx")} />
                    <div className="pg-menu-sep" />
                    <ExportItem
                      icon={<FileSpreadsheet size={14} />} label="Accrued hours — last month (Excel)"
                      onClick={exportLastMonthAccrued}
                      title="Closing balances for last calendar month, ready to merge into the master accrued sheet"
                    />
                  </div>
                )}
              </div>
            )}
            <SyncStatusIcon clickupSource={clickupSource} clickup={clickup} syncMeta={syncMeta} />
            <WarningIcon title="ClickUp export" warnings={clickup?.warnings} />
            <WarningIcon title="Accrued sheet" warnings={accrued?.warnings} />
            {clickupSource !== "manual" && syncMeta?.last_synced_at && syncMeta?.last_sync_status !== "error" && (
              <span className="pg-status-pill" style={{ color: "var(--status-ok)", background: "var(--status-ok-soft)" }}>Synced</span>
            )}
            <ImportButton
              clickup={clickup} accrued={accrued} clickupErr={clickupErr} accruedErr={accruedErr}
              onPickClickup={() => clickupInput.current?.click()}
              onPickAccrued={() => accruedInput.current?.click()}
            />
            <input ref={clickupInput} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleClickup(e.target.files?.[0])} />
            <input ref={accruedInput} type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }} onChange={(e) => handleAccrued(e.target.files?.[0])} />
          </div>
        </div>

        {/* KPI summary — the page's headline numbers, before any raw data. Deltas are
            real prior-month figures (see prevStats above), not estimates — they're
            simply hidden when the export doesn't cover the prior month at all. */}
        {ready && (
          <div className="pg-kpi-row">
            {(() => {
              // Computed once and passed to both the delta chip and the sparkline,
              // so they always agree on which direction this month's change is
              // (the sparkline colors itself from this exact same object).
              const hoursDelta = prevStats.available && prevStats.hrs > 0
                ? { pct: ((stats.hrs - prevStats.hrs) / prevStats.hrs) * 100, label: prevMonthShortLabel }
                : null;
              return (
                <KpiCard
                  label="Total billable hours" value={`${fmt(stats.hrs)} h`}
                  delta={hoursDelta}
                  spark={hoursTrend.length > 1 ? <Sparkline values={hoursTrend} delta={hoursDelta} /> : null}
                />
              );
            })()}
            <KpiCard
              label="Clients in view" value={stats.count} icon={<Users size={15} />}
              delta={prevStats.available ? { count: stats.count - prevStats.count, label: prevMonthShortLabel } : null}
            />
            <KpiCard
              label="Over-serviced clients" value={stats.over} tone={stats.over > 0 ? "var(--status-over)" : undefined} icon={<AlertTriangle size={15} />}
              delta={prevStats.available ? { count: stats.over - prevStats.over, label: prevMonthShortLabel, invert: true } : null}
            />
            <KpiCard
              label="Carry-over / Accrued" value={`${fmt(stats.carry)} h`} icon={<Clock size={15} />}
              sub={prevStats.available ? undefined : "from prior months"}
              delta={prevStats.available ? { hours: stats.carry - prevStats.carry, label: prevMonthShortLabel } : null}
            />
          </div>
        )}


        {/* config + filter row, combined into one panel (previously two stacked
            panels) so there's one less thing to scroll past before reaching the
            client list — a divider keeps the two groups visually distinct. */}
        {ready && (
          <div className="pg-panel" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
          <div className="pg-pillbar">
            {availableMonths.length > 1 && (() => {
              const idx = availableMonths.findIndex((m) => m.key === dataMonthKey);
              const label = idx >= 0 ? availableMonths[idx].label : dataMonthKey;
              return (
                <div className="pg-pill pg-pill--stepper" title="Reporting period">
                  <button
                    type="button" className="pg-pill__step" aria-label="Previous month"
                    disabled={idx <= 0}
                    onClick={() => idx > 0 && setDataMonthKey(availableMonths[idx - 1].key)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="pg-pill__step-label"><Calendar size={13} className="pg-pill__icon" /> {label}</span>
                  <button
                    type="button" className="pg-pill__step" aria-label="Next month"
                    disabled={idx < 0 || idx >= availableMonths.length - 1}
                    onClick={() => idx >= 0 && idx < availableMonths.length - 1 && setDataMonthKey(availableMonths[idx + 1].key)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              );
            })()}
            <label className="pg-pill pg-pill--select" title="Client type" onClick={openPillPicker}>
              <select value={clientTypeFilter} onChange={(e) => setClientTypeFilter(e.target.value)}>
                <option value="all">All Clients ({typeCounts.all})</option>
                <option value="package">Clients on a Package ({typeCounts.package})</option>
                <option value="strategy">Strategy Clients ({typeCounts.strategy})</option>
                <option value="hourly">Clients on Hourly rate ({typeCounts.hourly})</option>
                <option value="ad_hoc">Ad hoc Clients ({typeCounts.ad_hoc})</option>
                <option value="quoted" disabled>Quoted Clients ({typeCounts.quoted}), coming later</option>
                <option value="project" disabled>Project Clients ({typeCounts.project}), coming later</option>
                <option value="map">MAP Clients ({typeCounts.map})</option>
                <option value="queensland">Queensland Clients (prv) ({typeCounts.queensland})</option>
              </select>
              <ChevronDown size={13} className="pg-pill__chevron" />
            </label>
            <label className="pg-pill pg-pill--select" title="Consultant" onClick={openPillPicker}>
              <select value={consultantFilter} onChange={(e) => setConsultantFilter(e.target.value)}
                disabled={!clickup?.hasUser}>
                <option value="">All Consultants</option>
                {consultants.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <ChevronDown size={13} className="pg-pill__chevron" />
            </label>
            <label className="pg-pill pg-pill--select" title="Sort" onClick={openPillPicker}>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="risk">Sort: Risk</option>
                <option value="alpha">Sort: Alphabetical</option>
              </select>
              <ChevronDown size={13} className="pg-pill__chevron" />
            </label>
            {clickup.hasBillable && (
              <label className="pg-pill pg-pill--checkbox">
                <input type="checkbox" checked={billableOnly} onChange={(e) => setBillableOnly(e.target.checked)} />
                Billable only
              </label>
            )}
            <label className="pg-pill pg-pill--search">
              <Search size={13} className="pg-pill__icon" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter clients…" title="Filters the currently visible, already-filtered client list below. To jump straight to any client regardless of filters, use the search bar in the header (⌘K)." />
            </label>
            <button type="button"
              className={`pg-pill pg-pill--iconbtn${advancedFiltersOpen ? " is-active" : ""}`}
              onClick={() => setAdvancedFiltersOpen((v) => !v)}
              title="More filters: invoice month, prior balance">
              <SlidersHorizontal size={15} />
            </button>
          </div>

          {advancedFiltersOpen && (
            <>
              <div style={{ borderTop: "1px solid var(--border-subtle)" }} />
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
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
                    {/* The desired prior month isn't in the sheet yet — shown as its own
                        clearly-labelled option so the select never silently shows a stale
                        column instead. Selecting it just keeps the estimated fallback. */}
                    {priorMonthKey && !accrued.balanceCols.some((bc) => monthKey(bc.year, bc.month) === priorMonthKey) && (
                      <option value={priorMonthKey}>{priorMonthPretty} (estimated — not in sheet yet)</option>
                    )}
                  </select>
                </label>
              </div>
            </>
          )}
          </div>
        )}

        {/* mid-month pace banner — only shown when the reporting period is the current, still-open month */}
        {ready && monthProgress && (
          <div className="pg-banner-warn" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            Mid-month check: day {monthProgress.dayOfMonth} of {monthProgress.totalDays} ({fmt(monthProgress.pct, 0)}% of the month elapsed). Package figures below are hours worked so far this month, not a final total.
          </div>
        )}

        {/* excluded internal / non-client folders — transparency, not a warning */}
        {ready && excludedInternal.folders.length > 0 && (
          <div className="pg-panel" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span className="pg-tag pg-tag--muted pg-tag--pill">excluded as internal / non-client</span>
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

        {/* client list — numbered rows, click one to open its full detail in the drawer */}
        {ready && (
          <div className="pg-rowlist">
            <div className="pg-rowlist__head pg-row-grid-cols" aria-hidden="true">
              <span />
              <span />
              <span>Client</span>
              <span>Type</span>
              <span>Carry</span>
              <span>Package</span>
              <span>Worked</span>
              <span>Remaining</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((c, i) => {
              const siblings = siblingsByPrimaryName.get(c.name);
              return (
                <React.Fragment key={c.name}>
                  <ClientRow index={i + 1} client={c} active={drawerClientName === c.name} onOpen={() => setDrawerClientName(c.name)} onCopy={copySummary} onPdf={downloadPdf} />
                  {siblings && siblings.length > 0 && siblings.map((s) => {
                    const sc = withConsultantFilter(s, consultantFilter);
                    return (
                      <ClientRow key={sc.name} client={sc} nested parentName={c.displayName} active={drawerClientName === sc.name} onOpen={() => setDrawerClientName(sc.name)} onCopy={copySummary} onPdf={downloadPdf} />
                    );
                  })}
                </React.Fragment>
              );
            })}
            {visible.length === 0 && (
              <div className="pg-empty">
                {(clientTypeFilter === "quoted" || clientTypeFilter === "project")
                  ? `${TYPE_LABELS[clientTypeFilter]} aren't tracked here yet, this bucket is a placeholder.`
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

      {drawerClient && (
        <ClientDrawer
          client={drawerClient}
          invoiceMonth={invoiceMonth}
          priorMonthPretty={priorMonthPretty}
          monthProgress={monthProgress}
          hasUser={clickup.hasUser}
          consultantFilter={consultantFilter}
          accruedNames={accruedNames}
          usedAccruedNames={usedAccruedNames}
          syncMeta={syncMeta}
          capPeople={capPeople}
          onClose={() => setDrawerClientName(null)}
          onSetMatch={(v) => setManualMatch(drawerClient.name, v)}
          onCopy={() => copySummary(drawerClient)}
          onPdf={() => downloadPdf(drawerClient)}
          onViewProfile={onNavigateClients}
          copied={copied === drawerClient.name}
        />
      )}
    </div>
  );
}

// ================================ subcomponents =============================
// delta shapes: { pct, label } | { count, label, invert? } | { hours, label }
// invert=true means a smaller number is the improvement (e.g. over-serviced clients).
// Shared by DeltaChip and Sparkline so a card's trend line and its delta
// arrow always agree on which direction counts as "good" — `invert` flips
// which direction is favorable (e.g. over-serviced clients: fewer is better).
function deltaRaw(delta) {
  if (!delta) return undefined;
  if (delta.pct !== undefined) return delta.pct;
  if (delta.count !== undefined) return delta.count;
  return delta.hours;
}
function deltaTone(delta) {
  const raw = deltaRaw(delta);
  if (raw === undefined) return null;
  if (raw === 0) return "var(--fg-tertiary)";
  const improving = delta.invert ? raw <= 0 : raw >= 0;
  return improving ? "var(--status-ok)" : "var(--status-over)";
}

function DeltaChip({ delta }) {
  if (!delta) return null;
  let raw, text;
  if (delta.pct !== undefined) { raw = delta.pct; text = `${raw >= 0 ? "↑" : "↓"}${fmt(Math.abs(raw), 0)}% vs ${delta.label}`; }
  else if (delta.count !== undefined) { raw = delta.count; text = raw === 0 ? `No change vs ${delta.label}` : `${raw > 0 ? "↑" : "↓"}${Math.abs(raw)} vs ${delta.label}`; }
  else { raw = delta.hours; text = raw === 0 ? `No change vs ${delta.label}` : `${raw > 0 ? "↑" : "↓"}${fmt(Math.abs(raw))} h vs ${delta.label}`; }
  return <div className="pg-kpi-card__delta" style={{ color: deltaTone(delta) }}>{text}</div>;
}

// Smoothed trend line (Catmull-Rom points converted to cubic Bézier segments)
// with a gradient area fill underneath — replaces the old straight-segment
// polyline, which read as jagged/rough at this size. Kept as a small inline
// SVG component in the app's own convention (see LineChart.jsx/Sparkline.jsx)
// rather than a separate reusable component + CSS file: this card's the only
// caller today, and its color/sizing already need to follow this card's own
// design tokens (var(--accent), the KPI card's icon-slot proportions), not a
// generic hardcoded palette.
function Sparkline({ values, delta, color }) {
  // useId() must run unconditionally on every render (Rules of Hooks) --
  // called before the early return below, even though its result only
  // matters once we know there's actually something to render.
  const gradientId = `pg-spark-grad-${useId().replace(/:/g, "")}`;
  // Same red/green logic as this card's own delta arrow (deltaTone), so the
  // trend line and the chip below it never disagree about which way is good.
  // Falls back to the neutral accent purple when there's no prior-period
  // comparison to judge direction from yet (e.g. first month of data).
  const resolvedColor = color || deltaTone(delta) || "var(--accent)";
  const w = 72, h = 28, pad = 3;
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (w - pad * 2),
    y: pad + (1 - (v - min) / range) * (h - pad * 2),
  }));

  const linePath = points.reduce((path, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const prevPrev = points[i - 2] ?? prev;
    const next = points[i + 1] ?? p;
    const c1x = prev.x + (p.x - prevPrev.x) / 6;
    const c1y = prev.y + (p.y - prevPrev.y) / 6;
    const c2x = p.x - (next.x - prev.x) / 6;
    const c2y = p.y - (next.y - prev.y) / 6;
    return `${path} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p.x} ${p.y}`;
  }, "");
  const baseline = h - pad;
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="pg-kpi-card__spark" role="img" aria-label="Trend over recent months">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={resolvedColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={resolvedColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={resolvedColor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiCard({ label, value, sub, tone, icon, delta, spark }) {
  return (
    <div className="pg-kpi-card">
      <div className="pg-kpi-card__top">
        <span className="pg-kpi-card__label">{label}</span>
        {spark || (icon && <span className="pg-kpi-card__icon" style={tone ? { color: tone, background: "transparent" } : undefined}>{icon}</span>)}
      </div>
      <div className="pg-kpi-card__value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="pg-kpi-card__sub">{sub}</div>}
      <DeltaChip delta={delta} />
    </div>
  );
}
// Compact icon trigger — replaces the old full-width banner. The full warning
// text still lives behind a click, just in a small balloon instead of taking
// over a whole row.
// Compact replacement for the old always-visible "live-sync status" bar — same
// 4 states (manual override / sync error / synced / never synced), but as a
// single icon+balloon next to Import, matching how ClickUp/Accrued warnings
// already work, instead of a full-width row that was mostly empty space when
// everything was fine.
function SyncStatusIcon({ clickupSource, clickup, syncMeta }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));

  let status, Icon, color, message;
  if (clickupSource === "manual") {
    status = "manual"; Icon = WifiOff; color = "var(--status-warn)";
    message = clickup?.uploadedAt
      ? `Showing a manually uploaded file (${clickup.fileName || "no name"}), uploaded ${timeAgo(new Date(clickup.uploadedAt).toISOString())} — not the live sync. Overrides live sync until the next reload.`
      : "Showing a manually uploaded file from a previous session — not the live sync. Overrides live sync until the next reload.";
  } else if (syncMeta?.last_sync_status === "error") {
    status = "error"; Icon = WifiOff; color = "var(--status-warn)";
    message = `Live sync not set up yet (${syncMeta.last_sync_message}). Upload a CSV in the meantime.`;
  } else if (syncMeta?.last_synced_at) {
    status = "ok"; Icon = Wifi; color = "var(--status-ok)";
    message = `Live sync from ClickUp · last synced ${timeAgo(syncMeta.last_synced_at)} · ${syncMeta.rows_synced ?? "—"} entries.`;
  } else {
    status = "never"; Icon = WifiOff; color = "var(--fg-tertiary)";
    message = "Live sync hasn't run yet.";
  }
  const needsAttention = status !== "ok";

  return (
    <div className="pg-warn-icon-wrap" ref={ref}>
      <button
        className="pg-warn-icon" onClick={() => setOpen((o) => !o)}
        style={{ color }}
        title={message}
        aria-label={`ClickUp sync status: ${status}`}
      >
        <Icon size={14} />
        {needsAttention && <span className="pg-warn-icon__count">!</span>}
      </button>
      {open && (
        <div className="pg-warn-balloon">
          <div className="pg-warn-balloon__title">ClickUp sync</div>
          <div className="pg-warn-balloon__item">{message}</div>
        </div>
      )}
    </div>
  );
}

function WarningIcon({ title, warnings }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="pg-warn-icon-wrap" ref={ref}>
      <button
        className="pg-warn-icon" onClick={() => setOpen((o) => !o)}
        title={`${title}: ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
        aria-label={`Show ${title} warnings`}
      >
        <AlertTriangle size={14} />
        {warnings.length > 1 && <span className="pg-warn-icon__count">{warnings.length}</span>}
      </button>
      {open && (
        <div className="pg-warn-balloon">
          <div className="pg-warn-balloon__title">{title}</div>
          {warnings.map((w, i) => <div key={i} className="pg-warn-balloon__item">{w}</div>)}
        </div>
      )}
    </div>
  );
}
// Global client search — real, not decorative: filters the full client list (not
// just the currently-visible/type-filtered rows) and opens the drawer on selection.
// Cmd/Ctrl+K focuses it from anywhere on the page, matching the mockup's convention.
function CommandSearch({ clients, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const wrapRef = useDismissable(() => setOpen(false));

  const q = query.trim().toLowerCase();
  const matches = q
    ? clients.filter((c) => c.displayName.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 8)
    : [];

  return (
    <div className="pg-cmdsearch" ref={wrapRef}>
      <Search size={14} className="pg-cmdsearch__icon" />
      <input
        ref={inputRef}
        className="pg-cmdsearch__input"
        placeholder="Jump to a client…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      <span className="pg-cmdsearch__kbd">⌘K</span>
      {open && q && (
        <div className="pg-menu" style={{ left: 0, right: "auto", top: "calc(100% + 6px)", minWidth: "100%" }}>
          {matches.length === 0 && <div className="pg-menu-item" style={{ cursor: "default", color: "var(--fg-tertiary)" }}>No clients match "{query}"</div>}
          {matches.map((c) => (
            <ExportItem
              key={c.name}
              icon={<Users size={14} />}
              label={c.displayName}
              onClick={() => { onSelect(c.name); setQuery(""); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
function ExportItem({ icon, label, onClick, disabled, title }) {
  return (
    <button onClick={onClick} className="pg-menu-item" disabled={disabled} title={title}>
      {icon}
      {label}
    </button>
  );
}

// Overall connection status across both required files — three-state, since
// "one of two connected" is a meaningfully different state from either extreme.
function importTone(clickup, accrued) {
  if (clickup && accrued) return "var(--status-ok)";
  if (clickup || accrued) return "var(--status-warn)";
  return "var(--status-over)";
}
function StatusDot({ tone, size = 8 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: tone, flex: "none" }} />;
}

// Replaces the old always-visible upload cards — same two file inputs, now
// triggered from a dropdown so the page opens straight into real content
// instead of leading with upload prompts once files are already connected.
function ImportButton({ clickup, accrued, clickupErr, accruedErr, onPickClickup, onPickAccrued }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => setOpen(false));
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="pg-btn-ghost" onClick={() => setOpen((o) => !o)} title="Import">
        <StatusDot tone={importTone(clickup, accrued)} /> <span className="pg-btn-label">Import</span> <ChevronDown size={12} />
      </button>
      {open && (
        <div className="pg-menu" style={{ minWidth: 280 }}>
          <button className="pg-menu-item" onClick={() => { onPickClickup(); setOpen(false); }} style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Upload size={14} />
              <span>
                ClickUp time export
                {clickup?.fileName && <div style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 400 }}>{clickup.fileName}</div>}
                {clickupErr && <div style={{ fontSize: 11, color: "var(--status-over)", fontWeight: 400 }}>{clickupErr}</div>}
              </span>
            </span>
            <StatusDot tone={clickup ? "var(--status-ok)" : "var(--status-warn)"} />
          </button>
          <button className="pg-menu-item" onClick={() => { onPickAccrued(); setOpen(false); }} style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Upload size={14} />
              <span>
                Accrued Hours report
                {accrued?.fileName && <div style={{ fontSize: 11, color: "var(--fg-tertiary)", fontWeight: 400 }}>{accrued.fileName}</div>}
                {accruedErr && <div style={{ fontSize: 11, color: "var(--status-over)", fontWeight: 400 }}>{accruedErr}</div>}
              </span>
            </span>
            <StatusDot tone={accrued ? "var(--status-ok)" : "var(--status-warn)"} />
          </button>
        </div>
      )}
    </div>
  );
}

// Compact numbered row — the list's default state. Clicking anywhere on it opens
// the full client detail in the right-side drawer (see ClientDrawer below).
function ClientRow({ index, client: c, active, onOpen, nested, parentName, onCopy, onPdf }) {
  const [inlineOpen, setInlineOpen] = useState(false);
  const [tasksAllShown, setTasksAllShown] = useState(false);
  const [consultantsAllShown, setConsultantsAllShown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissable(() => setMenuOpen(false));
  const isPackage = isPackageLikeType(c.type);
  const statusTone = isPackage
    ? (c.status === "over" ? "var(--status-over)" : c.status === "under" ? "var(--status-warn)" : "var(--status-ok)")
    : undefined;
  const statusText = isPackage && c.status !== "no-pkg"
    ? (c.status === "over" ? `${fmt(Math.abs(c.newBalance))} h over-served` : c.status === "under" ? `${fmt(Math.abs(c.newBalance))} h under-served` : "on track")
    : null;

  const worked = c.workedFiltered ?? c.worked;
  const pkg = c.pkg ?? 0;
  const carry = Math.abs(c.priorBalance ?? 0);
  const effective = pkg - (c.priorBalance ?? 0);
  const barMax = Math.max(worked, effective, pkg, 1) * 1.15;
  const workedPct = Math.max(0, Math.min(100, (worked / barMax) * 100));
  const pkgPct = (pkg / barMax) * 100;

  // priorBalance < 0: unused hours banked last month, brought into this one — a
  // benefit, shown green. priorBalance > 0: the client over-used their package
  // last month, so this month's hours are effectively paying that down — shown
  // red, same "carried in (green) vs. carried over/used (red)" convention the
  // drawer already uses for this exact field, just applied to this row too.
  const carryLabel = c.priorBalance == null || c.priorBalance === 0 ? "Carry-over"
    : c.priorBalance < 0 ? "Carried in" : "Over-used prior";
  const carryTone = c.priorBalance == null || c.priorBalance === 0 ? undefined
    : c.priorBalance < 0 ? "var(--status-ok)" : "var(--status-over)";
  const carryTitle = c.priorBalance == null ? undefined
    : c.priorBalance < 0 ? `${fmt(carry)} h of unused package time carried in from last month.`
    : c.priorBalance > 0 ? `${fmt(carry)} h of last month's over-use being carried over into this month.`
    : undefined;
  // remaining < 0: over-served (used more than the package this month) — red.
  // remaining > 0: hours still left in the package this month — green.
  const remainingTone = c.remaining == null || c.remaining === 0 ? undefined
    : c.remaining < 0 ? "var(--status-over)" : "var(--status-ok)";

  // A friendlier status pill (On pace / At risk / Overserviced / No package) for
  // package-style clients, reusing the same over/under/ok tone already computed
  // above; non-package clients just get their type as a neutral pill.
  // Status column reflects package pacing (the only type with an over/under/on-pace
  // concept) -- non-package types (hourly, quoted, ad hoc, …) have no such notion, and
  // showing their type here again would just repeat the Type column two cells over,
  // so they get a plain "not tracked" placeholder instead.
  const statusPill = isPackage
    ? (c.pkg == null
      ? { label: "No package", tone: "var(--fg-tertiary)", bg: "var(--bg-elevated)" }
      : c.status === "over"
        ? { label: "Overserviced", tone: "var(--status-over)", bg: "var(--status-over-soft)" }
        : c.status === "under"
          ? { label: "At risk", tone: "var(--status-warn)", bg: "var(--status-warn-soft)" }
          : { label: "On pace", tone: "var(--status-ok)", bg: "var(--status-ok-soft)" })
    : null;

  const consultantEntries = [...c.userMinutes.entries()].sort((a, b) => b[1] - a[1]);
  const consultantTotal = consultantEntries.reduce((a, [, min]) => a + min, 0);
  const shownConsultants = consultantsAllShown ? consultantEntries : consultantEntries.slice(0, 3);
  const taskEntries = [...c.tasksFiltered.entries()].sort((a, b) => b[1] - a[1]);
  const shownTasks = tasksAllShown ? taskEntries : taskEntries.slice(0, 3);

  return (
    <div className={"pg-row-wrap" + (nested ? " pg-row--nested" : "")}>
      <div
        role="button" tabIndex={0}
        className={"pg-row pg-row-grid-cols" + (active ? " pg-row--active" : "") + (inlineOpen ? " pg-row--expanded" : "")}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      >
        <span className="pg-row__index">{!nested ? index : null}</span>
        <ClientAvatar name={c.displayName} logo={c.logoUrl} size={32} style={{ marginRight: -6 }} />
        <span className="pg-row__name">
          <span className="pg-row__name-main">
            {c.displayName}
            {c.isOffboarded && <span className="pg-tag pg-tag--muted pg-tag--pill" style={{ marginLeft: 6 }} title={c.offboardNote}>Offboarded</span>}
          </span>
          <span className="pg-row__name-sub">
            {nested ? <><Link2 size={10} /> Related sub-project of {parentName}</> : (c.capGroup && c.capGroup !== c.displayName ? c.capGroup : null)}
          </span>
        </span>
        <span className="pg-tag pg-tag--pill" style={{ color: TYPE_TONES[c.type] }}>{TYPE_LABELS_SHORT[c.type]}</span>
        <span className="pg-row__num" style={carryTone ? { color: carryTone } : undefined} title={carryTitle}>
          <span className="pg-row__num-label">{carryLabel}</span>{c.priorBalance != null ? `${fmt(carry)} h` : "—"}
        </span>
        <span className="pg-row__num">
          <span className="pg-row__num-label">Package</span>{c.pkg != null ? `${fmt(c.pkg)} h` : "—"}
        </span>
        <span className="pg-row__num">
          <span className="pg-row__num-label">Worked</span>{fmt(worked)} h
        </span>
        <span className="pg-row__num" style={remainingTone ? { color: remainingTone } : undefined}>
          <span className="pg-row__num-label">Remaining</span>
          {c.remaining != null ? `${c.remaining < 0 ? "−" : ""}${fmt(Math.abs(c.remaining))} h` : "—"}
        </span>
        <span className="pg-row__status">
          {statusPill && (
            <span className="pg-status-pill" style={{ color: statusPill.tone, background: statusPill.bg }} title={statusText || undefined}>
              {statusPill.label}
            </span>
          )}
        </span>
        <span className="pg-row__menu" style={{ position: "relative" }} ref={menuRef}>
          <button
            type="button" aria-label="More actions"
            className="pg-row__chevron pg-icon-btn-sm"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div className="pg-menu" onClick={(e) => e.stopPropagation()}>
              <ExportItem icon={<Users size={14} />} label="Open full details" onClick={() => { setMenuOpen(false); onOpen(); }} />
              <ExportItem
                icon={<ChevronDown size={14} style={{ transform: inlineOpen ? "rotate(180deg)" : undefined }} />}
                label={inlineOpen ? "Hide reconciliation breakdown" : "Show reconciliation breakdown"}
                onClick={() => { setMenuOpen(false); setInlineOpen((o) => !o); }}
              />
              <div className="pg-menu-sep" />
              <ExportItem icon={<Copy size={14} />} label="Copy summary" onClick={() => { setMenuOpen(false); onCopy?.(c); }} />
              <ExportItem icon={<Printer size={14} />} label="Generate PDF" onClick={() => { setMenuOpen(false); onPdf?.(c); }} />
            </div>
          )}
        </span>
      </div>

      {inlineOpen && (
        <div className="pg-row-inline">
          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Reconciliation overview</div>
            {isPackage && c.pkg != null ? (
              <>
                <div className="pg-row-inline__barhead">
                  <span>worked {fmt(worked)} h</span>
                  {c.remaining != null && (
                    <span style={{ color: statusTone }}>{c.remaining < 0 ? "over" : "under"} {fmt(Math.abs(c.remaining))} h</span>
                  )}
                </div>
                <div className="pg-bar-track" style={{ marginTop: 6 }}>
                  <div className="pg-bar-fill" style={{ width: `${workedPct}%`, background: statusTone || "var(--status-ok)" }} />
                  <div className="pg-bar-mark" style={{ left: `${pkgPct}%` }} />
                </div>
                <div className="pg-bar-caption" style={{ marginTop: 6 }}>
                  <span>package {fmt(pkg)} h</span>
                  <span>carry-over {fmt(carry)} h</span>
                </div>
              </>
            ) : (
              <div className="pg-row-inline__empty">No package on file for this client.</div>
            )}
          </div>

          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Consultants involved</div>
            {consultantEntries.length === 0 && <div className="pg-row-inline__empty">No consultants logged.</div>}
            {shownConsultants.map(([u, min]) => (
              <div key={u || "unknown"} className="pg-row-inline__line">
                <span>{u || "—"}</span>
                <span className="pg-row-inline__line-num">{fmt(min / 60)} h · {consultantTotal > 0 ? Math.round((min / consultantTotal) * 100) : 0}%</span>
              </div>
            ))}
            {consultantEntries.length > 3 && (
              <button className="pg-row-inline__more" onClick={() => setConsultantsAllShown((o) => !o)}>
                {consultantsAllShown ? "Show fewer" : `View all ${consultantEntries.length} consultants`}
              </button>
            )}
          </div>

          <div className="pg-row-inline__col">
            <div className="pg-row-inline__title">Tasks worked {tasksAllShown ? "" : "(top 3)"}</div>
            {taskEntries.length === 0 && <div className="pg-row-inline__empty">No tasks in this filter.</div>}
            {shownTasks.map(([task, min]) => (
              <div key={task} className="pg-row-inline__line">
                <span className="pg-row-inline__task">{task}</span>
                <span className="pg-row-inline__line-num">{fmt(min / 60)} h</span>
              </div>
            ))}
            {taskEntries.length > 3 && (
              <button className="pg-row-inline__more" onClick={() => setTasksAllShown((o) => !o)}>
                {tasksAllShown ? "Show fewer" : `View all ${taskEntries.length} tasks`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Full client detail — right-side drawer, opened by clicking a row. Reuses exactly
// the same computed fields the row above reads from (client.*), just laid out for
// a deeper single-client view: reconciliation bar, consultant contributions, tasks.
function ClientDrawer({ client: c, invoiceMonth, priorMonthPretty, monthProgress, hasUser, consultantFilter, accruedNames, usedAccruedNames, syncMeta, capPeople, onClose, onSetMatch, onCopy, onPdf, onViewProfile, copied }) {
  const isPackage = isPackageLikeType(c.type);
  const isQld = c.type === "queensland";
  const [drillConsultant, setDrillConsultant] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [consultantsOpen, setConsultantsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Reset local drill/expand state whenever a different client is opened, so the
  // drawer never opens already scrolled into a previous client's drill-down.
  useEffect(() => { setDrillConsultant(null); setTasksOpen(false); setConsultantsOpen(false); }, [c.name]);

  useEscape(onClose);

  const drillTasks = drillConsultant ? (c.tasksByUser.get(drillConsultant) || new Map()) : null;
  const tasksShown = drillTasks ?? c.tasksFiltered;
  const taskUsersShown = drillConsultant
    ? new Map([...tasksShown.keys()].map((task) => [task, new Map([[drillConsultant, tasksShown.get(task)]])]))
    : c.taskUsersFiltered;
  const workedShown = drillConsultant ? ((c.userMinutes.get(drillConsultant) || 0) / 60) : c.workedFiltered;

  const selectConsultant = (u) => {
    setDrillConsultant((prev) => (prev === u ? null : u));
    setTasksOpen(true);
  };

  const consultantEntries = [...c.userMinutes.entries()].sort((a, b) => b[1] - a[1]);
  const consultantTotal = consultantEntries.reduce((a, [, min]) => a + min, 0);
  const shownConsultants = consultantsOpen ? consultantEntries : consultantEntries.slice(0, 3);
  const taskEntries = [...tasksShown.entries()].sort((a, b) => b[1] - a[1]);
  const shownTasks = tasksOpen ? taskEntries : taskEntries.slice(0, 3);

  const statusLabel = !isPackage ? null : c.pkg == null ? "No package on file"
    : c.status === "over" ? "Over-serviced" : c.status === "under" ? "Under-serviced" : "On track";
  const statusTone = !isPackage ? undefined : c.status === "over" ? "var(--status-over)" : c.status === "under" ? "var(--status-warn)" : c.status === "ok" ? "var(--status-ok)" : "var(--fg-tertiary)";
  const iconTone = isPackage
    ? (c.status === "over" ? "var(--status-over)" : c.status === "under" ? "var(--status-warn)" : "var(--status-ok)")
    : isQld ? "var(--status-info)" : "var(--accent)";

  return (
    <>
      <aside className="pg-drawer pg-drawer--push" role="dialog" aria-label={`${c.displayName} detail`}>
        <div className="pg-drawer__header">
          <button className="pg-drawer__icon-btn" onClick={onClose} aria-label="Back" title="Back">
            <ArrowLeft size={16} />
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
            <button className="pg-drawer__icon-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="More actions" title="More actions">
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div className="pg-menu" style={{ top: "calc(100% + 4px)" }}>
                <ExportItem icon={<Copy size={14} />} label="Copy summary" onClick={() => { setMenuOpen(false); onCopy(); }} />
                <ExportItem icon={<Printer size={14} />} label="Generate PDF" onClick={() => { setMenuOpen(false); onPdf(); }} />
              </div>
            )}
            <button className="pg-drawer__icon-btn" onClick={onClose} aria-label="Close" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="pg-drawer__title-row">
          {c.logoUrl ? (
            <ClientAvatar name={c.displayName} logo={c.logoUrl} size={40} style={{ borderRadius: "var(--app-radius-sm)" }} />
          ) : (
            <div className="pg-drawer__avatar" style={{ color: iconTone, background: "var(--accent-soft)" }}>
              <BarChart3Icon />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pg-drawer__name">
              {c.displayName}
              {c.isOffboarded && <span className="pg-tag pg-tag--muted pg-tag--pill" style={{ marginLeft: 6 }} title={c.offboardNote}>Offboarded</span>}
            </div>
            <div className="pg-drawer__sub">
              {TYPE_LABELS_SHORT[c.type]}
              {c.isMap && " · MAP"}
              {c.typeTransitioned && " · scheduled change"}
            </div>
          </div>
          {statusLabel && (
            <span className="pg-status-pill pg-status-pill--computed" style={{ color: statusTone, background: "var(--bg-elevated)" }} title="Computed automatically from worked hours vs. package — not manually settable">
              {statusLabel} <ChevronDown size={11} />
            </span>
          )}
        </div>

        {c.matched && c.accruedClient.name !== c.name && (
          <div className="pg-drawer__linked">
            <Link2 size={12} /> ClickUp folder: {c.name}
            {c.matchInfo && c.matchInfo.confidence < 1 && (
              <span className="pg-tag" style={{ color: "var(--accent)" }}>{Math.round(c.matchInfo.confidence * 100)}% match</span>
            )}
          </div>
        )}

        {!isPackage && (
          <div className="pg-alertbar" style={{ marginTop: 12, background: isQld ? "var(--status-info-soft)" : "var(--accent-soft)", color: isQld ? "var(--status-info)" : "var(--accent)" }}>
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

        <div className="pg-drawer__section">
          <div className="pg-drawer__field-row">
            <div className="pg-drawer__field">
              <span className="pg-field__label">Invoice month</span>
              <span className="pg-drawer__field-value">{invoiceMonth || "—"}</span>
            </div>
            {statusLabel && (
              <div className="pg-drawer__field">
                <span className="pg-field__label">Status</span>
                <span className="pg-drawer__field-value" style={{ color: statusTone, fontSize: 14 }}>{statusLabel}</span>
              </div>
            )}
          </div>

          {isPackage ? (
            <div className="pg-metrics" style={{ marginTop: 14 }}>
              <Metric label={consultantFilter ? `Worked (by ${consultantFilter})` : "Worked"} value={`${fmt(c.workedFiltered)} h`} big />
              <Metric label="Package" value={c.pkg != null ? `${fmt(c.pkg)} h` : "—"} />
              <Metric
                label={c.priorBalance != null && c.priorBalance < 0 ? "Carried in" : c.priorBalance != null && c.priorBalance > 0 ? "Over-used prior" : "Carry-over"}
                value={c.priorBalance != null ? `${fmt(Math.abs(c.priorBalance))} h` : "—"}
                tone={c.priorBalance != null && c.priorBalance > 0 ? "var(--status-over)" : c.priorBalance != null && c.priorBalance < 0 ? "var(--status-ok)" : undefined}
                sub={priorMonthPretty ? `from ${priorMonthPretty}` : null}
                flag={c.priorBalanceEstimated ? {
                  text: "estimated",
                  title: `The accrued sheet has no column for ${priorMonthPretty || "the prior month"} — this figure is estimated from ClickUp hours worked that month instead of the sheet's own recorded balance. Re-upload the accrued sheet with that month's column once it's available for the verified number.`,
                } : c.priorMismatch ? {
                  text: "mismatch identified",
                  title: `Accrued sheet says ${fmt(c.priorMismatch.sheetValue)} h${priorMonthPretty ? ` for ${priorMonthPretty}` : ""}, but recalculating from the current ClickUp data for that month gives ${fmt(c.priorMismatch.recomputed)} h. Likely a ClickUp entry was edited after the sheet was last updated.`,
                } : null} />
            </div>
          ) : (
            <div className="pg-metrics pg-metrics--2" style={{ marginTop: 14 }}>
              <Metric label={consultantFilter ? `Worked (by ${consultantFilter})` : "Worked"} value={`${fmt(c.workedFiltered)} h`} big />
              <Metric label="All consultants total" value={`${fmt(c.worked)} h`} sub={consultantFilter ? "regardless of filter" : null} />
            </div>
          )}

          {isPackage && c.remaining != null && (
            <div className="pg-drawer__overunder">
              <span className="pg-drawer__overunder-label">{c.remaining < 0 ? "Over by" : "Remaining this month"}</span>
              <span className="pg-drawer__overunder-value" style={{ color: c.remaining < 0 ? "var(--status-over)" : c.remaining > 0 ? "var(--status-ok)" : undefined }}>
                {fmt(Math.abs(c.remaining))} h
              </span>
              <span className="pg-drawer__overunder-tag">{c.remaining < 0 ? "over-served" : c.remaining > 0 ? "under-served" : ""}</span>
            </div>
          )}
        </div>

        {isPackage && c.pkg != null && c.pkg > 0 && (
          <div className="pg-drawer__section">
            <div className="pg-drawer__section-title">Reconciliation</div>
            <div className="pg-drawer__recon-row">
              <span>Adjustments (non-billable)</span>
              <span title="Not tracked per-client in this tool yet — always empty">—</span>
            </div>
            <div className="pg-drawer__recon-row">
              <span>Billable total</span>
              <span>{fmt(c.workedFiltered)} h</span>
            </div>
            <PackageBar pkg={c.pkg} worked={c.worked} prior={c.priorBalance ?? 0} status={c.status} monthProgress={monthProgress} />
          </div>
        )}

        {consultantEntries.length > 0 && (
          <div className="pg-drawer__section">
            <div className="pg-drawer__section-title">Consultant contributions</div>
            <div className="pg-drawer__contrib-list">
              {shownConsultants.map(([u, min]) => {
                const active = drillConsultant ? u === drillConsultant : (consultantFilter && u === consultantFilter);
                const pct = consultantTotal > 0 ? Math.round((min / consultantTotal) * 100) : 0;
                const matchedPerson = u ? findPersonMatch(u, capPeople) : null;
                return (
                  <button
                    key={u || "unknown"}
                    type="button"
                    onClick={() => selectConsultant(u)}
                    className={"pg-drawer__contrib" + (active ? " pg-drawer__contrib--active" : "")}
                    title={drillConsultant === u ? "Clear — show all tasks again" : `See the tasks behind ${u || "this consultant"}'s hours`}
                  >
                    <PersonAvatar name={u} photo={matchedPerson?.photo} size={26} style={{ borderRadius: "var(--app-radius-pill)" }} />
                    <span className="pg-drawer__contrib-name">{u || "—"}</span>
                    <span className="pg-drawer__contrib-hrs">{fmt(min / 60)} h</span>
                    <span className="pg-drawer__contrib-pct">{pct}%</span>
                  </button>
                );
              })}
            </div>
            {consultantEntries.length > 3 && (
              <button className="pg-manual-note" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setConsultantsOpen((o) => !o)}>
                <span style={{ color: "var(--accent)" }}>{consultantsOpen ? "Show fewer" : `View all ${consultantEntries.length} consultants`}</span>
              </button>
            )}
          </div>
        )}

        <div className="pg-drawer__section">
          <div className="pg-drawer__section-title">
            Tasks {drillConsultant ? `worked by ${drillConsultant}` : consultantFilter ? `worked by ${consultantFilter}` : "worked this month"}
          </div>
          <div className="pg-drawer__bubble">
            <table className="pg-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th className="right num" style={{ width: 90 }}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {shownTasks.map(([task, min]) => {
                  const taskUrl = clickupTaskUrl(c.taskIds?.get(task));
                  return (
                    <tr key={task}>
                      <td>
                        {taskUrl ? (
                          <a href={taskUrl} target="_blank" rel="noopener noreferrer" title="Open this task in ClickUp" className="pg-clickup-link">
                            {task}
                          </a>
                        ) : task}
                        {hasUser && <div style={{ fontSize: 11, color: "var(--fg-tertiary)", marginTop: 2 }}><TaskUsersCell userMinutesMap={taskUsersShown?.get(task)} taskUrl={taskUrl} /></div>}
                      </td>
                      <td className="right num">{fmt(min / 60)}</td>
                    </tr>
                  );
                })}
                {taskEntries.length === 0 && (
                  <tr><td colSpan={2} className="empty">No tasks in this filter.</td></tr>
                )}
                <tr className="total">
                  <td>Total</td>
                  <td className="right num">{fmt(workedShown)}</td>
                </tr>
              </tbody>
            </table>
            {taskEntries.length > 3 && (
              <button className="pg-manual-note" style={{ background: "none", border: 0, cursor: "pointer", padding: 0, marginTop: 8 }} onClick={() => setTasksOpen((o) => !o)}>
                <span style={{ color: "var(--accent)" }}>{tasksOpen ? "Show fewer" : `View all ${taskEntries.length} tasks`}</span>
              </button>
            )}
          </div>
        </div>

        <div className="pg-drawer__footer">
          {onViewProfile && (
            <button onClick={onViewProfile} className="pg-btn-ghost" title="Open this client in the Clients module">
              <Users size={12} /> View full profile
            </button>
          )}
          <button onClick={onCopy} className="pg-btn-ghost">
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "copied" : "Copy summary"}
          </button>
          <button onClick={onPdf} className="pg-btn">
            <Printer size={12} /> Generate PDF
          </button>
        </div>
        <div className="pg-drawer__meta">
          {syncMeta?.last_synced_at ? `Last updated ${timeAgo(syncMeta.last_synced_at)}` : "Not synced yet"}
          {syncMeta?.last_synced_at && <span className="pg-status-pill pg-status-pill--dot" style={{ color: "var(--status-ok)" }}>Synced</span>}
        </div>
      </aside>
    </>
  );
}

// Small inline glyph — avoids importing yet another lucide icon just for the
// drawer's avatar tile; a simple bar-chart mark reads fine at this size.
function BarChart3Icon() {
  return <BarChart3 size={16} />;
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
