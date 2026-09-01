// Client roster: current type/consultant/status plus an append-only event log for
// scheduled transitions (type change, consultant change, offboarding). Events carry
// an effective date; applyDueEvents() rolls forward any that have arrived, and
// agreedHoursForMonth()/typeForMonth() replay the type-change history so accrual
// math stays correct across a client's package changing mid-year.
import { supabase } from "./supabaseClient.js";
import { PG_DATA_EVENT } from "./idbStore.js";
import { PG_CLIENTS_KEY, PG_COST_CENTRES_KEY } from "./storageKeys.js";

// Every module (Clients, Capacity Planning) that reads pginvoice_clients stays mounted for
// the whole session rather than remounting on tab switch, so a change made in one won't be
// picked up by the other without an explicit signal -- broadcast the same event the rest of
// the app already uses for cross-module refresh whenever this table changes.
function notifyClientsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PG_DATA_EVENT, { detail: { key: PG_CLIENTS_KEY } }));
}
function notifyCostCentresChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PG_DATA_EVENT, { detail: { key: PG_COST_CENTRES_KEY } }));
}

// Every mutation below writes one row to pginvoice_client_history so the drawer's
// History section can show a single chronological "who changed what, when" feed
// across transitions, consultant updates, folder edits, cost-centre changes, and
// notes -- rather than each kind of change living in its own untracked place (as
// folder edits and cost-centre add/remove did before this table existed).
async function logClientHistory(client, action, summary, detail) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("pginvoice_client_history").insert({
    client, action, actor_email: userData?.user?.email || null, actor_user_id: userData?.user?.id || null,
    detail: { summary, ...(detail || {}) },
  });
  // Best-effort -- a history-logging failure shouldn't roll back or block the
  // actual change it's describing (which has already committed by the time this
  // runs in every caller below).
  if (error) console.error("Couldn't log client history:", error);
}

