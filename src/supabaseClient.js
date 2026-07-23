import { createClient } from "@supabase/supabase-js";

// Publishable/anon key — safe to ship to the browser. Row-level security on the
// pginvoice_* tables restricts this key to read-only; all writes happen from
// the clickup-sync Edge Function using its own service-role key, which never
// reaches the client.
const SUPABASE_URL = "https://fzvlnzlecchsubkpsmew.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dmxuemxlY2Noc3Via3BzbWV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2ODIyODMsImV4cCI6MjA5NzI1ODI4M30.UDQFf4X43i7nriZntWoIIwV1KbgCR1wHdPF5MghWMAQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
