import React, { useState, useEffect } from "react";
import { LayoutDashboard, FileText, BarChart3, TrendingUp, CalendarDays, Clock, Users, Building2, Sun, Moon, LogOut, ChevronLeft, ChevronRight, Settings, Plug, HelpCircle, Menu, X } from "lucide-react";
import Overview from "./Overview.jsx";
import PlaceholderPage from "./PlaceholderPage.jsx";
import PGReconciliation from "./App.jsx";
import CapacityDashboard from "./CapacityDashboard.jsx";
import PerformanceScorecard from "./PerformanceScorecard.jsx";
import TimesheetSummary from "./TimesheetSummary.jsx";
import ClientAccruals from "./ClientAccruals.jsx";
import Clients from "./Clients.jsx";
import TeamDashboard from "./TeamDashboard.jsx";

// Nav order/labels follow the approved Purple Giraffe Design OS mockup.
const MODULES = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "invoicing", label: "Client Invoicing", icon: FileText },
  { key: "capacity", label: "Capacity Planning", icon: BarChart3 },
  { key: "team", label: "Consultants", icon: Users },
  { key: "clients", label: "Clients", icon: Building2 },
  { key: "timesheet", label: "Timesheets", icon: CalendarDays },
  { key: "accruals", label: "Client Accruals", icon: Clock },
  { key: "performance", label: "Reporting", icon: TrendingUp },
];
// Present in the approved nav, but no real functionality behind them yet —
// each renders an honest "not built" placeholder rather than fake content.
const SECONDARY_MODULES = [
  { key: "settings", label: "Settings", icon: Settings },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "help", label: "Help", icon: HelpCircle },
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
      onSuccess(username);
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

const COLLAPSE_KEY = "pg-sidebar-collapsed";

export default function Shell() {
  const [authed, setAuthed] = useState(() => {
    try { return window.sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  });
  const [username, setUsername] = useState(VALID_USERNAME);
  const [active, setActive] = useState("overview");
  const [theme, setTheme] = useState(() => {
    try { return window.localStorage.getItem(THEME_KEY) || "light"; } catch (e) { return "light"; }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch (e) { return false; }
  });
  // Mobile only — the sidebar becomes a compact top bar (brand + hamburger) below
  // 760px, and this opens it as a full-screen sheet instead of the desktop
  // collapse-to-icons behavior, per §15 "navigation becomes a sheet" on mobile.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const goTo = (key) => { setActive(key); setMobileNavOpen(false); };

  // Applied on <html> (not just the shell) so the whole document — including anything
  // rendered outside .pg-shell, like a future modal or the browser's own UI chrome via
  // color-scheme — picks up the theme, not just the app content.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }, [theme]);

  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (e) {}
  }, [collapsed]);

  if (!authed) return <LoginGate onSuccess={(u) => { setUsername(u); setAuthed(true); }} />;

  const logOut = () => {
    try { window.sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
    setAuthed(false);
  };

  return (
    <div className="pg-shell">
      {mobileNavOpen && <div className="pg-sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside className={"pg-sidebar" + (collapsed ? " pg-sidebar--collapsed" : "") + (mobileNavOpen ? " pg-sidebar--mobile-open" : "")}>
        <div className="pg-sidebar__brand">
          <img src="/assets/giraffe-mark.png" alt="" />
          {!collapsed && <span>Purple Giraffe</span>}
          <button
            className="pg-sidebar__icon-btn pg-sidebar__desktop-only"
            style={{ marginLeft: "auto" }}
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
          <button
            className="pg-sidebar__mobile-toggle"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
        <div className="pg-sidebar__scroll">
          <nav className="pg-sidebar__nav">
            {MODULES.map((m) => (
              <button
                key={m.key}
                className={"pg-sidebar__link" + (active === m.key ? " pg-sidebar__link--active" : "")}
                onClick={() => goTo(m.key)}
                title={collapsed ? m.label : undefined}
              >
                <m.icon size={16} />
                {!collapsed && m.label}
              </button>
            ))}
          </nav>

          <nav className="pg-sidebar__nav" style={{ marginTop: "auto" }}>
            {SECONDARY_MODULES.map((m) => (
              <button
                key={m.key}
                className={"pg-sidebar__link" + (active === m.key ? " pg-sidebar__link--active" : "")}
                onClick={() => goTo(m.key)}
                title={collapsed ? m.label : undefined}
              >
                <m.icon size={16} />
                {!collapsed && m.label}
              </button>
            ))}
          </nav>

          <div className="pg-sidebar__profile" title={collapsed ? username : undefined}>
            <div className="pg-sidebar__avatar">{username.slice(0, 1).toUpperCase()}</div>
            {!collapsed && (
              <div className="pg-sidebar__profile-text">
                <div className="pg-sidebar__profile-name">{username}</div>
                <div className="pg-sidebar__profile-role">Admin</div>
              </div>
            )}
          </div>

          <div className="pg-sidebar__footer-row">
            <button
              className="pg-sidebar__icon-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle dark / light mode"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              className="pg-sidebar__icon-btn"
              onClick={logOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className="pg-shell__main">
        {/* All modules stay mounted at once — switching tabs used to unmount the
            inactive one and wipe its in-memory state (an uploaded CSV, filters,
            etc). Hiding with CSS instead of conditional rendering keeps that
            state alive across tab switches. */}
        <div style={{ display: active === "overview" ? "block" : "none" }}><Overview /></div>
        <div style={{ display: active === "invoicing" ? "block" : "none" }}><PGReconciliation onNavigateClients={() => setActive("clients")} /></div>
        <div style={{ display: active === "capacity" ? "block" : "none" }}><CapacityDashboard onNavigateTeam={() => setActive("team")} /></div>
        <div style={{ display: active === "team" ? "block" : "none" }}><TeamDashboard /></div>
        <div style={{ display: active === "performance" ? "block" : "none" }}><PerformanceScorecard /></div>
        <div style={{ display: active === "timesheet" ? "block" : "none" }}><TimesheetSummary /></div>
        <div style={{ display: active === "accruals" ? "block" : "none" }}><ClientAccruals /></div>
        <div style={{ display: active === "clients" ? "block" : "none" }}><Clients /></div>
        <div style={{ display: active === "settings" ? "block" : "none" }}>
          <PlaceholderPage title="Settings." subtitle="Account, workspace and preference settings aren't built yet." icon={Settings} empty="Settings module coming soon." />
        </div>
        <div style={{ display: active === "integrations" ? "block" : "none" }}>
          <PlaceholderPage title="Integrations." subtitle="Connected apps and sync configuration aren't built yet." icon={Plug} empty="Integrations module coming soon." />
        </div>
        <div style={{ display: active === "help" ? "block" : "none" }}>
          <PlaceholderPage title="Help." subtitle="Documentation and support aren't built yet." icon={HelpCircle} empty="Help module coming soon." />
        </div>
      </main>
    </div>
  );
}
