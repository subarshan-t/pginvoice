// Purple Giraffe — ClickUp -> Supabase sync
//
// Pulls time-tracking entries straight from the ClickUp API (instead of a
// manually-exported CSV) and upserts them into public.pginvoice_clickup_entries,
// in the same shape the frontend already expects from a CSV upload (folder,
// task, minutes, billable, user, isInternal, monthKey/monthLabel, dateKey) so
// no downstream module needs to know the data didn't come from a file.
//
// Processes exactly ONE calendar month per invocation (fetch -> transform ->
// upsert -> stale-row cleanup). Earlier versions tried to do many months in a
// single invocation — even after batching per month within the loop, the
// cumulative CPU time across all months in one request still blew the Edge
// Function's compute budget (WORKER_RESOURCE_LIMIT), since ~2,500 entries per
// month is already ~3.5s of real work on its own.
//
// Invoked on a schedule via pg_cron every 20 minutes (see cron.job) with an
// empty body, which defaults to monthOffset 0 (the current month) — that's
// the only month whose entries realistically change day-to-day. To backfill
// older months, invoke manually with a JSON body like {"monthOffset": 1} for
// last month, {"monthOffset": 2} for the month before, etc.
//
// CLICKUP_API_TOKEN must be set as an Edge Function secret (Project Settings
// -> Edge Functions -> Secrets); it is never sent to the client.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const TIMEZONE = "Australia/Adelaide"; // matches the CSV export's "Start Text" localisation

// Same rule the frontend's nameMatch.js uses — kept in sync manually since this
// runs in a separate Deno runtime and can't share an import with the Vite app.
const INTERNAL_KEYWORDS = ["purple giraffe", "onboarding", "induction", "offboarding", "handover", "wip"];
function isInternalFolder(folder: string): boolean {
  const f = (folder || "").toLowerCase();
  if (!f) return false;
  return INTERNAL_KEYWORDS.some((k) => f.includes(k));
}

// Built once and reused — constructing an Intl.DateTimeFormat per call was
// expensive enough, multiplied across thousands of entries, to eat into the
// Edge Function's CPU-time budget.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
function localDateParts(epochMs: number) {
  const parts = DATE_FMT.formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}
