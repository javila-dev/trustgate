import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
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
    if (authError || !authUserData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUserData.user.id)
      .single();

    if (profile?.role !== "platform_admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const rawAction = typeof body?.action === "string" ? body.action.trim() : "";
    const action = rawAction
      ? rawAction
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .replace(/_/g, "-")
          .toLowerCase()
      : "";

    if (action !== "update-plan") {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
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

    const cleanName = String(name || "").trim();
    if (!cleanName) {
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
        name: cleanName,
        docs_limit_month: parsedLimit,
        mrr_cents: parsedMrr
      })
      .eq("id", planId)
      .select("id, name, docs_limit_month, mrr_cents, created_at")
      .single();

    if (updateError) {
      throw updateError;
    }

    return new Response(JSON.stringify({ plan: updatedPlan }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error)?.message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
