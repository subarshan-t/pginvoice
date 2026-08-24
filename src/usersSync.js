// Purple Giraffe — role & user-management data access.
//
// Reading your own role/assignments goes straight through Supabase (RLS on
// pginvoice_profiles/pginvoice_user_clients already scopes it to "your own
// row, or all rows if you're admin-tier"). Anything that creates, edits, or
// deletes a user goes through the manage-users Edge Function instead, since
// only it holds the service-role key needed to touch auth.users.
import { supabase } from "./supabaseClient.js";

const FUNCTIONS_URL = "https://fzvlnzlecchsubkpsmew.supabase.co/functions/v1/manage-users";

export const ROLES = ["super_admin", "admin", "consultant", "coordinator"];
export const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  consultant: "Consultant",
  coordinator: "Coordinator",
};
// Roles scoped to only their assigned clients, rather than the whole client base.
export const CLIENT_SCOPED_ROLES = new Set(["consultant", "coordinator"]);
export const ADMIN_TIER_ROLES = new Set(["super_admin", "admin"]);

// Called once per session (Shell.jsx) to know what nav/data this signed-in
// user gets. Returns null if the user has no pginvoice_profiles row yet
// (shouldn't happen for anyone created through this feature, but a legacy
// login predating it would hit this — treated as "no access" rather than a
// crash, since silently granting a role here would be the wrong failure mode).
export async function fetchOwnProfile() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return null;
  const { data, error } = await supabase
    .from("pginvoice_profiles")
    .select("user_id, role")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error || !data) return null;

  let clients = [];
  if (CLIENT_SCOPED_ROLES.has(data.role)) {
    const { data: rows } = await supabase.from("pginvoice_user_clients").select("client").eq("user_id", data.user_id);
    clients = (rows || []).map((r) => r.client);
  }
  return { userId: data.user_id, role: data.role, clients };
}

async function callManageUsers(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  const res = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export async function fetchUsers() {
  const body = await callManageUsers({ action: "list" });
  return body.users || [];
}

export async function createUser({ email, password, role, clients }) {
  return callManageUsers({ action: "create", email, password, role, clients });
}

export async function updateUserRoleAndClients({ userId, role, clients }) {
  return callManageUsers({ action: "update_role_and_clients", userId, role, clients });
}

export async function deleteUser(userId) {
  return callManageUsers({ action: "delete", userId });
}
