import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type Role = "tenant_admin" | "tenant_member";

const listAllUsers = async (client: ReturnType<typeof createClient>) => {
  let page = 1;
  const perPage = 1000;
  const users: Array<{ id: string; email?: string | null; created_at?: string | null; confirmed_at?: string | null; banned_until?: string | null }> = [];

  while (page <= 5) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: authUserData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUserData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid token", details: authError?.message || "Token inválido", message: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const authUserId = authUserData.user.id;
    const { data: platformProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUserId)
      .single();

    if (platformProfile?.role !== "platform_admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const action = typeof body?.action === "string"
      ? body.action.trim().replace(/([a-z])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase()
      : "";

    if (action === "list-unassigned-users") {
      const users = await listAllUsers(supabaseAdmin);
      const userIds = users.map((u) => u.id);

      const { data: memberships } = userIds.length > 0
        ? await supabaseAdmin.from("tenant_users").select("user_id").in("user_id", userIds)
        : { data: [] };
      const assignedUserIds = new Set((memberships || []).map((row) => row.user_id));

      const { data: profiles } = userIds.length > 0
        ? await supabaseAdmin.from("profiles").select("id, full_name, role").in("id", userIds)
        : { data: [] };
      const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

      const freeUsers = users
        .filter((user) => !assignedUserIds.has(user.id))
        .map((user) => ({
          id: user.id,
          email: user.email,
          full_name: profileMap.get(user.id)?.full_name || null,
          created_at: user.created_at
        }));

      return new Response(JSON.stringify({ users: freeUsers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "assign-user-to-tenant") {
      const { tenantId: targetTenantId, userId, role } = body;
      if (!targetTenantId || !userId) {
        return new Response(JSON.stringify({ error: "Missing tenantId or userId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .select("id")
        .eq("id", targetTenantId)
        .single();
      if (tenantError || !tenant?.id) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (authUserError || !authUser?.user?.id) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: existingMemberships } = await supabaseAdmin
        .from("tenant_users")
        .select("tenant_id")
        .eq("user_id", userId)
        .limit(1);
      if ((existingMemberships || []).length > 0) {
        return new Response(JSON.stringify({ error: "User already assigned to a tenant" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const safeRole: Role = role === "tenant_admin" ? "tenant_admin" : "tenant_member";
      const { error: assignError } = await supabaseAdmin
        .from("tenant_users")
        .insert({
          tenant_id: targetTenantId,
          user_id: userId,
          role: safeRole,
          status: "active"
        });
      if (assignError) {
        return new Response(JSON.stringify({ error: "Error assigning user to tenant", details: assignError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action", details: action || "missing_action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