export async function fetchClientHistory(client) {
  const { data, error } = await supabase.from("pginvoice_client_history").select("*").eq("client", client).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// The user-editable cost-centre/sub-project links (pginvoice_cost_centres) -- Shell.jsx
// fetches this once at the top level (every page is mounted simultaneously, just hidden via
// CSS, see Shell.jsx's `display: active === ... ? "block" : "none"` pattern) and feeds it into
// nameMatch.js's setDynamicCostCentres, so multiFolderMatchesFor/multiFolderAccrualMatchesFor
// pick it up everywhere without each caller needing its own fetch.
export async function fetchCostCentres() {
  const { data, error } = await supabase.from("pginvoice_cost_centres").select("*").order("client", { ascending: true });
  if (error) throw error;
  return data || [];
}

// `kind`: "cost_centre" (counts toward the parent's package accrual) or "sub_project"
// (billed separately, excluded from the accrual but still shown rolled up under the parent).
export async function addCostCentreFolder(client, folder, kind) {
  const { error } = await supabase.from("pginvoice_cost_centres").insert({ client, folder, kind });
  if (error) throw error;
  notifyCostCentresChanged();
  const label = kind === "sub_project" ? "sub-project" : "cost centre";
  logClientHistory(client, "cost_centre_add", `Added ${label}: ${folder}`, { folder, kind });
}

export async function removeCostCentreFolder(client, folder, kind) {
  const { error } = await supabase.from("pginvoice_cost_centres").delete().eq("client", client).eq("folder", folder);
  if (error) throw error;
  notifyCostCentresChanged();
  const label = kind === "sub_project" ? "sub-project" : "cost centre";
  logClientHistory(client, "cost_centre_remove", `Removed ${label}: ${folder}`, { folder, kind });
}

export async function fetchClients() {
  const { data, error } = await supabase.from("pginvoice_clients").select("*").order("client", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToClient);
}

function rowToClient(r) {
  return {
    client: r.client,
    type: r.type,
    agreedHours: r.agreed_hours === null ? null : Number(r.agreed_hours),
    // Immutable snapshot of type/hours as first recorded — applyDueClientEvents only ever
    // updates `type`/`agreedHours` above, never these, so historical months from before any
    // transition can still be reconstructed correctly (see typeTimelineFor).
    baseType: r.base_type,
    baseAgreedHours: r.base_agreed_hours === null ? null : Number(r.base_agreed_hours),
    consultant: r.consultant || null,
    startDate: r.start_date || null,
    endDate: r.end_date || null,
    status: r.status,
    clickupFolder: r.clickup_folder || null,
    website: r.website || null,
    // Either a manually uploaded image (resized to a small JPEG data URL, same
    // pattern as consultant photos in avatar.jsx) or an auto-fetched favicon URL
    // from the client's website — either way, just a URL the row/drawer can drop
    // straight into an <img>.
    logoUrl: r.logo_url || null,
  };
}

// The ClickUp folder name this client's real hours are logged under -- not part of the
// scheduled-event lifecycle (type/consultant/offboarding), just editable metadata, so it's
// a direct update rather than an event.
export async function updateClickupFolder(client, folder, { previousFolder } = {}) {
  const { error } = await supabase.from("pginvoice_clients").update({ clickup_folder: folder || null }).eq("client", client);
  if (error) throw error;
  notifyClientsChanged();
  const summary = folder ? `Set ClickUp folder to "${folder}"` : "Cleared ClickUp folder";
  logClientHistory(client, "folder_change", summary, { from: previousFolder || null, to: folder || null });
}

// Saves the client's website URL and, when `autoLogo` is true, derives a logo
// from it via a public favicon service rather than scraping the site ourselves
// (no server-side fetch/CORS/edge-function needed for a small icon). Passing an
// explicit `logoUrl` (e.g. from a manual upload) skips the auto-fetch entirely.
//
// This is the single source of truth for what the logo becomes when the website is
// saved -- callers should NOT separately recompute `faviconUrlFor(website)` and patch
// their own local state with it, since that duplicated derivation is what let clearing
// the website (website === "") leave a stale `logo_url` in the DB while the UI showed
// no logo. Pass `currentLogoUrl` (the client's logo before this save) so a manually
// uploaded logo -- a `data:` URL, see resizePhotoFile in avatar.jsx -- isn't silently
// clobbered by an auto-fetched favicon just because the website field was re-saved for
// an unrelated reason; a favicon URL always starts with the Google favicon endpoint (see
// faviconUrlFor below), so that's how we tell "auto" and "manual" logos apart without a
// schema change. Returns the patch that was actually applied to the DB (`{ website }` or
// `{ website, logoUrl }`) so the caller can apply the exact same values to local UI state
// instead of re-deriving them.
export async function updateClientWebsite(client, website, { autoLogo = true, logoUrl, currentLogoUrl } = {}) {
  const trimmedWebsite = website || null;
  const patch = { website: trimmedWebsite };
  if (logoUrl !== undefined) {
    patch.logo_url = logoUrl || null;
  } else if (autoLogo) {
    const isManualUpload = !!currentLogoUrl && currentLogoUrl.startsWith("data:");
    if (!isManualUpload) {
      // Explicitly clears logo_url (to null) when the website is cleared, rather than
      // leaving a stale favicon in the DB that reappears on the next reload.
      patch.logo_url = trimmedWebsite ? faviconUrlFor(trimmedWebsite) : null;
    }
  }
  const { error } = await supabase.from("pginvoice_clients").update(patch).eq("client", client);
  if (error) throw error;
  notifyClientsChanged();
  const applied = { website: patch.website };
  if ("logo_url" in patch) applied.logoUrl = patch.logo_url;
  return applied;
}

export async function updateClientLogo(client, logoUrl) {
  const { error } = await supabase.from("pginvoice_clients").update({ logo_url: logoUrl || null }).eq("client", client);
  if (error) throw error;
  notifyClientsChanged();
}

// Google's public favicon service -- no API key, no CORS issues, and it already
// resolves redirects/subdomains for us. Good enough for a small logo chip; a
// client that wants their exact brand mark can still upload one manually.
export function faviconUrlFor(website) {
  if (!website) return null;
  let host = website.trim();
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  try {
    const { hostname } = new URL(host);
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(hostname)}`;
  } catch {
    return null;
  }
}

// New client, created from either Capacity Planning or the Clients module -- both write
// to this same table, so a client added in one place shows up in the other immediately.
export async function createClient(client, { type, agreedHours, consultant, startDate }) {
  // Strategy is an ongoing engagement with agreed recurring hours -- the same fixed-hours
  // accrual shape as Package -- so it carries an agreed-hours figure the same way.
  const isPackageLike = type === "package" || type === "strategy";
  const row = {
    client, type, agreed_hours: isPackageLike ? (agreedHours ?? null) : null,
    base_type: type, base_agreed_hours: isPackageLike ? (agreedHours ?? null) : null,
    consultant: consultant || null, start_date: startDate || null, status: "active",
  };
  const { error } = await supabase.from("pginvoice_clients").insert(row);
  if (error) throw error;
  notifyClientsChanged();
}

export async function fetchClientEvents(client) {
  let q = supabase.from("pginvoice_client_events").select("*").order("effective_date", { ascending: true });
  if (client) q = q.eq("client", client);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

const EVENT_KIND_LABEL = {
  type: "Transition", consultant: "Consultant update", offboarding: "Offboarding",
  reactivation: "Reactivation", hold: "Put on hold", resume: "Resume",
};
export async function createClientEvent(client, kind, effectiveDate, fields, note) {
  const row = { client, kind, effective_date: effectiveDate, note: note || null, applied: false, ...fields };
  const { error } = await supabase.from("pginvoice_client_events").insert(row);
  if (error) throw error;
  notifyClientsChanged();
  const label = EVENT_KIND_LABEL[kind] || kind;
  const detailBits = kind === "type" ? `→ ${fields.new_type}${fields.new_agreed_hours != null ? ` (${fields.new_agreed_hours} hrs)` : ""}`
    : kind === "consultant" ? `→ ${fields.new_consultant || "unassigned"}`
    : "";
  logClientHistory(client, `event_${kind}`, `Scheduled ${label}${detailBits ? ` ${detailBits}` : ""}, effective ${effectiveDate}`, { kind, effectiveDate, ...fields, note: note || null });
}

// Only for events that haven't been applied yet (still-scheduled/future transitions) --
// an already-applied event's mutation to the client's current row already happened, and
// typeTimelineFor's replay of past months reads applied=true events specifically, so
// deleting one after the fact would silently rewrite already-closed months' history. The
// Clients module enforces this by only ever offering delete on pending rows; enforced here
// too so any other future caller can't accidentally do it either.
export async function deleteClientEvent(id, { applied, client, kind } = {}) {
  if (applied) throw new Error("Can't delete an already-applied event -- it already changed the client's history.");
  const { error } = await supabase.from("pginvoice_client_events").delete().eq("id", id).eq("applied", false);
  if (error) throw error;
  notifyClientsChanged();
  if (client) logClientHistory(client, `event_${kind}_removed`, `Removed scheduled ${EVENT_KIND_LABEL[kind] || kind}`, { kind });
}

// Applies any event whose effective date has arrived (<= today) and isn't applied
// yet, mutating the client's current profile row. Safe to call on every module
// load — already-applied events are a no-op via the `applied` guard.
export async function applyDueClientEvents() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const { data: due, error } = await supabase
    .from("pginvoice_client_events")
    .select("*")
    .eq("applied", false)
    .lte("effective_date", todayKey)
    // Secondary sort by id (insertion order) breaks ties deterministically when two
    // events on the same client share an effective_date -- e.g. an offboarding and a
    // later-created reactivation both dated today. Without this, Postgres's return
    // order for equal effective_date values isn't guaranteed, so which patch "wins"
    // (applied last) could vary run to run.
    .order("effective_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  if (!due || !due.length) return 0;

  for (const ev of due) {
    const patch = {};
    if (ev.kind === "type") { patch.type = ev.new_type; patch.agreed_hours = ev.new_agreed_hours; }
    else if (ev.kind === "consultant") { patch.consultant = ev.new_consultant; }
    else if (ev.kind === "offboarding") { patch.status = "offboarded"; patch.end_date = ev.effective_date; }
    else if (ev.kind === "reactivation") { patch.status = "active"; patch.end_date = null; }
    // On hold: still an ongoing client, just paused (e.g. billing dispute) -- unlike
    // offboarding, doesn't touch end_date since this isn't a real end of engagement.
    else if (ev.kind === "hold") { patch.status = "on_hold"; }
    else if (ev.kind === "resume") { patch.status = "active"; }
    const { error: updErr } = await supabase.from("pginvoice_clients").update(patch).eq("client", ev.client);
    if (updErr) throw updErr;
    const { error: markErr } = await supabase.from("pginvoice_client_events").update({ applied: true }).eq("id", ev.id);
    if (markErr) throw markErr;
  }
  notifyClientsChanged();
  return due.length;
}

// Replays a client's applied "type" events to answer "what were they on, and what
// were their agreed hours, as of this month" — needed because a client's package
// can change mid-year and accrual math for a given month must use what was in
// effect then, not whatever is current today.
export function typeTimelineFor(client, events) {
  const segments = [{ from: null, type: client.baseType, agreedHours: client.baseAgreedHours, note: null }];
  const typeEvents = events
    .filter((e) => e.client === client.client && e.kind === "type" && e.applied)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  for (const e of typeEvents) segments.push({ from: e.effective_date, type: e.new_type, agreedHours: e.new_agreed_hours === null ? null : Number(e.new_agreed_hours), note: e.note || null });
  return segments;
}

// Multiple dated notes per client -- each independently editable/deletable, not
// a single overwritten scratchpad. Every add/edit/delete also lands in the
// client's History feed via logClientHistory.
export async function fetchClientNotes(client) {
  const { data, error } = await supabase.from("pginvoice_client_notes").select("*").eq("client", client).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addClientNote(client, text) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("pginvoice_client_notes").insert({
    client, text, author_email: userData?.user?.email || null, author_user_id: userData?.user?.id || null,
  });
  if (error) throw error;
  notifyClientsChanged();
  logClientHistory(client, "note_add", `Added a note`, { text });
}

export async function updateClientNote(id, client, text) {
  const { error } = await supabase.from("pginvoice_client_notes").update({ text, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  notifyClientsChanged();
  logClientHistory(client, "note_edit", `Edited a note`, { text });
}

export async function deleteClientNote(id, client) {
  const { error } = await supabase.from("pginvoice_client_notes").delete().eq("id", id);
  if (error) throw error;
  notifyClientsChanged();
  logClientHistory(client, "note_delete", `Deleted a note`, {});
}

export function typeForMonth(client, events, monthKey) {
  const segments = typeTimelineFor(client, events);
  const monthStart = `${monthKey}-01`;
  let current = segments[0];
  for (const seg of segments) {
    if (seg.from === null || seg.from <= monthStart) current = seg;
  }
  return current;
}
