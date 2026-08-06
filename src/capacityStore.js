// Shared roster/client/support/notes/leaves/overrides storage, backed by
// pginvoice_app_state in Supabase instead of browser localStorage — so
// Capacity Planning edits are visible to every browser/device, not just the
// one that made them. One row per key, value stored as jsonb, same shape
// each caller already worked with under localStorage.
import { supabase } from "./supabaseClient.js";
import { PG_DATA_EVENT } from "./idbStore.js";

// Callers must NOT treat a thrown error the same as "no row yet" -- a real
// query failure (network blip, RLS denial, expired session) used to be
// silently swallowed here and resolved with `fallback`, which for the seed
// keys (SEED_PEOPLE/SEED_CLIENTS/SEED_SUPPORT) meant a transient error could
// look identical to "first run, nothing saved yet". Callers then marked
// themselves loaded and their save-effects wrote that fallback straight back
// to Supabase, silently overwriting real data with the hardcoded seed. A
// missing row (`data === null`, no error) is the only case that should fall
// back quietly; a real error must propagate so the caller can refuse to
// proceed as if it had loaded successfully.
export async function loadState(key, fallback) {
  const { data, error } = await supabase
    .from("pginvoice_app_state")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.value ?? fallback) : fallback;
}

// Same reasoning as loadState: a failed save must not look identical to a
// successful one. Callers should catch this and surface it -- an edit that
// silently didn't persist is worse than one that visibly failed.
export async function saveState(key, value) {
  const { error } = await supabase.from("pginvoice_app_state").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  // Same signal idbSet/saveKey already fire for other shared datasets, so any
  // mounted module (Performance, Timesheet Summary) reacts live. Only fired
  // on a confirmed successful write -- firing it after a failed save would
  // tell other modules something changed when it didn't.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PG_DATA_EVENT, { detail: { key } }));
}
