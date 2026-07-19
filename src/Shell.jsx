import React, { useState } from "react";
import { FileText, BarChart3, TrendingUp } from "lucide-react";
import PGReconciliation from "./App.jsx";
import CapacityDashboard from "./CapacityDashboard.jsx";
import PerformanceScorecard from "./PerformanceScorecard.jsx";

const MODULES = [
  { key: "invoicing", label: "Client Invoicing", icon: FileText },
  { key: "capacity", label: "Capacity planning", icon: BarChart3 },
  { key: "performance", label: "Performance", icon: TrendingUp },
];

export default function Shell() {
  const [active, setActive] = useState("invoicing");
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
