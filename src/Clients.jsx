import React, { useState, useEffect, useMemo } from "react";
import { Search, ArrowRight } from "lucide-react";
import { fetchClients, fetchClientEvents, createClientEvent, applyDueClientEvents } from "./clientsSync.js";

const TYPE_LABEL = { package: "Package", hourly: "Hourly", quoted: "Quoted", queensland: "Queensland" };
const TYPES = Object.keys(TYPE_LABEL);
const todayStr = () => new Date().toISOString().slice(0, 10);

function ModifyPanel({ client, onClose, onSaved }) {
  const [action, setAction] = useState(null); // "transition" | "consultant" | "offboarding"
  const [newType, setNewType] = useState(client.type);
  const [newHours, setNewHours] = useState(client.agreedHours ?? "");
  const [newConsultant, setNewConsultant] = useState(client.consultant || "");
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      if (action === "transition") {
        const fields = { new_type: newType, new_agreed_hours: newType === "package" ? Number(newHours) || 0 : null };
        await createClientEvent(client.client, "type", effectiveDate, fields);
      } else if (action === "consultant") {
        await createClientEvent(client.client, "consultant", effectiveDate, { new_consultant: newConsultant || null });
      } else if (action === "offboarding") {
        await createClientEvent(client.client, "offboarding", effectiveDate, {});
      }
      await applyDueClientEvents();
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pg-cap-card" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
      {!action && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pg-btn-ghost" onClick={() => setAction("transition")}>Transitioning</button>
          <button className="pg-btn-ghost" onClick={() => setAction("consultant")}>Consultant Update</button>
          <button className="pg-btn-ghost" onClick={() => setAction("offboarding")}>Offboarding</button>
          <button className="pg-btn-ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Cancel</button>
        </div>
      )}

      {action === "transition" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pg-tag">{TYPE_LABEL[client.type]}{client.type === "package" && client.agreedHours != null ? ` (${client.agreedHours} hrs)` : ""}</span>
            <ArrowRight size={14} />
            <select className="pg-input" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            {newType === "package" && (
              <input className="pg-input" style={{ width: 90 }} type="number" placeholder="hrs" value={newHours} onChange={(e) => setNewHours(e.target.value)} />
            )}
          </div>
          <label className="pg-field">
            <span className="pg-field__label">Effective date</span>
            <input className="pg-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pg-btn" disabled={saving} onClick={save}>Save</button>
            <button className="pg-btn-ghost" onClick={() => setAction(null)}>Back</button>
          </div>
        </div>
      )}

      {action === "consultant" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pg-tag">{client.consultant || "unassigned"}</span>
            <ArrowRight size={14} />
            <input className="pg-input" value={newConsultant} onChange={(e) => setNewConsultant(e.target.value)} placeholder="New consultant" />
          </div>
          <label className="pg-field">
            <span className="pg-field__label">Effective date</span>
            <input className="pg-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pg-btn" disabled={saving} onClick={save}>Save</button>
            <button className="pg-btn-ghost" onClick={() => setAction(null)}>Back</button>
          </div>
        </div>
      )}

      {action === "offboarding" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="pg-field">
            <span className="pg-field__label">Offboarding date</span>
            <input className="pg-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pg-btn" disabled={saving} onClick={save}>Save</button>
            <button className="pg-btn-ghost" onClick={() => setAction(null)}>Back</button>
          </div>
        </div>
      )}
      {err && <div className="pg-banner-warn">{err}</div>}
    </div>
  );
}

export default function Clients() {
  const [clients, setClients] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [openModify, setOpenModify] = useState(null);

  async function load() {
    try {
      await applyDueClientEvents();
      const data = await fetchClients();
      setClients(data);
    } catch (e) {
      setLoadError(e.message || String(e));
      setClients((c) => c ?? []);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (q && !c.client.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      return true;
    });
  }, [clients, search, statusFilter, typeFilter]);

  if (clients === null) return <div className="pg-cap-container"><div className="pg-empty">Loading…</div></div>;

  return (
    <div className="pg-cap-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">Clients</h1>
          <p className="pg-app-header__sub">Client roster — package/hourly/quoted type, consultant, and lifecycle. Changes are scheduled with an effective date and roll out across the system from that date.</p>
        </div>
      </div>

      {loadError && <div className="pg-banner-warn">{loadError}</div>}

      <div className="pg-panel" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <label className="pg-field" style={{ width: 240 }}>
          <span className="pg-field__label"><Search size={11} /> Client</span>
          <input className="pg-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" />
        </label>
        <label className="pg-field">
          <span className="pg-field__label">Status</span>
          <select className="pg-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="offboarded">Offboarded</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="pg-field">
          <span className="pg-field__label">Type</span>
          <select className="pg-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All</option>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
      </div>

      <div className="pg-cap-card" style={{ overflowX: "auto" }}>
        <table className="pg-table">
          <thead>
            <tr>
              <th>Client</th><th>Type</th><th>Consultant</th><th>Start Date</th><th>End Date</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <React.Fragment key={c.client}>
                <tr>
                  <td>{c.client}</td>
                  <td>{TYPE_LABEL[c.type]}{c.type === "package" && c.agreedHours != null ? ` — ${c.agreedHours} hrs` : ""}</td>
                  <td>{c.consultant || "—"}</td>
                  <td>{c.startDate || "—"}</td>
                  <td>{c.endDate || "—"}</td>
                  <td>{c.status === "offboarded" ? <span className="pg-tag pg-tag--muted">Offboarded</span> : ""}</td>
                  <td><button className="pg-btn" onClick={() => setOpenModify(openModify === c.client ? null : c.client)}>Modify</button></td>
                </tr>
                {openModify === c.client && (
                  <tr><td colSpan={7}>
                    <ModifyPanel client={c} onClose={() => setOpenModify(null)} onSaved={() => { setOpenModify(null); load(); }} />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pg-footnote">Purple Giraffe · Clients · Transitions, consultant reassignments, and offboarding are scheduled by effective date and applied automatically once that date arrives.</p>
    </div>
  );
}
