import React, { useState } from "react";
import { FileText, BarChart3, TrendingUp } from "lucide-react";
import PGReconciliation from "./App.jsx";
import CapacityDashboard from "./CapacityDashboard.jsx";

const MODULES = [
  { key: "invoicing", label: "Client Invoicing", icon: FileText },
  { key: "capacity", label: "Capacity planning", icon: BarChart3 },
  { key: "performance", label: "Performance", icon: TrendingUp },
];

function ComingSoon({ label }) {
  return (
    <div className="pg-container">
      <div className="pg-app-header">
        <div>
          <span className="pg-eyebrow">Purple Giraffe · Internal</span>
          <h1 className="pg-app-header__title">{label}.</h1>
          <p className="pg-app-header__sub">Not built yet — this is a placeholder for the module.</p>
        </div>
      </div>
      <div className="pg-empty" style={{ marginTop: 24 }}>Coming soon.</div>
    </div>
  );
}

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
        {active === "invoicing" && <PGReconciliation />}
        {active === "capacity" && <CapacityDashboard />}
        {active === "performance" && <ComingSoon label="Performance" />}
      </main>
    </div>
  );
}
