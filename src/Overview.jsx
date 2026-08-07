import React, { useState, useEffect, useMemo } from "react";
import { fetchClients, fetchClientEvents } from "./clientsSync.js";
import { fetchAccrualsFromSupabase } from "./accrualsSync.js";
import { fetchClickupFromSupabase } from "./clickupSync.js";
import { loadKey, SEED_PEOPLE, last6MonthKeys } from "./capacityData.js";
import { CAP_PEOPLE_KEY } from "./storageKeys.js";
import { CLIENT_TYPE_LABELS } from "./nameMatch.js";
import { LineChart } from "./LineChart.jsx";
import { OverviewKpiCard } from "./OverviewKpiCard.jsx";
import { OverviewList } from "./OverviewList.jsx";
import {
  activeClientStats, overServicedFromAccruals, accrualHealth, NEGATIVE_BALANCE_THRESHOLD_HRS,
  teamMonthlyTotals, teamUtilization, overUtilizedConsultants, OVER_UTILIZATION_PCT,
  sixMonthTrend, clientTypeMix,
} from "./overviewData.js";

function fmt0(n) { return (n === null || n === undefined || isNaN(n)) ? "—" : Math.round(n).toLocaleString(); }
function fmt1(n) { return (n === null || n === undefined || isNaN(n)) ? "—" : n.toFixed(1); }
function pct0(n) { return (n === null || n === undefined || isNaN(n)) ? "—" : `${Math.round(n)}%`; }

function monthLabelShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
}

function SkeletonGrid() {
  return (
    <>
      <div className="ov-kpi-grid">
        {[0, 1, 2, 3].map((i) => <div key={i} className="ov-card ov-kpi ov-skeleton" />)}
      </div>
      <div className="ov-row">
        <div className="ov-card ov-trend ov-skeleton" style={{ minHeight: 300 }} />
        <div className="ov-card ov-skeleton" style={{ minHeight: 300 }} />
      </div>
      <div className="ov-lists">
        <div className="ov-card ov-skeleton" style={{ minHeight: 180 }} />
        <div className="ov-card ov-skeleton" style={{ minHeight: 180 }} />
      </div>
    </>
  );
}

