import { createClient } from "@supabase/supabase-js";

// Publishable/anon key — safe to ship to the browser. On its own it grants
// nothing: every pginvoice_* table's RLS policy requires the `authenticated`
// role, not `anon` (see Shell.jsx's real Supabase Auth login). Once signed
// in, supabase-js attaches the session's JWT to every request automatically,
// which is what actually unlocks read/write access — the anon key here is
// just the client's project identifier, not a credential by itself.
const SUPABASE_URL = "https://fzvlnzlecchsubkpsmew.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dmxuemxlY2Noc3Via3BzbWV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2ODIyODMsImV4cCI6MjA5NzI1ODI4M30.UDQFf4X43i7nriZntWoIIwV1KbgCR1wHdPF5MghWMAQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
