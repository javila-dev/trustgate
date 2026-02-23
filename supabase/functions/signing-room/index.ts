import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;
const VERIFICATION_TTL_MINUTES = 10;
const VERIFICATION_TTL_MS = VERIFICATION_TTL_MINUTES * 60 * 1000;

const jsonResponse = (payload: Json, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const requireSigningToken = (signingToken?: string | null) => {
  if (!signingToken || typeof signingToken !== "string") {
    return jsonResponse({ error: "Missing signing token" }, 400);
  }
  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const signingToken = body?.signingToken as string | undefined;
    const signerId = body?.signerId as string | undefined;
    const deviceSessionToken = body?.deviceSessionToken as string | undefined;

    if (!action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    const tokenError = requireSigningToken(signingToken);
    if (tokenError) return tokenError;

    const { data: signerData, error: signerError } = await supabase
      .from("document_signers")
      .select("*, document:documents(*)")
      .eq("signing_token", signingToken)
      .single();

    if (signerError || !signerData) {
      return jsonResponse({ error: "Invalid signing token" }, 401);
    }

    if (signerId && signerId !== signerData.id) {
      return jsonResponse({ error: "Signer mismatch" }, 403);
    }

    const getSigningOrderBlock = async () => {
      const currentOrder = Number(signerData.signing_order || 1);
      if (!signerData.document_id || currentOrder <= 1 || signerData.status === "SIGNED") {
        return { blocked: false, pending: [] as Array<Record<string, unknown>> };
      }

      const { data: pending } = await supabase
        .from("document_signers")
        .select("id, name, email, signing_order, status")
        .eq("document_id", signerData.document_id)
        .lt("signing_order", currentOrder)
        .neq("status", "SIGNED");

      const pendingList = pending || [];
      return {
        blocked: pendingList.length > 0,
        pending: pendingList,
      };
    };

    if (action === "get-signer") {
      const tenantId = signerData.document?.tenant_id;
      let tenantName: string | null = null;
      let documensoBaseUrl: string | null = null;

      if (tenantId) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tenantId)
          .single();
        tenantName = tenant?.name ?? null;

        const { data: integration } = await supabase
          .from("tenant_integrations")
          .select("config")
          .eq("tenant_id", tenantId)
          .eq("integration_type", "documenso")
          .eq("is_enabled", true)
          .single();
        documensoBaseUrl = integration?.config?.base_url ?? null;
      }

      const signingOrder = await getSigningOrderBlock();

      return jsonResponse({
        signer: signerData,
        document: signerData.document,
        tenantName,
        documensoBaseUrl,
        signingOrder,
      });
    }

    if (action === "get-latest-attempt") {
      const { data: attempt } = await supabase
        .from("verification_attempts")
        .select("*")
        .eq("signer_id", signerData.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      return jsonResponse({ attempt: attempt || null });
    }

    if (action === "expire-attempt") {
      const attemptId = body?.attemptId as string | undefined;
      if (!attemptId) {
        return jsonResponse({ error: "Missing attemptId" }, 400);
      }

      const { error: updateError } = await supabase
        .from("verification_attempts")
        .update({
          status: "EXPIRED",
          completed_at: new Date().toISOString(),
        })
        .eq("id", attemptId)
        .eq("signer_id", signerData.id);

      if (updateError) {
        return jsonResponse({ error: updateError.message }, 400);
      }

      return jsonResponse({ ok: true });
    }

    if (action === "set-signer-status") {
      const status = body?.status as string | undefined;
      const signedAt = body?.signedAt as string | undefined;
      if (!status) {
        return jsonResponse({ error: "Missing status" }, 400);
      }

      const payload: Record<string, unknown> = { status };
      if (signedAt) {
        payload.signed_at = signedAt;
      }

      const { error: updateError } = await supabase
        .from("document_signers")
        .update(payload)
        .eq("id", signerData.id);

      if (updateError) {
        return jsonResponse({ error: updateError.message }, 400);
      }

      return jsonResponse({ ok: true });
    }

    if (action === "bind-device-session") {
      if (!deviceSessionToken || typeof deviceSessionToken !== "string") {
        return jsonResponse({ error: "Missing deviceSessionToken" }, 400);
      }

      if (
        signerData.device_session_token &&
        signerData.device_session_token !== deviceSessionToken
      ) {
        return jsonResponse({
          error: "Device session already bound to a different token",
        }, 409);
      }

      const { error: bindError } = await supabase
        .from("document_signers")
        .update({ device_session_token: deviceSessionToken })
        .eq("id", signerData.id);

      if (bindError) {
        return jsonResponse({ error: bindError.message }, 400);
      }

      return jsonResponse({ ok: true, deviceSessionToken });
    }

    if (action === "reset-verification") {
      const now = new Date().toISOString();
      const { error: resetError } = await supabase
        .from("document_signers")
        .update({
          status: "PENDING",
          verified_at: null,
          device_session_token: null,
        })
        .eq("id", signerData.id);

      if (resetError) {
        return jsonResponse({ error: resetError.message }, 400);
      }

      // Expire any non-terminal verification attempts tied to this signer.
      await supabase
        .from("verification_attempts")
        .update({
          status: "EXPIRED",
          completed_at: now,
        })
        .eq("signer_id", signerData.id)
        .in("status", ["PENDING", "IN_PROGRESS", "IN_REVIEW", "REVIEW_APPROVED"]);

      return jsonResponse({ ok: true });
    }

    if (action === "mark-signed") {
      const requiresVerification =
        Boolean(signerData.document?.requires_identity_verification) &&
        Boolean(signerData.requires_verification);

      if (requiresVerification) {
        if (!signerData.verified_at) {
          return jsonResponse({ error: "Verification is required before signing" }, 403);
        }

        const verifiedAt = new Date(signerData.verified_at).getTime();
        if (!Number.isFinite(verifiedAt)) {
          return jsonResponse({ error: "Invalid verification timestamp" }, 400);
        }

        if (Date.now() - verifiedAt > VERIFICATION_TTL_MS) {
          return jsonResponse({
            error: "Verification session expired. Restart identity verification.",
          }, 403);
        }

        if (!deviceSessionToken || typeof deviceSessionToken !== "string") {
          return jsonResponse({ error: "Missing deviceSessionToken" }, 400);
        }

        if (!signerData.device_session_token || signerData.device_session_token !== deviceSessionToken) {
          return jsonResponse({
            error: "This signing session is not bound to the current browser. Restart verification.",
          }, 403);
        }
      }

      const signingOrder = await getSigningOrderBlock();
      if (signingOrder.blocked) {
        return jsonResponse({
          error: "Signing order not satisfied",
          signingOrder,
        }, 409);
      }

      const signedAt = new Date().toISOString();
      const { error: signerUpdateError } = await supabase
        .from("document_signers")
        .update({ status: "SIGNED", signed_at: signedAt })
        .eq("id", signerData.id);

      if (signerUpdateError) {
        return jsonResponse({ error: signerUpdateError.message }, 400);
      }

      const { data: signersData, error: signersError } = await supabase
        .from("document_signers")
        .select("status")
        .eq("document_id", signerData.document_id);

      if (signersError) {
        return jsonResponse({ error: signersError.message }, 400);
      }

      const allSigned = (signersData || []).every((s) => s.status === "SIGNED");
      const nextStatus = allSigned ? "COMPLETED" : "IN_PROGRESS";

      const { error: docUpdateError } = await supabase
        .from("documents")
        .update({ status: nextStatus })
        .eq("id", signerData.document_id);

      if (docUpdateError) {
        return jsonResponse({ error: docUpdateError.message }, 400);
      }

      return jsonResponse({ ok: true, documentStatus: nextStatus, signedAt });
    }

    if (action === "redeem-continuity-token") {
      const token = body?.token as string | undefined;
      if (!token) {
        return jsonResponse({ error: "Missing token" }, 400);
      }

      // Find verification attempt with this continuity token
      const { data: attempt, error: attemptError } = await supabase
        .from("verification_attempts")
        .select("*")
        .eq("continuity_token", token)
        .eq("signer_id", signerData.id)
        .single();

      if (attemptError || !attempt) {
        return jsonResponse({ error: "Token inválido" }, 400);
      }

      // Check if token was already used
      if (attempt.continuity_token_used_at) {
        return jsonResponse({ error: "Token ya utilizado" }, 400);
      }

      // Check if token has expired
      if (new Date(attempt.continuity_token_expires_at) < new Date()) {
        return jsonResponse({ error: "Token expirado" }, 400);
      }

      // Check if verification was approved
      if (attempt.status !== "REVIEW_APPROVED") {
        return jsonResponse({
          error: "Verificación aún no aprobada",
          status: attempt.status,
        }, 400);
      }

      // Redeem the token: mark as used and set verified_at (starts TTL)
      const now = new Date().toISOString();

      const { error: updateAttemptError } = await supabase
        .from("verification_attempts")
        .update({
          continuity_token_used_at: now,
          status: "SUCCESS",
        })
        .eq("id", attempt.id);

      if (updateAttemptError) {
        return jsonResponse({ error: updateAttemptError.message }, 400);
      }

      // Update signer to VERIFIED with verified_at (this starts the 10min TTL)
      const { error: updateSignerError } = await supabase
        .from("document_signers")
        .update({
          status: "VERIFIED",
          verified_at: now,
        })
        .eq("id", signerData.id);

      if (updateSignerError) {
        return jsonResponse({ error: updateSignerError.message }, 400);
      }

      // Log audit event
      await supabase.from("audit_log").insert({
        document_id: signerData.document_id,
        signer_id: signerData.id,
        verification_attempt_id: attempt.id,
        event_type: "continuity_token_redeemed",
        description: `Token de continuidad canjeado - TTL de firma iniciado`,
        actor_type: "signer",
        event_data: {
          token_redeemed_at: now,
          verified_at: now,
        },
      });

      return jsonResponse({
        ok: true,
        verified_at: now,
        message: "Token canjeado exitosamente. Tienes 10 minutos para firmar.",
      });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("signing-room error:", error);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