function monthKeyOf(year: number, month: number) { return `${year}-${String(month).padStart(2, "0")}`; }
function monthLabelOf(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function clickupFetch(path: string, token: string) {
  const res = await fetch(`${CLICKUP_BASE}${path}`, { headers: { Authorization: token } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ClickUp API ${res.status} on ${path}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function fetchAllTeamMemberIds(token: string, teamId: string): Promise<string[]> {
  const data = await clickupFetch(`/team`, token);
  const team = (data.teams || []).find((t: any) => String(t.id) === String(teamId)) || data.teams?.[0];
  if (!team) throw new Error("No ClickUp team/workspace found for this token.");
  return (team.members || []).map((m: any) => String(m.user?.id)).filter(Boolean);
}

async function resolveTeamId(token: string, explicitTeamId: string | undefined) {
  if (explicitTeamId) return explicitTeamId;
  const data = await clickupFetch(`/team`, token);
  const team = data.teams?.[0];
  if (!team) throw new Error("No ClickUp team/workspace found for this token.");
  return String(team.id);
}

// Folder name resolution is the one field we couldn't verify live against a
// real workspace while building this (this session's ClickUp connector points
// at an unrelated test workspace) — check the several plausible shapes
// `include_location_names=true` might use, and fall back rather than crash.
// If real folder names come through wrong on the first live sync, check
// `raw_sample` in this function's response / the edge function logs and
// adjust the field path here.
function resolveFolderName(entry: any): string {
  return (
    entry.task_location?.folder_name ??
    entry.task?.folder?.name ??
    entry.folder?.name ??
    "(No folder)"
  );
}
function resolveTaskName(entry: any): string {
  return entry.task?.name || "Untitled";
}
function resolveUserName(entry: any): string {
  return entry.user?.username || entry.user?.email || "";
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const token = Deno.env.get("CLICKUP_API_TOKEN");
  if (!token) {
    await supabase.from("pginvoice_sync_meta").update({
      last_synced_at: new Date().toISOString(), last_sync_status: "error",
      last_sync_message: "CLICKUP_API_TOKEN secret is not set.",
    }).eq("id", 1);
    return new Response(JSON.stringify({ ok: false, error: "CLICKUP_API_TOKEN secret is not set." }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let monthOffset = 0;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.monthOffset === "number" && Number.isFinite(body.monthOffset) && body.monthOffset >= 0) {
      monthOffset = Math.floor(body.monthOffset);
    }
  } catch (_) { /* malformed/absent body -> default to current month */ }

  try {
    const explicitTeamId = Deno.env.get("CLICKUP_TEAM_ID") || undefined;
    const teamId = await resolveTeamId(token, explicitTeamId);
    const memberIds = await fetchAllTeamMemberIds(token, teamId);
    const assignee = memberIds.join(",");

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset + 1, 1));

    const qs = new URLSearchParams({
      start_date: String(start.getTime()),
      end_date: String(end.getTime()),
      include_task_tags: "false",
      include_location_names: "true",
      assignee,
    });
    const data = await clickupFetch(`/team/${teamId}/time_entries?${qs.toString()}`, token);
    const entries = data.data || [];
    const rawSample = entries[0] ?? null;

    const monthRows: any[] = [];
    for (const entry of entries) {
      const minutes = Number(entry.duration || 0) / 60000;
      if (!minutes) continue;
      const folder = resolveFolderName(entry);
      const startMs = Number(entry.start || 0);
      const { year, month, day } = localDateParts(startMs);
      monthRows.push({
        entry_id: String(entry.id),
        folder,
        task: resolveTaskName(entry),
        minutes,
        billable: !!entry.billable,
        has_billable_col: true,
        user_name: resolveUserName(entry),
        is_internal: isInternalFolder(folder),
        month_key: monthKeyOf(year, month),
        month_label: monthLabelOf(year, month),
        date_key: `${monthKeyOf(year, month)}-${String(day).padStart(2, "0")}`,
        entry_start: new Date(startMs).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (monthRows.length) {
      const { error: upsertError } = await supabase
        .from("pginvoice_clickup_entries")
        .upsert(monthRows, { onConflict: "entry_id" });
      if (upsertError) throw upsertError;
    }

    // Stale-row cleanup, scoped to just this month so neither the id list nor
    // the delete query ever has to cover more than one month's data at a time.
    const { data: existing, error: existingError } = await supabase
      .from("pginvoice_clickup_entries")
      .select("entry_id")
      .gte("entry_start", start.toISOString())
      .lt("entry_start", end.toISOString());
    if (existingError) throw existingError;
    const fetchedIds = new Set(monthRows.map((r) => r.entry_id));
    const staleIds = (existing || []).map((r) => r.entry_id).filter((id) => !fetchedIds.has(id));
    if (staleIds.length) {
      const { error: deleteError } = await supabase.from("pginvoice_clickup_entries").delete().in("entry_id", staleIds);
      if (deleteError) throw deleteError;
    }

    const monthLabel = start.toISOString().slice(0, 7);
    await supabase.from("pginvoice_sync_meta").update({
      last_synced_at: new Date().toISOString(), last_sync_status: "ok",
      last_sync_message: `Synced ${monthRows.length} entries for ${monthLabel} (monthOffset=${monthOffset}).`,
      rows_synced: monthRows.length,
    }).eq("id", 1);

    return new Response(JSON.stringify({ ok: true, rows_synced: monthRows.length, team_id: teamId, month: monthLabel, raw_sample: rawSample }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("pginvoice_sync_meta").update({
      last_synced_at: new Date().toISOString(), last_sync_status: "error", last_sync_message: message,
    }).eq("id", 1);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
