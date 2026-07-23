import React, { useState, useEffect } from "react";
import { FileText, BarChart3, TrendingUp, Sun, Moon } from "lucide-react";
import PGReconciliation from "./App.jsx";
import CapacityDashboard from "./CapacityDashboard.jsx";
import PerformanceScorecard from "./PerformanceScorecard.jsx";

const MODULES = [
  { key: "invoicing", label: "Client Invoicing", icon: FileText },
  { key: "capacity", label: "Capacity planning", icon: BarChart3 },
  { key: "performance", label: "Performance", icon: TrendingUp },
];

const THEME_KEY = "pg-theme";

export default function Shell() {
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
      </aside>
      <main className="pg-shell__main">
        {/* All three modules stay mounted at once — switching tabs used to unmount
            the inactive one and wipe its in-memory state (an uploaded CSV, filters,
            etc). Hiding with CSS instead of conditional rendering keeps that state
            alive across tab switches. */}
        <div style={{ display: active === "invoicing" ? "block" : "none" }}><PGReconciliation /></div>
        <div style={{ display: active === "capacity" ? "block" : "none" }}><CapacityDashboard /></div>
        <div style={{ display: active === "performance" ? "block" : "none" }}><PerformanceScorecard /></div>
      </main>
    </div>
  );
}
