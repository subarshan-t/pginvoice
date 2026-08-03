import React from "react";

// Shared "not built yet" page for nav items that exist in the approved design
// but don't have real functionality behind them yet (Settings, Integrations,
// Help). Honest empty state rather than fabricated content.
export default function PlaceholderPage({ title, subtitle, icon: Icon, empty }) {
  return (
    <div className="pg-app">
      <div className="pg-container">
        <div className="pg-app-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            {Icon && <div className="pg-app-header__icon"><Icon size={18} /></div>}
            <div>
              <span className="pg-eyebrow">Purple Giraffe · Internal</span>
              <h1 className="pg-app-header__title">{title}</h1>
              <p className="pg-app-header__sub">{subtitle}</p>
            </div>
          </div>
        </div>
        <div className="pg-empty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {Icon && <Icon size={20} style={{ color: "var(--fg-tertiary)" }} />}
          {empty}
        </div>
      </div>
    </div>
  );
}
