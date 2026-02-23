import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type Role = "tenant_admin" | "tenant_member";

const isMissingColumnError = (error: unknown): boolean => {
  const message = typeof (error as { message?: unknown })?.message === "string"
    ? ((error as { message: string }).message || "").toLowerCase()
    : "";
  return message.includes("column") && message.includes("does not exist");
};

const findUserByEmail = async (client: ReturnType<typeof createClient>, email: string) => {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;

  while (page <= 5) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const found = (data?.users || []).find((user) => user.email?.toLowerCase() === normalized);
    if (found) return found;
    if (!data?.users || data.users.length < perPage) break;
    page += 1;
  }

  return null;
};

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
      console.error("[admin-users] Missing auth token", {
        hasAuthorizationHeader: !!authHeader
      });
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: authUserData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUserData?.user) {
      console.error("[admin-users] Invalid JWT", {
        authError: authError?.message || null,
        tokenPreview: token?.substring(0, 50) + "...",
        headerPreview: authHeader.substring(0, 60) + "..."
      });
      return new Response(JSON.stringify({
        error: "Invalid token",
        details: authError?.message || "Token inválido",
        code: 401,
        message: "Invalid JWT"
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const authUserId = authUserData.user.id;
    const authEmail = authUserData.user.email || null;

    const { data: platformProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUserId)
      .single();

    const isPlatformAdmin = platformProfile?.role === "platform_admin";

    const { data: tenantUser } = await supabaseAdmin
      .from("tenant_users")
      .select("tenant_id, role")
      .eq("user_id", authUserId)
      .single();

    const tenantId = tenantUser?.tenant_id || null;
    const isTenantAdmin = tenantUser?.role === "tenant_admin";

    const body = await req.json();
    const rawAction = typeof body?.action === "string" ? body.action.trim() : null;
    const normalizedAction = rawAction
      ? rawAction
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .replace(/_/g, "-")
          .toLowerCase()
      : null;
    const action = normalizedAction;

    if (action === "get-context") {
      let tenantName: string | null = null;
      if (tenantId) {
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("name")
          .eq("id", tenantId)
          .single();
        tenantName = tenant?.name ?? null;
      }

      return new Response(
        JSON.stringify({
          tenantId,
          tenantName,
          isPlatformAdmin,
          isTenantAdmin,
          role: tenantUser?.role || null
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list-tenants") {
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartIso = monthStart.toISOString();

      let { data: tenants, error } = await supabaseAdmin
        .from("tenants")
        .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at, billing_period_start, billing_period_end, customer_since")
        .order("created_at", { ascending: false });

      if (error && isMissingColumnError(error)) {
        const fallback = await supabaseAdmin
          .from("tenants")
          .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at")
          .order("created_at", { ascending: false });
        tenants = (fallback.data || []).map((tenant) => ({
          ...tenant,
          billing_period_start: null,
          billing_period_end: null,
          customer_since: null
        }));
        error = fallback.error;
      }

      if (error) throw error;

      if (!tenants || tenants.length === 0) {
        return new Response(JSON.stringify({ tenants: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: tenantUsers } = await supabaseAdmin
        .from("tenant_users")
        .select("tenant_id");

      const planIds = Array.from(new Set((tenants || []).map((t) => t.plan_id).filter(Boolean)));
      let plans: Array<{ id: string; name: string; docs_limit_month: number; mrr_cents: number }> = [];
      if (planIds.length > 0) {
        const { data: plansData } = await supabaseAdmin
          .from("plans")
          .select("id, name, docs_limit_month, mrr_cents")
          .in("id", planIds);
        plans = plansData || [];
      }
      const planMap = new Map(plans.map((plan) => [plan.id, plan]));

      const { data: documents } = await supabaseAdmin
        .from("documents")
        .select("tenant_id, created_at")
        .gte("created_at", monthStartIso)
        .not("documenso_envelope_id", "is", null);

      const userCountMap = new Map<string, number>();
      (tenantUsers || []).forEach((row) => {
        const key = row.tenant_id;
        if (!key) return;
        userCountMap.set(key, (userCountMap.get(key) || 0) + 1);
      });

      const docsMonthMap = new Map<string, number>();
      (documents || []).forEach((row) => {
        const key = row.tenant_id;
        if (!key) return;
        docsMonthMap.set(key, (docsMonthMap.get(key) || 0) + 1);
      });

      const enriched = tenants.map((tenant) => {
        const plan = tenant.plan_id ? planMap.get(tenant.plan_id) : null;
        const docsUsed = docsMonthMap.get(tenant.id) || 0;
        const docsLimit = plan?.docs_limit_month ?? 0;
        return {
          ...tenant,
          plan_name: plan?.name || null,
          plan_docs_limit: docsLimit,
          plan_mrr_cents: plan?.mrr_cents ?? 0,
          user_count: userCountMap.get(tenant.id) || 0,
          docs_month: docsUsed,
          docs_available: docsLimit > 0 ? Math.max(docsLimit - docsUsed, 0) : null
        };
      });

      return new Response(JSON.stringify({ tenants: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "list-plans") {
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: plansData, error: plansError } = await supabaseAdmin
        .from("plans")
        .select("id, name, docs_limit_month, mrr_cents, created_at")
        .order("created_at", { ascending: false });

      if (plansError) throw plansError;

      return new Response(JSON.stringify({ plans: plansData || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "create-plan") {
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { name, docsLimitMonth, mrrCents } = body;
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing plan name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: createdPlan, error: createError } = await supabaseAdmin
        .from("plans")
        .insert({
          name,
          docs_limit_month: Number(docsLimitMonth || 0),
          mrr_cents: Number(mrrCents || 0)
        })
        .select("id, name, docs_limit_month, mrr_cents, created_at")
        .single();

      if (createError) throw createError;

      return new Response(JSON.stringify({ plan: createdPlan }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "update-plan") {
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { planId, name, docsLimitMonth, mrrCents } = body;
      if (!planId) {
        return new Response(JSON.stringify({ error: "Missing planId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!name || !String(name).trim()) {
        return new Response(JSON.stringify({ error: "Missing plan name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const parsedLimit = Number(docsLimitMonth || 0);
      const parsedMrr = Number(mrrCents || 0);
      if (parsedLimit < 0 || parsedMrr < 0) {
        return new Response(JSON.stringify({ error: "Invalid negative values" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: updatedPlan, error: updateError } = await supabaseAdmin
        .from("plans")
        .update({
          name: String(name).trim(),
          docs_limit_month: parsedLimit,
          mrr_cents: parsedMrr
        })
        .eq("id", planId)
        .select("id, name, docs_limit_month, mrr_cents, created_at")
        .single();

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ plan: updatedPlan }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "set-tenant-plan") {
      const { tenantId: targetTenantId, planId } = body;
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId) {
        return new Response(JSON.stringify({ error: "Missing tenantId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let { data: existingTenant, error: existingTenantError } = await supabaseAdmin
        .from("tenants")
        .select("billing_period_start, billing_period_end, customer_since")
        .eq("id", targetTenantId)
        .single();

      if (existingTenantError && isMissingColumnError(existingTenantError)) {
        const fallbackExisting = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("id", targetTenantId)
          .single();
        existingTenant = fallbackExisting.data
          ? { billing_period_start: null, billing_period_end: null, customer_since: null }
          : null;
        existingTenantError = fallbackExisting.error;
      }

      if (existingTenantError) throw existingTenantError;

      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const endDateObj = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()));
      const endDate = endDateObj.toISOString().slice(0, 10);

      const updatePayload: Record<string, unknown> = { plan_id: planId || null };
      if (planId) {
        if (!existingTenant?.billing_period_start) updatePayload.billing_period_start = startDate;
        if (!existingTenant?.billing_period_end) updatePayload.billing_period_end = endDate;
        if (!existingTenant?.customer_since) updatePayload.customer_since = startDate;
      }

      let { data: updatedTenant, error: updateError } = await supabaseAdmin
        .from("tenants")
        .update(updatePayload)
        .eq("id", targetTenantId)
        .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at, billing_period_start, billing_period_end, customer_since")
        .single();

      if (updateError && isMissingColumnError(updateError)) {
        const fallbackUpdate = await supabaseAdmin
          .from("tenants")
          .update({ plan_id: planId || null })
          .eq("id", targetTenantId)
          .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at")
          .single();
        updatedTenant = fallbackUpdate.data
          ? {
            ...fallbackUpdate.data,
            billing_period_start: null,
            billing_period_end: null,
            customer_since: null
          }
          : null;
        updateError = fallbackUpdate.error;
      }

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ tenant: updatedTenant }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "set-tenant-status") {
      const { tenantId: targetTenantId, isActive } = body;
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId) {
        return new Response(JSON.stringify({ error: "Missing tenantId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let { data: updatedTenant, error: updateError } = await supabaseAdmin
        .from("tenants")
        .update({ is_active: !!isActive })
        .eq("id", targetTenantId)
        .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at, billing_period_start, billing_period_end, customer_since")
        .single();

      if (updateError && isMissingColumnError(updateError)) {
        const fallbackUpdate = await supabaseAdmin
          .from("tenants")
          .update({ is_active: !!isActive })
          .eq("id", targetTenantId)
          .select("id, name, slug, is_active, plan_id, subscription_expires_at, created_at")
          .single();
        updatedTenant = fallbackUpdate.data
          ? {
            ...fallbackUpdate.data,
            billing_period_start: null,
            billing_period_end: null,
            customer_since: null
          }
          : null;
        updateError = fallbackUpdate.error;
      }

      if (updateError) throw updateError;

      let planData: { name: string; docs_limit_month: number; mrr_cents: number } | null = null;
      if (updatedTenant?.plan_id) {
        const { data: plan } = await supabaseAdmin
          .from("plans")
          .select("name, docs_limit_month, mrr_cents")
          .eq("id", updatedTenant.plan_id)
          .single();
        planData = plan || null;
      }

      return new Response(JSON.stringify({ tenant: updatedTenant }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "create-tenant") {
      // Solo platform admin puede crear tenants
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Solo administradores de plataforma pueden crear tenants" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { name } = body;
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing tenant name" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const { data: createdTenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({ name, slug, customer_since: new Date().toISOString().slice(0, 10) })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Platform admin no se asigna automáticamente al nuevo tenant
      // Use create-tenant-admin para crear tenant con admin específico

      return new Response(JSON.stringify({ tenant: createdTenant }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "create-tenant-admin") {
      const { name, email } = body;
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!name || !email) {
        return new Response(JSON.stringify({ error: "Missing data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const { data: createdTenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({ name, slug, customer_since: new Date().toISOString().slice(0, 10) })
        .select()
        .single();

      if (tenantError) throw tenantError;

      const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${Deno.env.get("SITE_URL") || ""}/login`
      });
      if (error) throw error;

      await supabaseAdmin.from("tenant_users").insert({
        tenant_id: createdTenant.id,
        user_id: invited.user?.id,
        role: "tenant_admin",
        status: "invited"
      });

      return new Response(JSON.stringify({ tenant: createdTenant, user: invited.user }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "invite-user") {
      const { email, role, fullName } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const safeRole: Role = role === "tenant_admin" ? "tenant_admin" : "tenant_member";

      let invitedUser = await findUserByEmail(supabaseAdmin, email);

      if (!invitedUser) {
        const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${Deno.env.get("SITE_URL") || ""}/login`
        });
        if (error) {
          invitedUser = await findUserByEmail(supabaseAdmin, email);
          if (!invitedUser) {
            throw error;
          }
        } else {
          invitedUser = invited.user || null;
        }
      }

      if (!invitedUser?.id) {
        return new Response(JSON.stringify({ error: "No se pudo obtener el ID del usuario invitado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { error: upsertError } = await supabaseAdmin.from("tenant_users").upsert({
        tenant_id: tenantId,
        user_id: invitedUser.id,
        role: safeRole,
        status: "invited"
      });

      if (upsertError) {
        console.error("Error al asociar usuario con tenant:", upsertError);
        return new Response(JSON.stringify({ error: "Error al asociar usuario con tenant", details: upsertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const normalizedName = typeof fullName === "string" ? fullName.trim() : "";
      if (invitedUser?.id && normalizedName) {
        await supabaseAdmin.from("profiles").upsert({
          id: invitedUser.id,
          full_name: normalizedName
        });
      }

      return new Response(JSON.stringify({ user: invitedUser }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "list-users") {
      if (!tenantId) {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: tenantUsers } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id, role, status")
        .eq("tenant_id", tenantId);

      const userIds = (tenantUsers || []).map((tu) => tu.user_id);

      const users = await listAllUsers(supabaseAdmin);

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      const nameMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));

      const roleMap = new Map((tenantUsers || []).map((tu) => [tu.user_id, tu.role]));
      const statusMap = new Map((tenantUsers || []).map((tu) => [tu.user_id, tu.status || null]));
      const result = users
        .filter((user) => userIds.includes(user.id))
        .map((user) => ({
          id: user.id,
          email: user.email,
          full_name: nameMap.get(user.id) || null,
          created_at: user.created_at,
          role: roleMap.get(user.id) || "tenant_member",
          status: statusMap.get(user.id) || null,
          email_confirmed: !!user.confirmed_at,
          disabled: !!user.banned_until
        }));

      return new Response(JSON.stringify({ users: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "list-tenant-users") {
      const { tenantId: targetTenantId } = body;
      console.log('[list-tenant-users] Start - targetTenantId:', targetTenantId);

      if (!isPlatformAdmin) {
        console.log('[list-tenant-users] Forbidden - not platform admin');
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId) {
        console.log('[list-tenant-users] Missing tenantId');
        return new Response(JSON.stringify({ error: "Missing tenantId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: tenantUsers, error: tenantUsersError } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id, role, status")
        .eq("tenant_id", targetTenantId);

      console.log('[list-tenant-users] tenant_users query:', {
        count: tenantUsers?.length || 0,
        error: tenantUsersError,
        users: tenantUsers
      });

      const userIds = (tenantUsers || []).map((tu) => tu.user_id);
      if (userIds.length === 0) {
        console.log('[list-tenant-users] No users found in tenant_users table');
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      console.log('[list-tenant-users] Fetching auth users for IDs:', userIds);
      const users = await listAllUsers(supabaseAdmin);
      console.log('[list-tenant-users] Total auth users:', users.length);

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      console.log('[list-tenant-users] Profiles fetched:', profiles?.length || 0);

      const nameMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));

      const roleMap = new Map((tenantUsers || []).map((tu) => [tu.user_id, tu.role]));
      const statusMap = new Map((tenantUsers || []).map((tu) => [tu.user_id, tu.status || null]));
      const result = users
        .filter((user) => userIds.includes(user.id))
        .map((user) => ({
          id: user.id,
          email: user.email,
          full_name: nameMap.get(user.id) || null,
          created_at: user.created_at,
          role: roleMap.get(user.id) || "tenant_member",
          status: statusMap.get(user.id) || null,
          email_confirmed: !!user.confirmed_at,
          disabled: !!user.banned_until
        }));

      console.log('[list-tenant-users] Result:', { count: result.length, users: result });
      return new Response(JSON.stringify({ users: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "invite-tenant-user") {
      const { tenantId: targetTenantId, email, role, fullName } = body;
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId || !email) {
        return new Response(JSON.stringify({ error: "Missing data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const safeRole: Role = role === "tenant_admin" ? "tenant_admin" : "tenant_member";

      let invitedUser = await findUserByEmail(supabaseAdmin, email);

      if (!invitedUser) {
        const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${Deno.env.get("SITE_URL") || ""}/login`
        });
        if (error) {
          invitedUser = await findUserByEmail(supabaseAdmin, email);
          if (!invitedUser) {
            throw error;
          }
        } else {
          invitedUser = invited.user || null;
        }
      }

      if (!invitedUser?.id) {
        return new Response(JSON.stringify({ error: "No se pudo obtener el ID del usuario invitado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { error: upsertError } = await supabaseAdmin.from("tenant_users").upsert({
        tenant_id: targetTenantId,
        user_id: invitedUser.id,
        role: safeRole,
        status: "invited"
      });

      if (upsertError) {
        console.error("Error al asociar usuario con tenant:", upsertError);
        return new Response(JSON.stringify({ error: "Error al asociar usuario con tenant", details: upsertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const normalizedName = typeof fullName === "string" ? fullName.trim() : "";
      if (invitedUser?.id && normalizedName) {
        await supabaseAdmin.from("profiles").upsert({
          id: invitedUser.id,
          full_name: normalizedName
        });
      }

      return new Response(JSON.stringify({ user: invitedUser }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "list-unassigned-users") {
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const users = await listAllUsers(supabaseAdmin);
      const userIds = users.map((u) => u.id);

      const { data: memberships } = userIds.length > 0
        ? await supabaseAdmin
          .from("tenant_users")
          .select("user_id")
          .in("user_id", userIds)
        : { data: [] };
      const assignedUserIds = new Set((memberships || []).map((row) => row.user_id));

      const { data: profiles } = userIds.length > 0
        ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, role")
          .in("id", userIds)
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
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
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

    if (action === "tenant-account") {
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .select("id, name, slug, plan_id, billing_period_start, billing_period_end, customer_since, subscription_expires_at")
        .eq("id", tenantId)
        .single();

      if (tenantError && isMissingColumnError(tenantError)) {
        const fallbackTenant = await supabaseAdmin
          .from("tenants")
          .select("id, name, slug, plan_id, subscription_expires_at")
          .eq("id", tenantId)
          .single();
        tenant = fallbackTenant.data
          ? {
            ...fallbackTenant.data,
            billing_period_start: null,
            billing_period_end: null,
            customer_since: null
          }
          : null;
        tenantError = fallbackTenant.error;
      }

      if (tenantError) throw tenantError;

      let plan = null;
      if (tenant?.plan_id) {
        const { data: planData } = await supabaseAdmin
          .from("plans")
          .select("id, name, docs_limit_month, mrr_cents")
          .eq("id", tenant.plan_id)
          .single();
        plan = planData || null;
      }

      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartIso = monthStart.toISOString();

      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("id")
        .eq("tenant_id", tenantId)
        .gte("created_at", monthStartIso)
        .not("documenso_envelope_id", "is", null);

      const docsUsed = (docs || []).length;
      const docsLimit = plan?.docs_limit_month ?? 0;
      const docsAvailable = docsLimit > 0 ? Math.max(docsLimit - docsUsed, 0) : null;

      return new Response(JSON.stringify({
        tenant,
        plan,
        metrics: {
          docs_used: docsUsed,
          docs_limit: docsLimit,
          docs_available: docsAvailable
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "update-role") {
      const { userId, role } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const safeRole: Role = role === "tenant_admin" ? "tenant_admin" : "tenant_member";

      await supabaseAdmin.from("tenant_users").upsert({
        tenant_id: tenantId,
        user_id: userId,
        role: safeRole
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "resend-invite") {
      const { userId, email } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const targetId = userId || null;
      let targetEmail = email || null;
      if (!targetId && !targetEmail) {
        return new Response(JSON.stringify({ error: "Missing userId or email" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (targetId) {
        const { data: targetMembership } = await supabaseAdmin
          .from("tenant_users")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("user_id", targetId)
          .single();
        if (!targetMembership?.user_id) {
          return new Response(JSON.stringify({ error: "User not in tenant" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      if (targetEmail && !targetId) {
        const foundUser = await findUserByEmail(supabaseAdmin, targetEmail);
        if (foundUser?.id) {
          const { data: targetMembership } = await supabaseAdmin
            .from("tenant_users")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .eq("user_id", foundUser.id)
            .single();
          if (!targetMembership?.user_id) {
            return new Response(JSON.stringify({ error: "User not in tenant" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }
      }

      if (!targetEmail && targetId) {
        const { data: targetUser, error } = await supabaseAdmin.auth.admin.getUserById(targetId);
        if (error) throw error;
        targetEmail = targetUser?.user?.email || null;
      }

      if (!targetEmail) {
        return new Response(JSON.stringify({ error: "An email address is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: invited, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(targetEmail, {
        redirectTo: `${Deno.env.get("SITE_URL") || ""}/login`
      });
      if (error) throw error;

      return new Response(JSON.stringify({ user: invited.user || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "set-user-status") {
      const { userId, disabled } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: targetMembership } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .single();

      if (!targetMembership?.user_id) {
        return new Response(JSON.stringify({ error: "User not in tenant" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const bannedUntil = disabled ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString() : null;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        banned_until: bannedUntil
      });
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "delete-tenant") {
      const { tenantId: targetTenantId, password, deleteUsers, reassignTenantId, reassignRole } = body;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("supabase_anon_key");
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId || !password) {
        return new Response(JSON.stringify({ error: "Missing data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!anonKey) {
        return new Response(JSON.stringify({ error: "Missing anon key" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!authEmail) {
        return new Response(JSON.stringify({ error: "User email not found" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const supabaseAuth = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      });
      const { error: authCheckError } = await supabaseAuth.auth.signInWithPassword({
        email: authEmail,
        password
      });
      if (authCheckError) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: tenantMembers } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", targetTenantId);
      const tenantUserIds = Array.from(new Set((tenantMembers || []).map((row) => row.user_id).filter(Boolean)));

      const { data: otherMemberships } = tenantUserIds.length > 0
        ? await supabaseAdmin
          .from("tenant_users")
          .select("user_id, tenant_id")
          .in("user_id", tenantUserIds)
          .neq("tenant_id", targetTenantId)
        : { data: [] };
      const userIdsWithOtherTenants = new Set((otherMemberships || []).map((row) => row.user_id));

      const reassignTargetId = typeof reassignTenantId === "string" && reassignTenantId.length > 0 && reassignTenantId !== targetTenantId
        ? reassignTenantId
        : null;
      const safeReassignRole: Role = reassignRole === "tenant_admin" ? "tenant_admin" : "tenant_member";

      const reassignableUserIds = tenantUserIds.filter((userId) => !userIdsWithOtherTenants.has(userId));

      let reassignedCount = 0;
      if (reassignTargetId && reassignableUserIds.length > 0) {
        const { data: existingReassign } = await supabaseAdmin
          .from("tenant_users")
          .select("user_id")
          .eq("tenant_id", reassignTargetId)
          .in("user_id", reassignableUserIds);
        const alreadyInTarget = new Set((existingReassign || []).map((row) => row.user_id));

        const toUpdate = reassignableUserIds.filter((userId) => !alreadyInTarget.has(userId));
        const toDeleteOnly = reassignableUserIds.filter((userId) => alreadyInTarget.has(userId));

        if (toUpdate.length > 0) {
          await supabaseAdmin
            .from("tenant_users")
            .update({ tenant_id: reassignTargetId, role: safeReassignRole, status: "active" })
            .eq("tenant_id", targetTenantId)
            .in("user_id", toUpdate);
          reassignedCount += toUpdate.length;
        }
        if (toDeleteOnly.length > 0) {
          await supabaseAdmin
            .from("tenant_users")
            .delete()
            .eq("tenant_id", targetTenantId)
            .in("user_id", toDeleteOnly);
          reassignedCount += toDeleteOnly.length;
        }
      }

      const deletableUserIds = deleteUsers
        ? reassignableUserIds.filter((userId) => !reassignTargetId)
        : [];

      if (deletableUserIds.length > 0) {
        await supabaseAdmin
          .from("profiles")
          .delete()
          .in("id", deletableUserIds);
        for (const userId of deletableUserIds) {
          await supabaseAdmin.auth.admin.deleteUser(userId);
        }
      }

      const { data: documents } = await supabaseAdmin
        .from("documents")
        .select("id, file_url")
        .eq("tenant_id", targetTenantId);
      const documentIds = (documents || []).map((doc) => doc.id);
      const filePaths = (documents || []).map((doc) => doc.file_url).filter(Boolean);

      const { data: signers } = documentIds.length > 0
        ? await supabaseAdmin
          .from("document_signers")
          .select("id")
          .in("document_id", documentIds)
        : { data: [] };
      const signerIds = (signers || []).map((signer) => signer.id);

      const { data: verificationAttempts } = signerIds.length > 0
        ? await supabaseAdmin
          .from("verification_attempts")
          .select("id")
          .in("signer_id", signerIds)
        : { data: [] };
      const verificationIds = (verificationAttempts || []).map((attempt) => attempt.id);

      if (documentIds.length > 0) {
        await supabaseAdmin.from("audit_log").delete().in("document_id", documentIds);
      }
      if (signerIds.length > 0) {
        await supabaseAdmin.from("audit_log").delete().in("signer_id", signerIds);
      }
      if (verificationIds.length > 0) {
        await supabaseAdmin.from("audit_log").delete().in("verification_attempt_id", verificationIds);
      }

      if (verificationIds.length > 0) {
        await supabaseAdmin.from("verification_attempts").delete().in("id", verificationIds);
      }
      if (signerIds.length > 0) {
        await supabaseAdmin.from("signer_fields").delete().in("signer_id", signerIds);
        await supabaseAdmin.from("document_signers").delete().in("id", signerIds);
      }
      if (documentIds.length > 0) {
        await supabaseAdmin.from("documents").delete().in("id", documentIds);
      }

      if (filePaths.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < filePaths.length; i += chunkSize) {
          const chunk = filePaths.slice(i, i + chunkSize);
          await supabaseAdmin.storage.from("documents").remove(chunk);
        }
      }

      await supabaseAdmin.from("folders").delete().eq("tenant_id", targetTenantId);
      await supabaseAdmin.from("tenant_integrations").delete().eq("tenant_id", targetTenantId);
      await supabaseAdmin.from("tenant_invitations").delete().eq("tenant_id", targetTenantId);
      await supabaseAdmin.from("transactions").delete().eq("tenant_id", targetTenantId);
      await supabaseAdmin.from("tenant_users").delete().eq("tenant_id", targetTenantId);

      const { error: deleteTenantError } = await supabaseAdmin
        .from("tenants")
        .delete()
        .eq("id", targetTenantId);

      if (deleteTenantError) throw deleteTenantError;

      return new Response(JSON.stringify({
        success: true,
        reassigned_count: reassignedCount,
        deleted_users_count: deletableUserIds.length,
        skipped_multi_tenant_count: userIdsWithOtherTenants.size
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "remove-user-from-tenant") {
      const { userId } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!userId) {
        return new Response(JSON.stringify({ error: "Missing userId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Prevent removing yourself
      if (userId === authUserId) {
        return new Response(JSON.stringify({ error: "No puedes eliminarte a ti mismo del tenant" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Verify user is in this tenant
      const { data: targetMembership } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .single();

      if (!targetMembership?.user_id) {
        return new Response(JSON.stringify({ error: "User not in tenant" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Remove user from tenant
      const { error: deleteError } = await supabaseAdmin
        .from("tenant_users")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);

      if (deleteError) {
        console.error("Error removing user from tenant:", deleteError);
        return new Response(JSON.stringify({ error: "Error al eliminar usuario del tenant", details: deleteError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: true, message: "Usuario eliminado del tenant" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "remove-tenant-user") {
      const { tenantId: targetTenantId, userId } = body;
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!targetTenantId || !userId) {
        return new Response(JSON.stringify({ error: "Missing tenantId or userId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: targetMembership } = await supabaseAdmin
        .from("tenant_users")
        .select("tenant_id, user_id")
        .eq("tenant_id", targetTenantId)
        .eq("user_id", userId)
        .single();

      if (!targetMembership?.user_id) {
        return new Response(JSON.stringify({ error: "User not in tenant" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { error: deleteError } = await supabaseAdmin
        .from("tenant_users")
        .delete()
        .eq("tenant_id", targetTenantId)
        .eq("user_id", userId);

      if (deleteError) {
        console.error("Error removing tenant user:", deleteError);
        return new Response(JSON.stringify({ error: "Error al desvincular usuario del tenant", details: deleteError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ success: true, message: "Usuario desvinculado del tenant" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "update-profile") {
      const { userId, fullName } = body;
      if (!tenantId) {
        return new Response(JSON.stringify({ error: "Tenant not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!isTenantAdmin && !isPlatformAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: targetMembership } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .single();

      if (!targetMembership?.user_id) {
        return new Response(JSON.stringify({ error: "User not in tenant" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const normalizedName = typeof fullName === "string" ? fullName.trim() : "";
      await supabaseAdmin.from("profiles").upsert({
        id: userId,
        full_name: normalizedName
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (action === "reset-password") {
      const { userId, password } = body;
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password
      });
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      error: "Invalid action",
      details: rawAction ?? "missing_action"
    }), {
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
