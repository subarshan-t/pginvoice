import React, { useEffect, useState } from "react";
import { Users as UsersIcon, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { fetchUsers, createUser, updateUserRoleAndClients, deleteUser, ROLES, ROLE_LABELS, CLIENT_SCOPED_ROLES } from "./usersSync.js";
import { fetchClients } from "./clientsSync.js";

const emptyDraft = { email: "", password: "", role: "consultant", clients: [] };

// Super Admin + Admin only (enforced both by Shell.jsx's nav gating and,
// for real, by the manage-users Edge Function checking the caller's role
// server-side before touching anything).
export default function Users({ ownRole }) {
  const [users, setUsers] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  async function load() {
    try {
      const [u, c] = await Promise.all([fetchUsers(), fetchClients()]);
      setUsers(u);
      setAllClients((c || []).map((row) => row.client).sort());
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!draft.email.trim() || draft.password.length < 8) return;
    setCreating(true);
    setError(null);
    try {
      await createUser({
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
        clients: CLIENT_SCOPED_ROLES.has(draft.role) ? draft.clients : [],
      });
      setDraft(emptyDraft);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditDraft({ role: u.role, clients: u.clients || [] });
  }

  async function saveEdit(userId) {
    setSavingEdit(true);
    setError(null);
    try {
      await updateUserRoleAndClients({
        userId,
        role: editDraft.role,
        clients: CLIENT_SCOPED_ROLES.has(editDraft.role) ? editDraft.clients : [],
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(userId) {
    if (!window.confirm("Remove this user's access? This cannot be undone.")) return;
    setDeletingId(userId);
    setError(null);
    try {
      await deleteUser(userId);
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

        {error && <p className="pg-footnote" style={{ color: "var(--status-over)" }}>{error}</p>}

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
            <label className="pg-field">
              <span className="pg-field__label">Role</span>
              <select className="pg-input" value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value, clients: [] }))}>
                {ROLES.filter((r) => r !== "super_admin" || ownRole === "super_admin").map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            {CLIENT_SCOPED_ROLES.has(draft.role) && (
              <div className="pg-field">
                <span className="pg-field__label">Assigned clients</span>
                <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border-default)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {allClients.map((c) => (
                    <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={draft.clients.includes(c)} onChange={() => setDraft((d) => ({ ...d, clients: toggleClient(d.clients, c) }))} />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button className="pg-btn" type="submit" disabled={creating || !draft.email.trim() || draft.password.length < 8} style={{ justifyContent: "center", gap: 6 }}>
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
              {users.map((u) => (
                <div key={u.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{u.email}</div>
                      <div className="pg-footnote">
                        {editingId === u.id ? "Editing…" : `${ROLE_LABELS[u.role] || u.role}${u.clients?.length ? ` · ${u.clients.length} client(s)` : ""}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {editingId === u.id ? (
                        <>
                          <button className="pg-btn" type="button" disabled={savingEdit} onClick={() => saveEdit(u.id)}>{savingEdit ? "Saving…" : "Save"}</button>
                          <button className="pg-btn pg-btn--ghost" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="pg-btn pg-btn--ghost" type="button" onClick={() => startEdit(u)}>Edit</button>
                          <button
                            className="pg-btn pg-btn--ghost"
                            type="button"
                            disabled={deletingId === u.id}
                            onClick={() => handleDelete(u.id)}
                            aria-label={`Remove ${u.email}`}
                            title="Remove user"
                          >
                            {deletingId === u.id ? <Loader2 size={13} style={{ animation: "pg-spin 1s linear infinite" }} /> : <Trash2 size={13} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingId === u.id && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 4 }}>
                      <select className="pg-input" value={editDraft.role} onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value }))}>
                        {ROLES.filter((r) => r !== "super_admin" || ownRole === "super_admin").map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                      {CLIENT_SCOPED_ROLES.has(editDraft.role) && (
                        <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border-default)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {allClients.map((c) => (
                            <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                              <input type="checkbox" checked={editDraft.clients.includes(c)} onChange={() => setEditDraft((d) => ({ ...d, clients: toggleClient(d.clients, c) }))} />
                              {c}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
