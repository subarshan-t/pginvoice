// Purple Giraffe — user management (Super Admin / Admin only)
//
// Creating or modifying an auth.users row requires the Supabase service-role
// key, which the browser never holds -- so this function does that step
// server-side. Every action first re-derives the caller's own role from
// pginvoice_profiles (via a second client scoped to their JWT, so RLS applies
// to them) rather than trusting anything the request body claims about who's
// calling, since the body is attacker-controlled input.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS_HEADERS };

const ROLES = ["super_admin", "admin", "consultant", "coordinator"];

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return bad("Not signed in.", 401);

  // Scoped to the caller's own JWT -- this is what actually proves who they are.
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: callerUser, error: callerErr } = await callerClient.auth.getUser(jwt);
  if (callerErr || !callerUser?.user) return bad("Not signed in.", 401);

  const { data: callerProfile } = await callerClient
    .from("pginvoice_profiles")
    .select("role")
    .eq("user_id", callerUser.user.id)
    .maybeSingle();
  const callerRole = callerProfile?.role;
  if (callerRole !== "super_admin" && callerRole !== "admin") {
    return bad("You don't have permission to manage users.", 403);
  }

  // Service-role client -- only used for the pieces an admin/authenticated
  // client genuinely can't do (creating the auth user itself, listing all
  // auth.users for the roster, writing audit rows).
  const admin = createClient(supabaseUrl, serviceRoleKey);

  async function logAudit(action: string, target: { userId?: string; email?: string }, detail?: Record<string, unknown>) {
    await admin.from("pginvoice_audit_log").insert({
      actor_user_id: callerUser.user.id,
      actor_email: callerUser.user.email,
      action,
      target_user_id: target.userId ?? null,
      target_email: target.email ?? null,
      detail: detail ?? null,
    });
  }

  async function superAdminCount(excludingUserId?: string): Promise<number> {
    let q = admin.from("pginvoice_profiles").select("user_id", { count: "exact", head: true }).eq("role", "super_admin");
    if (excludingUserId) q = q.neq("user_id", excludingUserId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { return bad("Invalid request body."); }
  const action = body?.action;

  try {
    if (action === "list") {
      const { data: authList, error: authListErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (authListErr) throw authListErr;
      const { data: profiles, error: profilesErr } = await admin.from("pginvoice_profiles").select("user_id, role, must_change_password");
      if (profilesErr) throw profilesErr;
      const { data: assignments, error: assignErr } = await admin.from("pginvoice_user_clients").select("user_id, client");
      if (assignErr) throw assignErr;

      const profileByUser = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const clientsByUser = new Map<string, string[]>();
      for (const a of assignments || []) {
        const list = clientsByUser.get(a.user_id) || [];
        list.push(a.client);
        clientsByUser.set(a.user_id, list);
      }

      const users = (authList.users || [])
        .filter((u: any) => profileByUser.has(u.id)) // only users provisioned into pginvoice's role system
        .map((u: any) => ({
          id: u.id,
          email: u.email,
          role: profileByUser.get(u.id)?.role,
          mustChangePassword: !!profileByUser.get(u.id)?.must_change_password,
          clients: clientsByUser.get(u.id) || [],
          createdAt: u.created_at,
          lastSignInAt: u.last_sign_in_at,
        }));
      return new Response(JSON.stringify({ ok: true, users }), { headers: JSON_HEADERS });
    }

    if (action === "create") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const role = body.role;
      const clients: string[] = Array.isArray(body.clients) ? body.clients.filter((c: any) => typeof c === "string") : [];

      if (!email || !email.includes("@")) return bad("A valid email is required.");
      if (!password || password.length < 8) return bad("Password must be at least 8 characters.");
      if (!ROLES.includes(role)) return bad("Invalid role.");
      if (role === "super_admin" && callerRole !== "super_admin") {
        return bad("Only a Super Admin can create another Super Admin.", 403);
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) throw createErr;
      const newUserId = created.user!.id;

      // From here on, any failure needs to unwind the auth user we just created --
      // otherwise it's stranded: invisible in `list` (which only shows users with a
      // profile row) but "already registered" on retry, with no way to fix it from
      // this UI. Wrap the rest of setup and roll back on any error.
      try {
        const { error: profileErr } = await admin
          .from("pginvoice_profiles")
          .insert({ user_id: newUserId, email, role, must_change_password: true });
        if (profileErr) throw profileErr;

        if ((role === "consultant" || role === "coordinator") && clients.length) {
          const rows = clients.map((client) => ({ user_id: newUserId, client }));
          const { error: assignErr } = await admin.from("pginvoice_user_clients").insert(rows);
          if (assignErr) throw assignErr;
        }
      } catch (setupErr) {
        await admin.auth.admin.deleteUser(newUserId).catch(() => {});
        throw setupErr;
      }

      await logAudit("create_user", { userId: newUserId, email }, { role, clients });
      return new Response(JSON.stringify({ ok: true, userId: newUserId }), { headers: JSON_HEADERS });
    }

    if (action === "update_role_and_clients") {
      const targetUserId = body.userId;
      const role = body.role;
      const clients: string[] = Array.isArray(body.clients) ? body.clients.filter((c: any) => typeof c === "string") : [];
      if (!targetUserId) return bad("Missing userId.");
      if (!ROLES.includes(role)) return bad("Invalid role.");
      if (targetUserId === callerUser.user.id) {
        return bad("You can't change your own role — ask another Super Admin or Admin to do it.");
      }
      if (role === "super_admin" && callerRole !== "super_admin") {
        return bad("Only a Super Admin can grant the Super Admin role.", 403);
      }

      const { data: targetProfile, error: targetErr } = await admin
        .from("pginvoice_profiles")
        .select("role, email")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (targetErr) throw targetErr;
      if (!targetProfile) return bad("User not found.", 404);

      if (targetProfile.role === "super_admin" && role !== "super_admin") {
        const remaining = await superAdminCount(targetUserId);
        if (remaining === 0) return bad("Can't remove the last Super Admin — promote someone else first.");
      }

      const { error: updErr } = await admin
        .from("pginvoice_profiles")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);
      if (updErr) throw updErr;

      const { error: delErr } = await admin.from("pginvoice_user_clients").delete().eq("user_id", targetUserId);
      if (delErr) throw delErr;
      if ((role === "consultant" || role === "coordinator") && clients.length) {
        const rows = clients.map((client) => ({ user_id: targetUserId, client }));
        const { error: insErr } = await admin.from("pginvoice_user_clients").insert(rows);
        if (insErr) throw insErr;
      }

      // A role change invalidates whatever the old token could do -- without this,
      // a demoted/promoted user keeps their previous effective access until their
      // token naturally expires, since RLS is checked per-request but the token
      // itself isn't re-issued.
      await admin.auth.admin.signOut(targetUserId, "global").catch(() => {});

      await logAudit("update_role", { userId: targetUserId, email: targetProfile.email }, { from: targetProfile.role, to: role, clients });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }

    if (action === "delete") {
      const targetUserId = body.userId;
      if (!targetUserId) return bad("Missing userId.");
      if (targetUserId === callerUser.user.id) return bad("You can't remove your own account.");

      const { data: targetProfile } = await admin
        .from("pginvoice_profiles")
        .select("role, email")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (targetProfile?.role === "super_admin") {
        const remaining = await superAdminCount(targetUserId);
        if (remaining === 0) return bad("Can't remove the last Super Admin — promote someone else first.");
      }

      const { error: authDelErr } = await admin.auth.admin.deleteUser(targetUserId);
      if (authDelErr) throw authDelErr;
      // pginvoice_profiles references auth.users(id) ON DELETE CASCADE, and
      // pginvoice_user_clients references pginvoice_profiles(user_id) ON DELETE
      // CASCADE in turn (see the pginvoice_rbac_users migration) -- both rows
      // are cleaned up by the delete above, nothing further to do here.

      await logAudit("delete_user", { userId: targetUserId, email: targetProfile?.email }, { role: targetProfile?.role });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }

    return bad("Unknown action.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(message, 400);
  }
});
