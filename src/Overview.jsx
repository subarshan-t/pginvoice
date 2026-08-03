import React from "react";
import { LayoutDashboard } from "lucide-react";

// Deliberately minimal for now — an honest "not built yet" landing page rather
// than fabricated KPI numbers. Each module already owns its own metrics; once
// there's a real cross-module rollup worth showing here, this is where it goes.
export default function Overview() {
  return (
    <div className="pg-app">
      <div className="pg-container">
        <div className="pg-app-header">
          <div>
            <span className="pg-eyebrow">Purple Giraffe · Internal</span>
            <h1 className="pg-app-header__title">Overview.</h1>
            <p className="pg-app-header__sub">
              A cross-module summary isn't built yet — pick a module from the sidebar in the meantime.
            </p>
          </div>
        </div>
        <div className="pg-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <LayoutDashboard size={20} style={{ color: "var(--fg-tertiary)" }} />
          Module overview coming soon.
        </div>
      </div>
    </div>
  );
}
