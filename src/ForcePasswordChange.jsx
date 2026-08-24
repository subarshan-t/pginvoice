import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { clearMustChangePassword } from "./usersSync.js";

// Shown instead of the app when profile.mustChangePassword is true — every
// user created via Users.jsx starts with an admin-typed temp password (it
// passed through the browser once already at creation time), so this forces
// a real password of their own choosing before they get in.
export default function ForcePasswordChange({ userId, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setSubmitting(true);
    setError("");
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      await clearMustChangePassword(userId);
      onDone();
    } catch (e) {
      setError(e.message || String(e));
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-base)", padding: 16 }}>
      <form onSubmit={submit} className="pg-cap-card" style={{ width: 340, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Set your password</h2>
          <p className="pg-footnote">You're signing in with a temporary password — choose one only you know before continuing.</p>
        </div>
        <label className="pg-field">
          <span className="pg-field__label">New password</span>
          <input className="pg-input" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="pg-field">
          <span className="pg-field__label">Confirm password</span>
          <input className="pg-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="pg-footnote" role="alert" style={{ color: "var(--status-over)" }}>{error}</p>}
        <button className="pg-btn" type="submit" disabled={submitting} style={{ justifyContent: "center" }}>{submitting ? "Saving…" : "Save & continue"}</button>
      </form>
    </div>
  );
}
