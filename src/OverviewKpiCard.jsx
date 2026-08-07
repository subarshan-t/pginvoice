import React from "react";
import { Sparkline } from "./Sparkline.jsx";

// One headline number plus a secondary stat — the "count AND %" / "avg AND
// spread" pattern the Overview page's KPI grid uses throughout. Numeric
// values render in the app's mono stat convention (see app.css's
// .pg-stat__value), wrapped in the Overview module's own card treatment
// (.ov-card, overview.css). An optional trailing sparkline (a short recent
// history, e.g. the 6-month trend already computed for the trend chart) sits
// beside the secondary stat when the caller has one to show.
export function OverviewKpiCard({ primary, primaryLabel, secondary, secondaryLabel, tone, sparkline, sparklineColor, style, index }) {
  return (
    <div className="ov-card ov-kpi" style={{ ...style, ["--i"]: index ?? 0 }}>
      <div className="ov-kpi__label">{primaryLabel}</div>
      <div className="ov-kpi__row">
        <div className="pg-stat__value ov-kpi__primary" style={tone ? { color: tone } : undefined}>{primary}</div>
        {sparkline && sparkline.length >= 2 && (
          <div className="ov-kpi__sparkline"><Sparkline points={sparkline} color={sparklineColor || tone || "var(--accent)"} /></div>
        )}
      </div>
      {(secondary !== undefined && secondary !== null) && (
        <div className="ov-kpi__secondary">
          <span className="ov-kpi__secondary-value">{secondary}</span>
          {secondaryLabel && <span className="ov-kpi__secondary-label">{secondaryLabel}</span>}
        </div>
      )}
    </div>
  );
}
