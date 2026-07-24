import React, { useState, useEffect } from "react";
import { FileText, BarChart3, TrendingUp, CalendarDays, Clock, Users, Sun, Moon, LogOut } from "lucide-react";
import PGReconciliation from "./App.jsx";
import CapacityDashboard from "./CapacityDashboard.jsx";
import PerformanceScorecard from "./PerformanceScorecard.jsx";
import TimesheetSummary from "./TimesheetSummary.jsx";
import ClientAccruals from "./ClientAccruals.jsx";
import Clients from "./Clients.jsx";

const MODULES = [
  { key: "invoicing", label: "Client Invoicing", icon: FileText },
  { key: "capacity", label: "Capacity planning", icon: BarChart3 },
  { key: "performance", label: "Performance", icon: TrendingUp },
  { key: "timesheet", label: "Timesheet summary", icon: CalendarDays },
  { key: "accruals", label: "Client Accruals", icon: Clock },
  { key: "clients", label: "Clients", icon: Users },
];

const THEME_KEY = "pg-theme";
const AUTH_KEY = "pg-auth";
// Front-door deterrent only, not real security: a hardcoded check in shipped
// client JS is visible to anyone who opens dev tools or views the bundle.
// Fine for keeping casual visitors out of an internal tool; not a substitute
// for real auth if this ever needs to resist a determined bypass attempt.
const VALID_USERNAME = "Kelly";
const VALID_PASSWORD = "Kelly";

function LoginGate({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      try { window.sessionStorage.setItem(AUTH_KEY, "1"); } catch (e) {}
      setError("");
      onSuccess();
    } else {
      setError("Incorrect username or password.");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-base)" }}>
      <form onSubmit={submit} className="pg-cap-card" style={{ width: 320, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 4 }}>
          <img src="/assets/giraffe-mark.png" alt="" style={{ width: 22, height: 22 }} />
          <span className="pg-eyebrow">Purple Giraffe</span>
        </div>
        <label className="pg-field">
          <span className="pg-field__label">Username</span>
          <input className="pg-input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="pg-field">
          <span className="pg-field__label">Password</span>
          <input className="pg-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="pg-footnote" style={{ color: "var(--status-over)" }}>{error}</p>}
        <button className="pg-btn" type="submit" style={{ justifyContent: "center" }}>Sign in</button>
      </form>
    </div>
  );
}

export default function Shell() {
  const [authed, setAuthed] = useState(() => {
    try { return window.sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  });
  const [active, setActive] = useState("invoicing");
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; }
  });

  // Applied on <html> (not just the shell) so the whole document — including anything
  // rendered outside .pg-shell, like a future modal or the browser's own UI chrome via
  // color-scheme — picks up the theme, not just the app content.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }, [theme]);

  if (!authed) return <LoginGate onSuccess={() => setAuthed(true)} />;

  const logOut = () => {
    try { window.sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
    setAuthed(false);
  };

  return (
    <div className="pg-shell">
      <aside className="pg-sidebar">
        <div className="pg-sidebar__brand">
          <img src="/assets/giraffe-mark.png" alt="" />
          <span>Purple Giraffe</span>
        </div>
        <nav className="pg-sidebar__nav">
          {MODULES.map((m) => (
            <button
              key={m.key}
              className={"pg-sidebar__link" + (active === m.key ? " pg-sidebar__link--active" : "")}
              onClick={() => setActive(m.key)}
            >
              <m.icon size={16} />
              {m.label}
            </button>
          ))}
        </nav>
        <button
          className="pg-sidebar__link pg-sidebar__theme-toggle"
          style={{ marginTop: "auto" }}
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label="Toggle dark / light mode"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button
          className="pg-sidebar__link"
          onClick={logOut}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>
      <main className="pg-shell__main">
        {/* All three modules stay mounted at once — switching tabs used to unmount
            the inactive one and wipe its in-memory state (an uploaded CSV, filters,
            etc). Hiding with CSS instead of conditional rendering keeps that state
            alive across tab switches. */}
        <div style={{ display: active === "invoicing" ? "block" : "none" }}><PGReconciliation /></div>
        <div style={{ display: active === "capacity" ? "block" : "none" }}><CapacityDashboard /></div>
        <div style={{ display: active === "performance" ? "block" : "none" }}><PerformanceScorecard /></div>
        <div style={{ display: active === "timesheet" ? "block" : "none" }}><TimesheetSummary /></div>
        <div style={{ display: active === "accruals" ? "block" : "none" }}><ClientAccruals /></div>
        <div style={{ display: active === "clients" ? "block" : "none" }}><Clients /></div>
      </main>
    </div>
  );
}
