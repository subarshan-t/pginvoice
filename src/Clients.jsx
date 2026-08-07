import React, { useState, useEffect, useMemo } from "react";
import { Search, ArrowRight, Pencil, Check, AlertTriangle, Upload, X } from "lucide-react";
import { fetchClients, fetchClientEvents, createClientEvent, applyDueClientEvents, updateClickupFolder, updateClientWebsite, updateClientLogo, faviconUrlFor } from "./clientsSync.js";
import { idbGet, PG_DATA_EVENT } from "./idbStore.js";
import { CLICKUP_DB_KEY, PG_CLIENTS_KEY } from "./storageKeys.js";
import { ClientAvatar, resizePhotoFile } from "./avatar.jsx";

// Popover for a client's logo -- upload an image directly, or type in the
// client's website and let a favicon service supply the logo automatically.
function LogoEditor({ client, onClose, onSaved }) {
  const [website, setWebsite] = useState(client.website || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function saveWebsite() {
    setSaving(true);
    setErr(null);
    try {
      await updateClientWebsite(client.client, website.trim());
      onSaved({ website: website.trim() || null, logoUrl: faviconUrlFor(website.trim()) });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setErr(null);
    resizePhotoFile(file, async (dataUrl) => {
      try {
        await updateClientLogo(client.client, dataUrl);
        onSaved({ logoUrl: dataUrl });
      } catch (err2) {
        setErr(err2.message || String(err2));
      } finally {
        setSaving(false);
      }
    }, (msg) => { setErr(msg); setSaving(false); });
  }

  async function clearLogo() {
    setSaving(true);
    try {
      await updateClientLogo(client.client, null);
      onSaved({ logoUrl: null });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pg-menu" style={{ top: "calc(100% + 4px)", left: 0, right: "auto", width: 280, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}
      onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ClientAvatar name={client.client} logo={client.logoUrl} size={40} />
        <div style={{ fontSize: 12, color: "var(--fg-secondary)" }}>Logo / website for {client.client}</div>
      </div>
      <label className="pg-field">
        <span className="pg-field__label">Website</span>
        <input className="pg-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. clientdomain.com"
          onKeyDown={(e) => { if (e.key === "Enter") saveWebsite(); }} />
      </label>
      <button className="pg-btn" disabled={saving} onClick={saveWebsite}>Save & fetch favicon</button>
      <label className="pg-btn-ghost" style={{ justifyContent: "center", gap: 6, cursor: "pointer" }}>
        <Upload size={12} /> Upload logo instead
        <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} disabled={saving} />
      </label>
      {client.logoUrl && (
        <button className="pg-btn-ghost" disabled={saving} onClick={clearLogo} style={{ justifyContent: "center", gap: 6 }}>
          <X size={12} /> Remove logo
        </button>
      )}
      {err && <p className="pg-footnote" style={{ color: "var(--status-over)" }}>{err}</p>}
      <button className="pg-btn-ghost" style={{ justifyContent: "center" }} onClick={onClose}>Close</button>
    </div>
  );
}

const TYPE_LABEL = {
  package: "Package", hourly: "Hourly", quoted: "Quoted", queensland: "Queensland",
  map: "MAP", project: "Project", strategy: "Strategy", ad_hoc: "Ad hoc",
};
const TYPES = Object.keys(TYPE_LABEL);
// Strategy is an ongoing engagement with agreed recurring hours -- same fixed-hours
// accrual shape as Package (see accrualsSync.js) -- so it needs the same "agreed hours"
// field wherever the UI asks for a Package's monthly commitment.
const isPackageLikeType = (t) => t === "package" || t === "strategy";
const todayStr = () => new Date().toISOString().slice(0, 10);

// Client names carry their state as a "(Qld)"/"(WA)" suffix rather than a dedicated
// column -- this just reads that same convention back out for the snapshot breakdown.
function stateOf(clientName) {
  const n = (clientName || "").toLowerCase();
  if (n.includes("(qld)")) return "QLD";
  if (n.includes("(wa)")) return "WA";
  return "SA / Other";
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="pg-stat__value">{value}</div>
      <div className="pg-stat__label">{label}</div>
    </div>
  );
}

function ModifyPanel({ client, onClose, onSaved }) {
  const [action, setAction] = useState(null); // "transition" | "consultant" | "offboarding"
  const [newType, setNewType] = useState(client.type);
  const [newHours, setNewHours] = useState(client.agreedHours ?? "");
  const [newConsultant, setNewConsultant] = useState(client.consultant || "");
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const isActive = client.status === "active";

  async function save() {
    // A blank hours field on a Package transition used to silently submit 0 -- a real,
    // billable "0 hrs/month" package, indistinguishable from someone just not having
    // filled the field in yet. Block the save and say so instead of guessing.
    if (action === "transition" && isPackageLikeType(newType) && newHours.trim() === "") {
      setErr("Enter the agreed hours for this package (or choose a different type).");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      if (action === "transition") {
        const fields = { new_type: newType, new_agreed_hours: isPackageLikeType(newType) ? Number(newHours) || 0 : null };
        await createClientEvent(client.client, "type", effectiveDate, fields);
      } else if (action === "consultant") {
        await createClientEvent(client.client, "consultant", effectiveDate, { new_consultant: newConsultant || null });
      } else if (action === "offboarding") {
        await createClientEvent(client.client, "offboarding", effectiveDate, {});
      } else if (action === "reactivate") {
        await createClientEvent(client.client, "reactivation", effectiveDate, {});
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
          {isActive ? (
            <button className="pg-btn-ghost" onClick={() => setAction("offboarding")}>Offboarding</button>
          ) : (
            <button className="pg-btn-ghost" onClick={() => setAction("reactivate")}>Reactivate</button>
          )}
          <button className="pg-btn-ghost" style={{ marginLeft: "auto" }} onClick={onClose}>Cancel</button>
        </div>
      )}

      {action === "transition" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pg-tag">{TYPE_LABEL[client.type]}{isPackageLikeType(client.type) && client.agreedHours != null ? ` (${client.agreedHours} hrs)` : ""}</span>
            <ArrowRight size={14} />
            <select className="pg-input" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            {isPackageLikeType(newType) && (
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

      {action === "reactivate" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pg-tag pg-tag--muted">{client.status === "archived" ? "Archived (unverified)" : "Offboarded"}</span>
            <ArrowRight size={14} />
            <span className="pg-tag">Active</span>
          </div>
          <label className="pg-field">
            <span className="pg-field__label">Reactivation date</span>
            <input className="pg-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
          <p className="pg-footnote">Clears the end date and sets status back to active. Type, agreed hours, and consultant stay as they were — use Transitioning/Consultant Update afterward if those need to change too.</p>
          {client.status === "archived" && (
            <p className="pg-footnote" style={{ color: "var(--status-warn)" }}>
              This client was marked "Archived (unverified)" by a bulk data cleanup, not through a real offboarding event — there's no record of it ever actually being offboarded. Reactivating it is a guess that it should be active, not a confirmed correction. Double-check this is the right call before saving.
            </p>
          )}
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
  const [folderSet, setFolderSet] = useState(null); // null = not loaded; Set of real ClickUp folder names once loaded
  const [editingFolder, setEditingFolder] = useState(null); // client name currently being edited
  const [draftFolder, setDraftFolder] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [editingLogo, setEditingLogo] = useState(null); // client name currently showing the logo popover

  const folderList = useMemo(() => (folderSet ? [...folderSet].sort((a, b) => a.localeCompare(b)) : []), [folderSet]);
  const folderSuggestions = useMemo(() => {
    const q = draftFolder.trim().toLowerCase();
    const pool = q ? folderList.filter((f) => f.toLowerCase().includes(q)) : folderList;
    return pool.slice(0, 8);
  }, [folderList, draftFolder]);

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

  async function loadFolders() {
    const cu = await idbGet(CLICKUP_DB_KEY);
    setFolderSet(new Set((cu?.rows || []).map((r) => r.folder).filter(Boolean)));
  }

  useEffect(() => {
    load();
    loadFolders();
    const onUpdate = (e) => {
      if (!e.detail || e.detail.key === CLICKUP_DB_KEY) loadFolders();
      // A consultant/status/new-client change made from Capacity Planning writes to the same
      // pginvoice_clients table -- refresh so it shows here without a full page reload.
      if (!e.detail || e.detail.key === PG_CLIENTS_KEY) load();
    };
    window.addEventListener(PG_DATA_EVENT, onUpdate);
    return () => window.removeEventListener(PG_DATA_EVENT, onUpdate);
  }, []);

  async function saveFolder(client, folderOverride) {
    // Accepts an explicit folder value (used when picking a suggestion, since setDraftFolder
    // just before calling this wouldn't be visible yet — state updates aren't synchronous)
    // and otherwise falls back to whatever's currently in the draft input.
    const folder = (folderOverride ?? draftFolder).trim();
    setSavingFolder(true);
    try {
      await updateClickupFolder(client, folder);
      setClients((prev) => prev.map((c) => (c.client !== client ? c : { ...c, clickupFolder: folder || null })));
      setEditingFolder(null);
    } catch (e) {
      setLoadError("Couldn't save that ClickUp folder name: " + (e.message || e));
    } finally {
      setSavingFolder(false);
    }
  }

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

  const snapshot = useMemo(() => {
    if (!clients) return { total: 0, byState: [] };
    const active = clients.filter((c) => c.status === "active");
    const byState = new Map();
    active.forEach((c) => { const s = stateOf(c.client); byState.set(s, (byState.get(s) || 0) + 1); });
    return { total: active.length, byState: [...byState.entries()].sort((a, b) => b[1] - a[1]) };
  }, [clients]);

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

      <div className="pg-panel" style={{ gap: 24, flexWrap: "wrap" }}>
        <Stat value={snapshot.total} label="Active clients" />
        {snapshot.byState.map(([state, count]) => <Stat key={state} value={count} label={state} />)}
      </div>

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
            <option value="archived">Archived (unverified)</option>
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
              <th>#</th><th></th><th>Client</th><th>Type</th><th>Consultant</th><th>ClickUp Folder</th><th>Start Date</th><th>End Date</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const matched = folderSet && c.clickupFolder && folderSet.has(c.clickupFolder);
              const unmatched = folderSet && c.clickupFolder && !folderSet.has(c.clickupFolder);
              return (
              <React.Fragment key={c.client}>
                <tr>
                  <td style={{ color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)" }}>{i + 1}</td>
                  <td style={{ position: "relative" }}>
                    <button type="button" className="pg-icon-btn-sm" style={{ padding: 0, borderRadius: "50%" }}
                      title="Set client logo / website"
                      onClick={() => setEditingLogo(editingLogo === c.client ? null : c.client)}>
                      <ClientAvatar name={c.client} logo={c.logoUrl} size={28} />
                    </button>
                    {editingLogo === c.client && (
                      <LogoEditor
                        client={c}
                        onClose={() => setEditingLogo(null)}
                        onSaved={(patch) => {
                          setClients((prev) => prev.map((x) => (x.client !== c.client ? x : { ...x, ...patch })));
                          setEditingLogo(null);
                        }}
                      />
                    )}
                  </td>
                  <td>{c.client}</td>
                  <td>{TYPE_LABEL[c.type]}{isPackageLikeType(c.type) && c.agreedHours != null ? ` — ${c.agreedHours} hrs` : ""}</td>
                  <td>{c.consultant || "—"}</td>
                  <td style={{ minWidth: 220 }}>
                    {editingFolder === c.client ? (
                      <div style={{ display: "flex", gap: 4, position: "relative" }}>
                        <input
                          className="pg-input" autoFocus value={draftFolder}
                          onChange={(e) => { setDraftFolder(e.target.value); setFolderMenuOpen(true); }}
                          onFocus={() => setFolderMenuOpen(true)}
                          onBlur={() => setTimeout(() => setFolderMenuOpen(false), 150)}
                          placeholder={folderSet && folderSet.size ? "Type to search live ClickUp folders…" : "Real ClickUp folder name"}
                          onKeyDown={(e) => { if (e.key === "Enter") { saveFolder(c.client); setFolderMenuOpen(false); } if (e.key === "Escape") { setEditingFolder(null); setFolderMenuOpen(false); } }}
                        />
                        <button className="pg-btn-ghost" disabled={savingFolder} onClick={() => saveFolder(c.client)}><Check size={12} /></button>
                        {folderMenuOpen && folderSuggestions.length > 0 && (
                          <div className="pg-menu" style={{ top: "calc(100% + 2px)", left: 0, right: "auto", width: 320, maxHeight: 240, overflow: "auto" }}>
                            {folderSuggestions.map((f) => (
                              <button
                                key={f} type="button" className="pg-menu-item"
                                // onMouseDown (not onClick) fires before the input's onBlur closes the menu
                                onMouseDown={() => { setDraftFolder(f); saveFolder(c.client, f); setFolderMenuOpen(false); }}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                        onClick={() => { setEditingFolder(c.client); setDraftFolder(c.clickupFolder || ""); }}
                        title={matched ? "Matches a real ClickUp folder" : unmatched ? "This folder name isn't in the currently-synced ClickUp data -- may be renamed, archived, or a typo" : "No ClickUp folder set for this client"}
                      >
                        {matched && <span style={{ color: "var(--status-ok)" }}>✓</span>}
                        {unmatched && <AlertTriangle size={12} style={{ color: "var(--status-warn)" }} />}
                        <span style={{ flex: 1, color: c.clickupFolder ? undefined : "var(--fg-tertiary)" }}>{c.clickupFolder || "Not set"}</span>
                        <Pencil size={11} />
                      </div>
                    )}
                  </td>
                  <td>{c.startDate || "—"}</td>
                  <td>{c.endDate || "—"}</td>
                  <td>
                    {c.status === "offboarded" && <span className="pg-tag pg-tag--muted">Offboarded</span>}
                    {c.status === "archived" && <span className="pg-tag pg-tag--muted" title="Not found in any of the PG Four Lists (Active/Inactive/Hours Changed/Type Changed) as of the 31 Jul 2026 refresh -- status unverified, needs manual confirmation.">Archived (unverified)</span>}
                  </td>
                  <td><button className="pg-btn" onClick={() => setOpenModify(openModify === c.client ? null : c.client)}>Modify</button></td>
                </tr>
                {openModify === c.client && (
                  <tr><td colSpan={10}>
                    <ModifyPanel client={c} onClose={() => setOpenModify(null)} onSaved={() => { setOpenModify(null); load(); }} />
                  </td></tr>
                )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pg-footnote">Purple Giraffe · Clients · Transitions, consultant reassignments, and offboarding are scheduled by effective date and applied automatically once that date arrives.</p>
    </div>
  );
}
