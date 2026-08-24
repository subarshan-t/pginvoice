import React, { useEffect, useId, useMemo, useState } from "react";
import { Users as UsersIcon, Trash2, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  fetchUsers, createUser, updateUserRoleAndClients, deleteUser, fetchClickupUserNames,
  ROLES, ROLE_LABELS, CLIENT_SCOPED_ROLES, CLICKUP_REQUIRED_ROLES, CLIENT_SOURCE_LABELS,
} from "./usersSync.js";
import { fetchClients } from "./clientsSync.js";

const emptyDraft = { email: "", password: "", role: "consultant", clients: [], clickupUserName: "" };

// Shared between the "add user" form and each row's edit mode — was two
// near-identical blocks that only differed in which draft/setter they wrote to.
function ClientCheckboxList({ label, options, selected, onToggle }) {
  return (
    <div className="pg-field">
      <span className="pg-field__label">{label}</span>
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border-default)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((c) => (
          <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(c)} onChange={() => onToggle(c)} />
            {c}
          </label>
        ))}
      </div>
    </div>
  );
}

// Autocompletes against ClickUp's own logged names (via a <datalist>, so typing
// still works freely) and flags — hard-blocking submit, per how this is meant to
// be used — a name that doesn't match anything ClickUp has ever seen, for the
// roles whose client access is mostly derived from it. Admin-tier roles get the
// same field but it's optional and never blocks.
function ClickupNameField({ id, listId, value, onChange, clickupNames, required }) {
  const trimmed = value.trim();
  const matched = !trimmed || clickupNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const showFlag = required && trimmed && !matched;
  const showRequiredFlag = required && !trimmed;
  return (
    <label className="pg-field" htmlFor={id}>
      <span className="pg-field__label">ClickUp name{required ? "" : " (optional)"}</span>
      <input
        id={id}
        className="pg-input"
        type="text"
        list={listId}
        autoComplete="off"
        placeholder="Start typing to match their ClickUp name…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {clickupNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      {(showFlag || showRequiredFlag) && (
        <span className="pg-footnote" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--status-warn, var(--status-over))" }}>
          <AlertTriangle size={12} />
          {showRequiredFlag ? "Required for this role." : `No ClickUp user named "${trimmed}" found in synced time entries.`}
        </span>
      )}
    </label>
  );
}