// Cross-module rollup landing page — loads live data from every module's own
// source of truth (Supabase tables + the shared roster) and computes every
// metric via overviewData.js's pure functions. Never fabricates a number when
// the underlying data is genuinely absent: a metric with no real input renders
// an explicit "no data yet" message instead of a 0 or NaN (see the original
// placeholder's own principle — an honest "not built yet" page rather than
// fabricated KPIs — carried forward here per-card even though the page itself
// is now built).
export default function Overview() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [clients, setClients] = useState([]);
  const [accrualClients, setAccrualClients] = useState(null); // null = no data on file at all
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [clickup, setClickup] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // allSettled, not all -- a single flaky source (e.g. the ClickUp sync having
      // a bad moment) must not wipe out clients/accruals/roster data that loaded
      // fine, which Promise.all's fail-fast behavior would otherwise do. Each card
      // below already renders its own honest "no data yet" state per source, so
      // showing what did load (with a banner naming what didn't) is strictly more
      // correct than blanking everything on one unrelated failure.
      const sources = [
        ["clients", fetchClients()],
        ["client events", fetchClientEvents()],
        ["accruals", fetchAccrualsFromSupabase()],
        ["team roster", loadKey(CAP_PEOPLE_KEY, SEED_PEOPLE)],
        ["ClickUp sync", fetchClickupFromSupabase()],
      ];
      const results = await Promise.allSettled(sources.map(([, p]) => p));
      if (cancelled) return;

      const [clRes, , accrualsRes, pplRes, cuRes] = results;
      if (clRes.status === "fulfilled") setClients(clRes.value || []);
      if (accrualsRes.status === "fulfilled") setAccrualClients(accrualsRes.value);
      if (pplRes.status === "fulfilled") setPeople(pplRes.value || SEED_PEOPLE);
      if (cuRes.status === "fulfilled") setClickup(cuRes.value || null);

      const failed = results
        .map((r, i) => (r.status === "rejected" ? sources[i][0] : null))
        .filter(Boolean);
      if (failed.length) setLoadError(failed.join(", "));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Six-month trailing window, newest last — the canonical "recent" window
  // every other module already uses (capacityData.js's last6MonthKeys).
  const monthKeys = useMemo(() => last6MonthKeys().slice().reverse(), []);
  const latestMonth = monthKeys[monthKeys.length - 1];

  const clientStats = useMemo(() => activeClientStats(clients), [clients]);
  const overServiced = useMemo(
    () => (accrualClients ? overServicedFromAccruals(accrualClients, latestMonth) : { overServiced: 0, withData: 0 }),
    [accrualClients, latestMonth]
  );
  const health = useMemo(() => accrualHealth(accrualClients), [accrualClients]);
  const teamMonthly = useMemo(() => teamMonthlyTotals(people, clickup, monthKeys), [people, clickup, monthKeys]);
  const utilization = useMemo(() => teamUtilization(people, teamMonthly, latestMonth), [people, teamMonthly, latestMonth]);
  const overUtilized = useMemo(() => overUtilizedConsultants(utilization.perConsultant), [utilization]);
  const trend = useMemo(() => sixMonthTrend(accrualClients, clickup?.rows, monthKeys), [accrualClients, clickup, monthKeys]);
  const typeMix = useMemo(() => clientTypeMix(clients), [clients]);

  const hasClients = clients.length > 0;
  const hasAccruals = !!accrualClients && accrualClients.length > 0;
  const hasTeamData = utilization.perConsultant.length > 0;
  const hasTrend = trend.months.length > 0;

  const typeMixEntries = useMemo(
    () => Object.entries(typeMix).sort((a, b) => b[1] - a[1]),
    [typeMix]
  );
  const topType = typeMixEntries[0];

  const trendSeries = useMemo(() => ([
    { label: "Over-serviced clients", color: "var(--status-over)", points: trend.overServicedCounts },
    { label: "Total accrued hours", color: "var(--accent)", points: trend.totalAccruedHours },
  ]), [trend]);

  const overUtilizedItems = useMemo(() => overUtilized.map((c) => ({
    key: c.name, name: c.name, badge: pct0(c.pct), tone: "var(--status-over)",
  })), [overUtilized]);

  const negativeBalanceItems = useMemo(() => health.negativeList.map((c) => ({
    key: c.client, name: c.client, badge: `${fmt1(c.balance)} h`, tone: "var(--status-warn)",
  })), [health.negativeList]);

  return (
    <div className="pg-app">
      <div className="pg-container">
        <div className="pg-app-header">
          <div>
            <span className="pg-eyebrow">Purple Giraffe · Internal</span>
            <h1 className="pg-app-header__title">Overview.</h1>
            <p className="pg-app-header__sub">
              A live cross-module snapshot of the whole business — clients, accruals, and team utilization, pulled straight from Client Invoicing, Client Accruals, and Capacity Planning's own data.
            </p>
          </div>
        </div>

        {loadError && (
          <div className="pg-banner-warn">Couldn't load some Overview data: {loadError}. Figures below may be incomplete.</div>
        )}

        {loading ? (
          <SkeletonGrid />
        ) : (
          <>
            <div className="ov-kpi-grid">
              <OverviewKpiCard
                index={0}
                primaryLabel="Active clients"
                primary={hasClients ? fmt0(clientStats.active) : "—"}
                secondary={hasAccruals ? (overServiced.withData > 0 ? `${fmt0(overServiced.overServiced)} over-serviced` : "—") : null}
                secondaryLabel={
                  hasAccruals
                    ? (overServiced.withData > 0 ? `of ${fmt0(overServiced.withData)} with data this month` : "no data for this month yet")
                    : (!hasClients ? "no client data yet" : undefined)
                }
              />
              <OverviewKpiCard
                index={1}
                primaryLabel="Accrual balance (net)"
                primary={hasAccruals ? `${fmt1(health.netHours)} h` : "—"}
                tone={hasAccruals && health.netHours < 0 ? "var(--status-warn)" : undefined}
                secondary={hasAccruals ? fmt0(health.negativeCount) : null}
                secondaryLabel={hasAccruals ? `client${health.negativeCount === 1 ? "" : "s"} below -${NEGATIVE_BALANCE_THRESHOLD_HRS}h` : "no accrual data yet"}
              />
              <OverviewKpiCard
                index={2}
                primaryLabel="Team utilization"
                primary={hasTeamData ? pct0(utilization.avgPct) : "—"}
                secondary={hasTeamData ? `${pct0(utilization.minPct)}–${pct0(utilization.maxPct)}` : null}
                secondaryLabel={hasTeamData ? "range across the team" : "no ClickUp data loaded yet"}
              />
              <OverviewKpiCard
                index={3}
                primaryLabel="Client type mix"
                primary={topType ? CLIENT_TYPE_LABELS[topType[0]] || topType[0] : "—"}
                secondary={topType ? `${fmt0(topType[1])} of ${fmt0(clients.length)}` : null}
                secondaryLabel={topType ? "clients on the most common type" : (!hasClients ? "no client data yet" : undefined)}
              />
            </div>

            <div className="ov-row">
              <div className="ov-card ov-trend" style={{ ["--i"]: 4 }}>
                <div className="ov-trend__title">6-month trend</div>
                {hasTrend ? (
                  <>
                    <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
                      {trendSeries.map((s) => (
                        <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-tertiary)" }}>
                          <i style={{ width: 14, height: 3, borderRadius: 2, display: "inline-block", background: s.color }} />{s.label}
                        </span>
                      ))}
                    </div>
                    <LineChart series={trendSeries} months={trend.months} />
                    <p className="pg-footnote" style={{ marginTop: 6 }}>
                      Months with no matching accrual data are omitted rather than shown as a fabricated zero — {trend.months.length} of the trailing {monthKeys.length} months have data.
                    </p>
                  </>
                ) : (
                  <div className="pg-empty">No accrual data yet to chart a trend — upload/sync Client Accruals to see this fill in.</div>
                )}
              </div>

              <div className="ov-card" style={{ padding: "20px 22px", ["--i"]: 5 }}>
                <div className="ov-trend__title">Client type mix</div>
                {hasClients ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                    {typeMixEntries.map(([type, count]) => (
                      <div key={type} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px dashed var(--border-soft)" }}>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--fg-secondary)" }}>{CLIENT_TYPE_LABELS[type] || type}</span>
                        <span className="pg-stat__value" style={{ fontSize: 16 }}>{fmt0(count)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pg-empty">No clients loaded yet.</div>
                )}
              </div>
            </div>

            <div className="ov-lists">
              <OverviewList
                index={6}
                title={`Over-utilized consultants (≥${OVER_UTILIZATION_PCT}%)`}
                items={overUtilizedItems}
                emptyMessage={hasTeamData ? "No consultants currently over-utilized." : "No ClickUp/roster data yet to compute utilization."}
              />
              <OverviewList
                index={7}
                title={`Clients below -${NEGATIVE_BALANCE_THRESHOLD_HRS}h balance`}
                items={negativeBalanceItems}
                emptyMessage={hasAccruals ? "No clients with a meaningful negative balance." : "No accrual data yet."}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
