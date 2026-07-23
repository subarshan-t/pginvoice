// Purple Giraffe — ClickUp -> Supabase sync
//
// Pulls time-tracking entries straight from the ClickUp API (instead of a
// manually-exported CSV) and upserts them into public.pginvoice_clickup_entries,
// in the same shape the frontend already expects from a CSV upload (folder,
// task, minutes, billable, user, isInternal, monthKey/monthLabel, dateKey) so
// no downstream module needs to know the data didn't come from a file.
//
// Invoked on a schedule via pg_cron (see the migration SQL) — not by the
// browser directly. CLICKUP_API_TOKEN must be set as an Edge Function secret
// (Project Settings -> Edge Functions -> Secrets); it is never sent to the
// client.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";
const TIMEZONE = "Australia/Adelaide"; // matches the CSV export's "Start Text" localisation
const MONTHS_BACK = Number(Deno.env.get("CLICKUP_SYNC_MONTHS_BACK") ?? "13");

// Same rule the frontend's nameMatch.js uses — kept in sync manually since this
// runs in a separate Deno runtime and can't share an import with the Vite app.
const INTERNAL_KEYWORDS = ["purple giraffe", "onboarding", "induction", "offboarding", "handover", "wip"];
function isInternalFolder(folder: string): boolean {
  const f = (folder || "").toLowerCase();
  if (!f) return false;
  return INTERNAL_KEYWORDS.some((k) => f.includes(k));
}

function localDateParts(epochMs: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date(epochMs));
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

  try {
    const explicitTeamId = Deno.env.get("CLICKUP_TEAM_ID") || undefined;
    const teamId = await resolveTeamId(token, explicitTeamId);
    const memberIds = await fetchAllTeamMemberIds(token, teamId);
    const assignee = memberIds.join(",");

    const now = new Date();
    const windows: { start: Date; end: Date }[] = [];
    for (let i = MONTHS_BACK - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      windows.push({ start, end });
    }

    const allRows: any[] = [];
    let rawSample: any = null;
    for (const w of windows) {
      const qs = new URLSearchParams({
        start_date: String(w.start.getTime()),
        end_date: String(w.end.getTime()),
        include_task_tags: "false",
        include_location_names: "true",
        assignee,
      });
      const data = await clickupFetch(`/team/${teamId}/time_entries?${qs.toString()}`, token);
      const entries = data.data || [];
      if (!rawSample && entries.length) rawSample = entries[0];
      for (const entry of entries) {
        const minutes = Number(entry.duration || 0) / 60000;
        if (!minutes) continue;
        const folder = resolveFolderName(entry);
        const startMs = Number(entry.start || 0);
        const { year, month, day } = localDateParts(startMs);
        allRows.push({
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
    }

    if (allRows.length) {
      const { error: upsertError } = await supabase
        .from("pginvoice_clickup_entries")
        .upsert(allRows, { onConflict: "entry_id" });
      if (upsertError) throw upsertError;
    }

    // Remove entries that were edited/deleted on ClickUp's side since the last
    // sync — anything inside the synced window that this run didn't see again.
    const rangeStart = windows[0].start.toISOString();
    const rangeEnd = windows[windows.length - 1].end.toISOString();
    const fetchedIds = allRows.map((r) => r.entry_id);
    if (fetchedIds.length) {
      await supabase
        .from("pginvoice_clickup_entries")
        .delete()
        .gte("entry_start", rangeStart)
        .lt("entry_start", rangeEnd)
        .not("entry_id", "in", `(${fetchedIds.map((id) => `"${id}"`).join(",")})`);
    }

    await supabase.from("pginvoice_sync_meta").update({
      last_synced_at: new Date().toISOString(), last_sync_status: "ok",
      last_sync_message: `Synced ${allRows.length} entries across ${windows.length} months.`,
      rows_synced: allRows.length,
    }).eq("id", 1);

    return new Response(JSON.stringify({ ok: true, rows_synced: allRows.length, team_id: teamId, raw_sample: rawSample }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("pginvoice_sync_meta").update({
      last_synced_at: new Date().toISOString(), last_sync_status: "error", last_sync_message: message,
    }).eq("id", 1);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
