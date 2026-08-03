import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, X, MoreVertical, AlertTriangle, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { SEED_PEOPLE, loadKey, MONTHS, CURRENT_MONTH, MONTH_LABELS, computeMonthlyAvailability } from "./CapacityDashboard.jsx";
import { normalizeName } from "./nameMatch.js";
import { saveState } from "./capacityStore.js";
import { PG_DATA_EVENT } from "./idbStore.js";

const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const ROLES = ["Consultant", "Coordinator"];
const STATES = ["SA", "WA", "QLD"];

function Picker({ value, options, onChange }) {
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
        <span>{current ? current.label : "Select…"}</span>
      </button>
      {open && (
        <div className="pg-menu" style={{ minWidth: 120 }}>
          {options.map((o) => (
            <button key={o.value} type="button" className="pg-menu-item" onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ROSTER MENU — per-person "⋮" popover for resignation date + ClickUp alias.
   Rendered via a portal into document.body with fixed positioning, same as
   Capacity Planning previously did, so it escapes any scrolling ancestor.
============================================================ */
function RosterMenu({ person, onUpdate, aliasConflict }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 260;
    let left = r.right - menuWidth;
    if (left < 8) left = 8;
    let top = r.bottom + 4;
    const estMenuHeight = 260;
    if (top + estMenuHeight > window.innerHeight - 8) top = Math.max(8, r.top - estMenuHeight - 4);
    setPos({ top, left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" className="pg-btn-ghost" style={{ padding: "4px 7px" }} onClick={() => (open ? setOpen(false) : openMenu())}>
        <MoreVertical size={13} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="pg-menu" style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto", margin: 0, minWidth: 260, padding: 12, zIndex: 1000 }}>
          <div className="pg-field__label">Resignation date</div>
          <input
            className="pg-input" type="date" style={{ marginTop: 4, width: "100%" }}
            value={person.resignationDate || ""}
            onChange={(e) => onUpdate("resignationDate", e.target.value || null)}
          />
          {person.resignationDate && (
            <button className="pg-btn-ghost" style={{ marginTop: 6 }} onClick={() => onUpdate("resignationDate", null)}>
              <X size={11} /> Clear resignation date
            </button>
          )}

          <div className="pg-field__label" style={{ marginTop: 12 }}>ClickUp alias</div>
          <p className="pg-footnote" style={{ marginTop: 2, marginBottom: 4 }}>
            Only needed if their ClickUp username doesn't match "{person.name}", e.g. a full name ClickUp shows that this roster's short name can't fuzzy-match.
          </p>
          <input
            className="pg-input" type="text" style={{ width: "100%" }}
            placeholder="e.g. Kelly Wagner"
            value={person.alias || ""}
            onChange={(e) => onUpdate("alias", e.target.value)}
          />
          {aliasConflict && (
            <div className="pg-banner-warn" style={{ marginTop: 8, padding: "8px 10px", fontSize: 11 }}>
              <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
              Also matched to {aliasConflict.join(", ")} — hours for this alias will be double-counted until only one person uses it.
            </div>
          )}

          <button className="pg-btn" style={{ marginTop: 10, width: "100%", justifyContent: "center" }} onClick={() => setOpen(false)}>Done</button>
        </div>,
        document.body
      )}
    </>
  );
}

/* ============================================================
   ADD PERSON — small inline form shown under the roster table in edit mode
============================================================ */
function AddPersonForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", role: "Consultant", state: "SA", contracted: 38, rate: 0.7 });
  const set = (field) => (v) => setForm((f) => ({ ...f, [field]: v }));

  if (!open) {
    return (
      <button className="pg-btn-ghost" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        <Plus size={12} /> Add person
      </button>
    );
  }
  return (
    <div className="pg-cap-addform" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="pg-input" style={{ width: 140 }} placeholder="Name" value={form.name} onChange={(e) => set("name")(e.target.value)} />
        <div style={{ width: 140 }}>
          <Picker value={form.role} options={[{ value: "Consultant", label: "Consultant" }, { value: "Coordinator", label: "Coordinator" }]} onChange={set("role")} />
        </div>
        <div style={{ width: 90 }}>
          <Picker value={form.state} options={[{ value: "SA", label: "SA" }, { value: "WA", label: "WA" }, { value: "QLD", label: "QLD" }]} onChange={set("state")} />
        </div>
        <input className="pg-input" type="number" step="any" style={{ width: 110 }} placeholder="Hrs/wk" value={form.contracted} onChange={(e) => set("contracted")(e.target.value)} />
        <input className="pg-input" type="number" min="0" max="100" step="1" style={{ width: 110 }} placeholder="Billable %" value={Math.round(form.rate * 100)} onChange={(e) => set("rate")((Number(e.target.value) || 0) / 100)} />
        <button className="pg-btn" onClick={() => { onAdd(form); setForm({ name: "", role: "Consultant", state: "SA", contracted: 38, rate: 0.7 }); setOpen(false); }} disabled={!form.name.trim()}>
          <Plus size={13} /> Add
        </button>
        <button className="pg-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("TeamDashboard error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, padding: 24, margin: 24, color: "var(--status-over)", background: "var(--status-over-soft)", borderRadius: "var(--app-radius)", whiteSpace: "pre-wrap" }}>
          <b>Something broke while rendering this dashboard:</b>
          {"\n\n"}{String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          {"\n\n"}{this.state.error && this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

function TeamDashboardInner() {
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [editing, setEditing] = useState(false);
  const [qRoster, setQRoster] = useState("");
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [leaves, setLeaves] = useState({}); // key: `${personId}_${month}` -> hours, read-only mirror of Capacity Planning's
  const ownWrite = useRef(false); // suppress reloading our own save's echoed PG_DATA_EVENT

  // Leaves are edited in Capacity Planning (they're tied to its month picker), but the
  // Availability list below needs the same numbers Capacity Planning uses, so it mirrors
  // that key here read-only, refreshing whenever Capacity Planning saves an edit.
  useEffect(() => {
    let cancelled = false;
    const load = () => loadKey("cap_leaves", {}).then((v) => { if (!cancelled) setLeaves(v); });
    load();
    const onUpdate = (e) => { if (!e.detail || e.detail.key === "cap_leaves") load(); };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);

  // Reads/writes the same "cap_people" key Capacity Planning uses (Supabase-backed via
  // capacityStore.js), so a person added, removed, or edited here is immediately reflected
  // there — and vice versa — via the shared PG_DATA_EVENT both modules listen for.
  useEffect(() => {
    let cancelled = false;
    const load = () => loadKey("cap_people", SEED_PEOPLE).then((v) => { if (!cancelled) setPeople(v); });
    load().then(() => { if (!cancelled) setLoaded(true); });
    const onUpdate = (e) => {
      if (e.detail && e.detail.key !== "cap_people") return;
      if (ownWrite.current) { ownWrite.current = false; return; }
      load();
    };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => { cancelled = true; window.removeEventListener(PG_DATA_EVENT, onUpdate); };
  }, []);
  useEffect(() => { if (loaded) { ownWrite.current = true; saveState("cap_people", people); } }, [people, loaded]);

  const updatePerson = useCallback((id, field, value) => {
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }, []);
  const removePerson = useCallback((id) => {
    setPeople((ps) => ps.filter((p) => p.id !== id));
  }, []);
  const addPerson = useCallback((form) => {
    const name = (form.name || "").trim();
    if (!name) return;
    setPeople((ps) => [...ps, {
      id: uid("p"), name, role: form.role || "Consultant", state: form.state || "SA",
      contracted: Number(form.contracted) || 0, rate: Number(form.rate) || 0,
      note: "", resignationDate: null, alias: "",
    }]);
  }, []);

  // A person's alias identifies who owns a ClickUp username for downstream matching — if
  // two people end up sharing an alias, or someone's alias collides with another person's
  // own name, that ClickUp user's hours would silently get attributed to (and thus
  // double-counted for) more than one person. Detect that here for the per-row menu and banner.
  const aliasConflicts = useMemo(() => {
    const owners = new Map();
    people.forEach((p) => {
      const keys = new Set([normalizeName(p.name)]);
      if (p.alias && p.alias.trim()) keys.add(normalizeName(p.alias));
      keys.forEach((k) => {
        if (!k) return;
        if (!owners.has(k)) owners.set(k, []);
        owners.get(k).push(p);
      });
    });
    const conflicts = new Map();
    owners.forEach((owningPeople) => {
      if (owningPeople.length < 2) return;
      owningPeople.forEach((p) => {
        const others = owningPeople.filter((o) => o.id !== p.id).map((o) => o.name);
        if (others.length) conflicts.set(p.id, [...(conflicts.get(p.id) || []), ...others]);
      });
    });
    return conflicts;
  }, [people]);

  const visiblePeople = people.filter((p) => !qRoster || p.name.toLowerCase().includes(qRoster.toLowerCase()));

  // Active team members for the selected month, with their billable/non-billable
  // availability — computed via computeMonthlyAvailability, the exact same function
  // Capacity Planning's peopleMap calls, so the numbers here and there never drift.
  const availability = useMemo(() => {
    return people
      .map((p) => {
        const leaveHrs = Number(leaves[`${p.id}_${month}`] || 0);
        const avail = computeMonthlyAvailability(p, month, leaveHrs);
        return avail ? { person: p, ...avail } : null;
      })
      .filter(Boolean)
      .filter((row) => !qRoster || row.person.name.toLowerCase().includes(qRoster.toLowerCase()));
  }, [people, leaves, month, qRoster]);

  const monthIdx = MONTHS.indexOf(month);
  const shiftMonth = (d) => setMonth(MONTHS[Math.max(0, Math.min(MONTHS.length - 1, monthIdx + d))]);

  if (!loaded) {
    return <div className="pg-cap-container"><div className="pg-empty">Loading…</div></div>;
  }

  return (
    <div className="pg-cap-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">Team — the roster that drives Capacity Planning &amp; Performance.</h1>
        </div>
      </div>

      {aliasConflicts.size > 0 && (
        <div className="pg-banner-warn" style={{ marginTop: 14 }}>
          {[...aliasConflicts.entries()].map(([id, others]) => {
            const p = people.find((pp) => pp.id === id);
            if (!p) return null;
            return <div key={id}>{p.name}'s name/alias is shared with {others.join(", ")} — their ClickUp hours will be double-counted until this is fixed.</div>;
          })}
        </div>
      )}

      <div className="pg-table-wrap" style={{ marginTop: 14 }}>
        <div className="pg-table-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>Team roster</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--fg-tertiary)" }} />
              <input
                className="pg-input"
                style={{ width: 160, padding: "5px 8px 5px 24px", fontSize: 12 }}
                placeholder="Search consultant…"
                value={qRoster}
                onChange={(e) => setQRoster(e.target.value)}
              />
            </div>
            <button className="pg-btn-ghost" onClick={() => setEditing((v) => !v)}>{editing ? <><Check size={11} /> done</> : <><Pencil size={11} /> edit</>}</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table className="pg-table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Name</th><th>Role</th><th>State</th>
              <th className="right num">Contracted Hrs/wk</th>
              <th className="right num">Billable %</th>
              <th>Note</th>
              {editing && <th></th>}
            </tr>
          </thead>
          <tbody>
            {visiblePeople.map((p) => (
              <tr key={p.id}>
                <td>
                  {editing
                    ? <input className="pg-input" style={{ width: 120, padding: "4px 6px" }} value={p.name} onChange={(e) => updatePerson(p.id, "name", e.target.value)} />
                    : <>{p.name} {p.resignationDate && <span className="pg-tag pg-tag--muted" style={{ marginLeft: 5 }}>[resigns {p.resignationDate}]</span>} {p.alias && <span className="pg-tag pg-tag--muted" style={{ marginLeft: 5 }}>[alias: {p.alias}]</span>}</>}
                </td>
                <td>
                  {editing ? (
                    <select className="pg-select" value={p.role} onChange={(e) => updatePerson(p.id, "role", e.target.value)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="pg-tag" style={{ color: p.role === "Consultant" ? "var(--accent)" : "var(--accent-orchid)" }}>{p.role}</span>
                  )}
                </td>
                <td>
                  {editing ? (
                    <select className="pg-select" value={p.state} onChange={(e) => updatePerson(p.id, "state", e.target.value)}>
                      {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : p.state}
                </td>
                <td className="right num">
                  {editing
                    ? <input className="pg-input" type="number" min="0" step="any" style={{ width: 64, padding: "4px 6px" }} value={p.contracted} onChange={(e) => updatePerson(p.id, "contracted", e.target.value === "" ? 0 : Number(e.target.value))} />
                    : p.contracted}
                </td>
                <td className="right num">
                  {editing
                    ? <input className="pg-input" type="number" min="0" max="100" step="1" style={{ width: 52, padding: "4px 6px" }} value={Math.round(p.rate * 100)} onChange={(e) => updatePerson(p.id, "rate", (e.target.value === "" ? 0 : Number(e.target.value)) / 100)} />
                    : `${(p.rate * 100).toFixed(0)}%`}
                </td>
                <td>
                  {editing
                    ? <input className="pg-input" style={{ width: 200, padding: "4px 6px" }} value={p.note || ""} onChange={(e) => updatePerson(p.id, "note", e.target.value)} />
                    : <span style={{ color: "var(--fg-tertiary)", fontSize: 12 }}>{p.note}</span>}
                </td>
                {editing && (
                  <td style={{ display: "flex", gap: 4 }}>
                    <RosterMenu person={p} onUpdate={(field, value) => updatePerson(p.id, field, value)} aliasConflict={aliasConflicts.get(p.id)} />
                    <button className="pg-btn-ghost" style={{ color: "var(--status-over)", padding: "4px 7px" }} onClick={() => removePerson(p.id)}><X size={12} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {editing && <AddPersonForm onAdd={addPerson} />}
      <p className="pg-footnote">This roster is the shared source of truth for Capacity Planning and Performance — changes here take effect immediately in both. A resignation date set via the ⋮ menu prorates that month's capacity to their last working day, and drops them from later months. Leaves are month-specific and stay editable in Capacity Planning.</p>

      <div className="pg-table-wrap" style={{ marginTop: 20 }}>
        <div className="pg-table-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>Availability</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="pg-btn-ghost" style={{ padding: "5px 8px" }} onClick={() => shiftMonth(-1)} disabled={monthIdx === 0}><ChevronLeft size={12} /></button>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 14, minWidth: 60, textAlign: "center" }}>{MONTH_LABELS[month]}</span>
            <button className="pg-btn-ghost" style={{ padding: "5px 8px" }} onClick={() => shiftMonth(1)} disabled={monthIdx === MONTHS.length - 1}><ChevronRight size={12} /></button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table className="pg-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Active team member</th>
              <th className="right num">Monthly Hrs</th>
              <th className="right num">Billable Hrs</th>
              <th className="right num">Non-billable Hrs</th>
            </tr>
          </thead>
          <tbody>
            {availability.length === 0 && <tr><td colSpan={4} className="empty">No active team members match this search for {MONTH_LABELS[month]}.</td></tr>}
            {availability.map(({ person, totalMonthlyHours, billableHours, nonBillableHours, resigningThisMonth }) => (
              <tr key={person.id}>
                <td>
                  {person.name} <span className="pg-tag" style={{ color: person.role === "Consultant" ? "var(--accent)" : "var(--accent-orchid)", marginLeft: 5 }}>[{person.role[0]}]</span>
                  {resigningThisMonth && <span className="pg-tag pg-tag--muted" style={{ marginLeft: 5 }}>[resigns {person.resignationDate}]</span>}
                </td>
                <td className="right num">{totalMonthlyHours.toFixed(1)}</td>
                <td className="right num"><b>{billableHours.toFixed(1)}</b></td>
                <td className="right num">{nonBillableHours.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <p className="pg-footnote">Lists only team members active in {MONTH_LABELS[month]} (excludes anyone who resigned in an earlier month). Billable/Non-billable Hrs are this person's monthly capacity split by their billable %, before any client demand or support given/received is applied — Capacity Planning's Capacity Utilization view starts from these same numbers.</p>
    </div>
  );
}

export default function TeamDashboard() {
  return (
    <ErrorBoundary>
      <TeamDashboardInner />
    </ErrorBoundary>
  );
}
