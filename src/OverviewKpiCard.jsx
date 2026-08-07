import React from "react";

// One headline number plus a secondary stat — the "count AND %" / "avg AND
// spread" pattern the Overview page's KPI grid uses throughout. Numeric
// values render in the app's mono stat convention (see app.css's
// .pg-stat__value), just wrapped in the Overview module's own glass card
// treatment (.ov-card, overview.css) rather than the plain .pg-kpi-card used
// elsewhere.
export function OverviewKpiCard({ primary, primaryLabel, secondary, secondaryLabel, tone, style, index }) {
  return (
    <div className="ov-card ov-kpi" style={{ ...style, ["--i"]: index ?? 0 }}>
      <div className="ov-kpi__label">{primaryLabel}</div>
      <div className="pg-stat__value ov-kpi__primary" style={tone ? { color: tone } : undefined}>{primary}</div>
      {(secondary !== undefined && secondary !== null) && (
        <div className="ov-kpi__secondary">
          <span className="ov-kpi__secondary-value">{secondary}</span>
          {secondaryLabel && <span className="ov-kpi__secondary-label">{secondaryLabel}</span>}
        </div>
      )}
    </div>
  );
}
