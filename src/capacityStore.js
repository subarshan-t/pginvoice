// Shared roster/client/support/notes/leaves/overrides storage, backed by
// pginvoice_app_state in Supabase instead of browser localStorage — so
// Capacity Planning edits are visible to every browser/device, not just the
// one that made them. One row per key, value stored as jsonb, same shape
// each caller already worked with under localStorage.
import { supabase } from "./supabaseClient.js";
import { PG_DATA_EVENT } from "./idbStore.js";

export async function loadState(key, fallback) {
  try {
    const { data, error } = await supabase
      .from("pginvoice_app_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    return data.value ?? fallback;
  } catch (e) {
    return fallback;
  }
}

export async function saveState(key, value) {
  try {
    await supabase.from("pginvoice_app_state").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch (e) {
    // best-effort — the in-memory state still holds the edit for this session
  }
  // Same signal idbSet/saveKey already fire for other shared datasets, so any
  // mounted module (Performance, Timesheet Summary) reacts live.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PG_DATA_EVENT, { detail: { key } }));
}
