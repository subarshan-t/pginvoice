# Graph Report - pginvoice  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 180 nodes · 300 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `61826754`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- App.jsx
- CapacityDashboard.jsx
- PerformanceScorecard.jsx
- TimesheetSummary.jsx
- package.json
- dependencies
- index.ts
- Shell.jsx
- idbGet
- ErrorBoundary
- ErrorBoundary
- ErrorBoundary

## God Nodes (most connected - your core abstractions)
1. `CapacityDashboardInner()` - 18 edges
2. `PGReconciliation()` - 16 edges
3. `PerformanceInner()` - 12 edges
4. `findMatch()` - 11 edges
5. `parseClickupCsv()` - 10 edges
6. `idbGet()` - 10 edges
7. `TimesheetInner()` - 9 edges
8. `isInternalFolder()` - 7 edges
9. `fmt()` - 6 edges
10. `loadKey()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `parseClickupCsv()` --calls--> `isInternalFolder()`  [EXTRACTED]
  src/App.jsx → src/nameMatch.js
- `PGReconciliation()` --calls--> `idbGet()`  [EXTRACTED]
  src/App.jsx → src/idbStore.js
- `PGReconciliation()` --calls--> `idbSet()`  [EXTRACTED]
  src/App.jsx → src/idbStore.js
- `PGReconciliation()` --calls--> `findMatch()`  [EXTRACTED]
  src/App.jsx → src/nameMatch.js
- `CapacityDashboardInner()` --calls--> `idbGet()`  [EXTRACTED]
  src/CapacityDashboard.jsx → src/idbStore.js

## Import Cycles
- None detected.

## Communities (13 total, 3 thin omitted)

### Community 0 - "App.jsx"
Cohesion: 0.10
Nodes (32): buildPrintHtml(), classifyClient(), ClientCard(), dateKeyStr(), esc(), findHeader(), fmt(), formatTaskUsers() (+24 more)

### Community 1 - "CapacityDashboard.jsx"
Cohesion: 0.10
Nodes (22): CapacityDashboardInner(), demandFor(), demandForGroup(), exportXlsx(), submitAllocation(), trailingAverage(), FIXED_BASES, holidaysInMonthGrouped() (+14 more)

### Community 2 - "PerformanceScorecard.jsx"
Cohesion: 0.14
Nodes (16): findMatch(), INTERNAL_KEYWORDS, isInternalFolder(), normalizeName(), tokens(), tokenSim(), fmt0(), fmt1() (+8 more)

### Community 3 - "TimesheetSummary.jsx"
Cohesion: 0.20
Nodes (15): loadKey(), LETTERHEAD_FOOTER_B64, buildTimesheetPrintHtml(), computeWeeks(), dateLabel(), daysInMonthOf(), esc(), fmt2() (+7 more)

### Community 4 - "package.json"
Cohesion: 0.12
Nodes (15): devDependencies, playwright, vite, @vitejs/plugin-react, name, private, scripts, build (+7 more)

### Community 5 - "dependencies"
Cohesion: 0.15
Nodes (13): lucide-react, dependencies, lucide-react, papaparse, react, react-dom, @supabase/supabase-js, xlsx (+5 more)

### Community 6 - "index.ts"
Cohesion: 0.18
Nodes (5): clickupFetch(), fetchAllTeamMemberIds(), INTERNAL_KEYWORDS, MONTHS_BACK, resolveTeamId()

### Community 7 - "Shell.jsx"
Cohesion: 0.33
Nodes (5): CapacityDashboard(), PerformanceScorecard(), MODULES, Shell(), TimesheetSummary()

### Community 8 - "idbGet"
Cohesion: 0.53
Nodes (5): idbDel(), idbGet(), idbSet(), openDB(), PG_DATA_EVENT

## Knowledge Gaps
- **33 isolated node(s):** `MONTH_INDEX`, `MONTH_NAMES`, `PRINT`, `SKIP_FOLDERS`, `TYPE_LABELS` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CapacityDashboardInner()` connect `CapacityDashboard.jsx` to `idbGet`, `PerformanceScorecard.jsx`, `TimesheetSummary.jsx`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `findMatch()` connect `PerformanceScorecard.jsx` to `App.jsx`, `CapacityDashboard.jsx`, `TimesheetSummary.jsx`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `idbGet()` connect `idbGet` to `App.jsx`, `CapacityDashboard.jsx`, `PerformanceScorecard.jsx`, `TimesheetSummary.jsx`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **What connects `MONTH_INDEX`, `MONTH_NAMES`, `PRINT` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09716599190283401 - nodes in this community are weakly interconnected._
- **Should `CapacityDashboard.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09788359788359788 - nodes in this community are weakly interconnected._
- **Should `PerformanceScorecard.jsx` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._