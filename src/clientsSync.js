// Client roster: current type/consultant/status plus an append-only event log for
// scheduled transitions (type change, consultant change, offboarding). Events carry
// an effective date; applyDueEvents() rolls forward any that have arrived, and
// agreedHoursForMonth()/typeForMonth() replay the type-change history so accrual
// math stays correct across a client's package changing mid-year.
import { supabase } from "./supabaseClient.js";

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
  };
}

export async function fetchClientEvents(client) {
  let q = supabase.from("pginvoice_client_events").select("*").order("effective_date", { ascending: true });
  if (client) q = q.eq("client", client);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createClientEvent(client, kind, effectiveDate, fields, note) {
  const row = { client, kind, effective_date: effectiveDate, note: note || null, applied: false, ...fields };
  const { error } = await supabase.from("pginvoice_client_events").insert(row);
  if (error) throw error;
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
    .order("effective_date", { ascending: true });
  if (error) throw error;
  if (!due || !due.length) return 0;

  for (const ev of due) {
    const patch = {};
    if (ev.kind === "type") { patch.type = ev.new_type; patch.agreed_hours = ev.new_agreed_hours; }
    else if (ev.kind === "consultant") { patch.consultant = ev.new_consultant; }
    else if (ev.kind === "offboarding") { patch.status = "offboarded"; patch.end_date = ev.effective_date; }
    const { error: updErr } = await supabase.from("pginvoice_clients").update(patch).eq("client", ev.client);
    if (updErr) throw updErr;
    const { error: markErr } = await supabase.from("pginvoice_client_events").update({ applied: true }).eq("id", ev.id);
    if (markErr) throw markErr;
  }
  return due.length;
}

// Replays a client's applied "type" events to answer "what were they on, and what
// were their agreed hours, as of this month" — needed because a client's package
// can change mid-year and accrual math for a given month must use what was in
// effect then, not whatever is current today.
export function typeTimelineFor(client, events) {
  const segments = [{ from: null, type: client.baseType, agreedHours: client.baseAgreedHours }];
  const typeEvents = events
    .filter((e) => e.client === client.client && e.kind === "type" && e.applied)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  for (const e of typeEvents) segments.push({ from: e.effective_date, type: e.new_type, agreedHours: e.new_agreed_hours === null ? null : Number(e.new_agreed_hours) });
  return segments;
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