// Super Admin + Admin only (enforced both by Shell.jsx's nav gating and,
// for real, by the manage-users Edge Function checking the caller's role
// server-side before touching anything).
export default function Users({ ownRole, ownUserId }) {
  const [users, setUsers] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [clickupNames, setClickupNames] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const editRoleId = useId();
  const createClickupId = useId();
  const editClickupId = useId();

  // Any in-flight save/delete blocks starting a different one — otherwise
  // clicking Edit on user B while user A's save is still resolving lets A's
  // `load()` land after B's edit has started and clobber editingId/editDraft.
  const busy = savingEdit || deletingId !== null;

  async function load() {
    try {
      const [u, c, names] = await Promise.all([fetchUsers(), fetchClients(), fetchClickupUserNames()]);
      setUsers(u);
      setAllClients((c || []).map((row) => row.client).sort());
      setClickupNames(names);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => { load(); }, []);

  const createClickupValid = useMemo(() => {
    if (!CLICKUP_REQUIRED_ROLES.has(draft.role)) return true;
    const trimmed = draft.clickupUserName.trim();
    return !!trimmed && clickupNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  }, [draft.role, draft.clickupUserName, clickupNames]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!draft.email.trim() || draft.password.length < 8 || !createClickupValid) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createUser({
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
        clients: CLIENT_SCOPED_ROLES.has(draft.role) ? draft.clients : [],
        clickupUserName: draft.clickupUserName.trim(),
      });
      setDraft(emptyDraft);
      setNotice(`${draft.email.trim()} was added.`);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u) {
    if (busy) return;
    setEditingId(u.id);
    // Only the manual-source subset -- saving re-writes source='manual' rows
    // wholesale from this list, so seeding it with ClickUp/Capacity-derived
    // clients too would silently convert them into permanent manual grants,
    // immune to the auto-revoke those sources are supposed to have.
    const manualClients = (u.clientDetails || []).filter((cd) => cd.source === "manual").map((cd) => cd.client);
    setEditDraft({ role: u.role, clients: manualClients, clickupUserName: u.clickupUserName || "" });
  }

  const editClickupValid = useMemo(() => {
    if (!editDraft || !CLICKUP_REQUIRED_ROLES.has(editDraft.role)) return true;
    const trimmed = editDraft.clickupUserName.trim();
    return !!trimmed && clickupNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  }, [editDraft, clickupNames]);

  async function saveEdit(userId) {
    if (!editClickupValid) return;
    setSavingEdit(true);
    setError(null);
    setNotice(null);
    try {
      await updateUserRoleAndClients({
        userId,
        role: editDraft.role,
        clients: CLIENT_SCOPED_ROLES.has(editDraft.role) ? editDraft.clients : [],
        clickupUserName: editDraft.clickupUserName.trim(),
      });
      setEditingId(null);
      setNotice("Role updated.");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(userId) {
    if (userId === ownUserId || busy) return; // belt-and-braces: the button is already hidden for your own row
    if (!window.confirm("Remove this user's access? This cannot be undone.")) return;
    setDeletingId(userId);
    setError(null);
    setNotice(null);
    try {
      await deleteUser(userId);
      setNotice("User removed.");
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleClient(list, client) {
    return list.includes(client) ? list.filter((c) => c !== client) : [...list, client];
  }

  return (
    <div className="pg-app">
      <div className="pg-container">
        <div className="pg-app-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div className="pg-app-header__icon"><UsersIcon size={18} /></div>
            <div>
              <span className="pg-eyebrow">Purple Giraffe · Internal</span>
              <h1 className="pg-app-header__title">Users.</h1>
              <p className="pg-app-header__sub">Add teammates and control what they can see.</p>
            </div>
          </div>
        </div>

        {/* aria-live so screen-reader users hear the outcome of create/save/delete,
            not just sighted users watching the banner appear. */}
        <div aria-live="polite">
          {error && <p className="pg-footnote" style={{ color: "var(--status-over)" }}>{error}</p>}
          {notice && !error && <p className="pg-footnote" style={{ color: "var(--status-ok)" }}>{notice}</p>}
        </div>

        <div className="pg-cap-card" style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={16} />
            <h2 style={{ margin: 0, fontSize: 15 }}>Add a user</h2>
          </div>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="pg-field">
              <span className="pg-field__label">Email</span>
              <input className="pg-input" type="email" autoComplete="off" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            </label>
            <label className="pg-field">
              <span className="pg-field__label">Temporary password</span>
              <input className="pg-input" type="text" autoComplete="off" placeholder="At least 8 characters" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} />
            </label>
            <p className="pg-footnote">They'll be asked to set their own password the first time they sign in.</p>
            <label className="pg-field">
              <span className="pg-field__label">Role</span>
              <select className="pg-input" value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value, clients: [] }))}>
                {ROLES.filter((r) => r !== "super_admin" || ownRole === "super_admin").map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <ClickupNameField
              id={createClickupId}
              listId={`${createClickupId}-list`}
              value={draft.clickupUserName}
              onChange={(v) => setDraft((d) => ({ ...d, clickupUserName: v }))}
              clickupNames={clickupNames}
              required={CLICKUP_REQUIRED_ROLES.has(draft.role)}
            />
            {CLICKUP_REQUIRED_ROLES.has(draft.role) && (
              <p className="pg-footnote">
                Matching a ClickUp name auto-assigns the clients they've logged time against — pick from the list below if you'd also like to grant one they haven't worked on yet.
              </p>
            )}
            {CLIENT_SCOPED_ROLES.has(draft.role) && (
              <ClientCheckboxList
                label="Also grant these clients manually"
                options={allClients}
                selected={draft.clients}
                onToggle={(c) => setDraft((d) => ({ ...d, clients: toggleClient(d.clients, c) }))}
              />
            )}
            <button className="pg-btn" type="submit" disabled={creating || !draft.email.trim() || draft.password.length < 8 || !createClickupValid} style={{ justifyContent: "center", gap: 6 }}>
              {creating && <Loader2 size={13} style={{ animation: "pg-spin 1s linear infinite" }} />}
              {creating ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>

        <div className="pg-cap-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Team</h2>
          {users === null ? (
            <p className="pg-footnote">Loading…</p>
          ) : users.length === 0 ? (
            <p className="pg-footnote">No users yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {users.map((u) => {
                const isSelf = u.id === ownUserId;
                return (
                  <div key={u.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{u.email}{isSelf ? " (you)" : ""}</div>
                        <div className="pg-footnote">
                          {editingId === u.id ? "Editing…" : (
                            <>
                              {ROLE_LABELS[u.role] || u.role}
                              {u.clickupUserName ? ` · ClickUp: ${u.clickupUserName}` : ""}
                              {CLICKUP_REQUIRED_ROLES.has(u.role) && !u.clickupUserName && (
                                <span style={{ color: "var(--status-warn, var(--status-over))" }}> · no ClickUp name flagged</span>
                              )}
                            </>
                          )}
                        </div>
                        {editingId !== u.id && u.clientDetails?.length > 0 && (
                          <div className="pg-footnote" style={{ marginTop: 2 }}>
                            {u.clientDetails.map((cd) => `${cd.client} (${CLIENT_SOURCE_LABELS[cd.source] || cd.source})`).join(", ")}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {editingId === u.id ? (
                          <>
                            <button className="pg-btn" type="button" disabled={savingEdit || !editClickupValid} onClick={() => saveEdit(u.id)}>{savingEdit ? "Saving…" : "Save"}</button>
                            <button className="pg-btn pg-btn--ghost" type="button" disabled={savingEdit} onClick={() => setEditingId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            {/* Self role-editing is blocked server-side too, but hiding it here
                                avoids sending an admin down a dead-end edit flow for their own row. */}
                            {!isSelf && (
                              <button className="pg-btn pg-btn--ghost" type="button" disabled={busy} onClick={() => startEdit(u)}>Edit</button>
                            )}
                            {!isSelf && (
                              <button
                                className="pg-btn pg-btn--ghost"
                                type="button"
                                disabled={busy}
                                onClick={() => handleDelete(u.id)}
                                aria-label={`Remove ${u.email}`}
                                title="Remove user"
                              >
                                {deletingId === u.id ? <Loader2 size={13} style={{ animation: "pg-spin 1s linear infinite" }} /> : <Trash2 size={13} />}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {editingId === u.id && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 4 }}>
                        <label className="pg-field" htmlFor={editRoleId}>
                          <span className="pg-field__label">Role</span>
                          <select id={editRoleId} className="pg-input" value={editDraft.role} onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value }))}>
                            {ROLES.filter((r) => r !== "super_admin" || ownRole === "super_admin").map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </label>
                        <ClickupNameField
                          id={editClickupId}
                          listId={`${editClickupId}-list`}
                          value={editDraft.clickupUserName}
                          onChange={(v) => setEditDraft((d) => ({ ...d, clickupUserName: v }))}
                          clickupNames={clickupNames}
                          required={CLICKUP_REQUIRED_ROLES.has(editDraft.role)}
                        />
                        {CLIENT_SCOPED_ROLES.has(editDraft.role) && (
                          <ClientCheckboxList
                            label="Also grant these clients manually"
                            options={allClients}
                            selected={editDraft.clients}
                            onToggle={(c) => setEditDraft((d) => ({ ...d, clients: toggleClient(d.clients, c) }))}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
