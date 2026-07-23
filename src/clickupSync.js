// Bridges the pginvoice_clickup_entries table (kept fresh by the clickup-sync
// Edge Function on a cron schedule) into the exact shape App.jsx has always
// produced from a manual CSV upload — so every downstream module (Capacity
// Planning, Performance, Timesheet Summary) needs zero changes; they already
// just read `clickup.rows` regardless of where it came from.
import { supabase } from "./supabaseClient.js";

const PAGE_SIZE = 1000; // PostgREST's default row cap per request — paginate past it

export async function fetchClickupFromSupabase() {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("pginvoice_clickup_entries")
      .select("folder, task, minutes, billable, has_billable_col, user_name, is_internal, month_key, month_label, date_key")
      .order("entry_start", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  if (!all.length) return null;

  const rows = all.map((r) => ({
    folder: r.folder,
    task: r.task,
    minutes: Number(r.minutes) || 0,
    billable: !!r.billable,
    hasBillableCol: !!r.has_billable_col,
    user: r.user_name || "",
    isInternal: !!r.is_internal,
    monthKey: r.month_key || null,
    monthLabel: r.month_label || null,
    dateKey: r.date_key || null,
  }));
  return {
    rows,
    hasBillable: rows.some((r) => r.hasBillableCol),
    hasUser: rows.some((r) => r.user),
    hasStartDate: rows.some((r) => r.dateKey),
    warnings: [],
    fileName: "Live sync from ClickUp",
  };
}

export async function fetchSyncMeta() {
  const { data, error } = await supabase.from("pginvoice_sync_meta").select("*").eq("id", 1).maybeSingle();
  if (error) return null;
  return data;
}

// Calls the Edge Function directly rather than waiting for the next cron
// tick — used by the "Sync now" button for an on-demand refresh.
export async function triggerManualSync() {
  const { data, error } = await supabase.functions.invoke("clickup-sync", { body: {} });
  if (error) throw error;
  return data;
}
