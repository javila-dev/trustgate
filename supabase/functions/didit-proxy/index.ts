import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, signingToken, signerId } = body;

    let tenantId: string | null = null;
    let tokenError = false;

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (token) {
      const { data: authUser, error: authError } = await supabase.auth.getUser(token);
      if (!authError && authUser?.user) {
        const { data: tenantUser } = await supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('user_id', authUser.user.id)
          .single();
        tenantId = tenantUser?.tenant_id ?? null;
      } else {
        tokenError = true;
      }
    }

    let signerData: { id: string; name: string; email: string; document_id: string } | null = null;

    if (!tenantId && signingToken && signerId) {
      const { data: signer } = await supabase
        .from('document_signers')
        .select('id, signing_token, name, email, document_id, document:documents(tenant_id)')
        .eq('id', signerId)
        .single();

      if (!signer || signer.signing_token !== signingToken) {
        return new Response(
          JSON.stringify({ error: 'Invalid signer token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      tenantId = signer.document?.tenant_id || null;
      signerData = {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        document_id: signer.document_id
      };
    }

    if (!tenantId) {
      if (tokenError) {
        return new Response(
          JSON.stringify({ error: 'Invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Tenant not found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: integration } = await supabase
      .from('tenant_integrations')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('integration_type', 'didit')
      .single();

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: 'Didit not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { api_key, workflow_id } = integration.config;

    if (!api_key || !workflow_id) {
      return new Response(
        JSON.stringify({ error: 'Missing api_key or workflow_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create-session') {
      const { signerId, email, name, callbackUrl, expectedDetails, language } = body;

      const providedFirstName =
        expectedDetails?.first_name ||
        expectedDetails?.firstName ||
        '';
      const providedLastName =
        expectedDetails?.last_name ||
        expectedDetails?.lastName ||
        '';

      // Parse name into first_name and last_name if not explicitly provided
      const nameParts = (name || '').trim().split(/\s+/);
      const parsedFirstName = nameParts[0] || '';
      const parsedLastName = nameParts.slice(1).join(' ') || '';

      const firstName = (providedFirstName || parsedFirstName || '').trim();
      const lastName = (providedLastName || parsedLastName || '').trim();

      // Build request body with contact_details and expected_details
      const requestBody: Record<string, unknown> = {
        workflow_id,
        callback: callbackUrl,
        vendor_data: signerId
      };

      if (language) {
        requestBody.language = language;
      }

      // Add contact_details if email provided
      if (email) {
        requestBody.contact_details = {
          email: email
        };
      }

      // Add expected_details only when both names are present.
      // Some Didit setups reject blank last_name values.
      if (firstName && lastName) {
        requestBody.expected_details = {
          first_name: firstName,
          last_name: lastName
        };
      } else if (firstName || lastName) {
        console.warn('Skipping expected_details because first_name/last_name is incomplete', {
          firstName,
          lastName
        });
      }

      console.log('Creating Didit session with:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('https://verification.didit.me/v2/session/', {
        method: 'POST',
        headers: {
          'x-api-key': api_key,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const responseText = await response.text();
      console.log('Didit response:', response.status, responseText);

      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: responseText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = JSON.parse(responseText);

      // Save verification attempt to DB
      console.log('Attempting to save verification attempt for signer:', signerId, 'session:', data.session_id);
      const { error: insertError } = await supabase.from('verification_attempts').insert({
        signer_id: signerId,
        didit_session_id: data.session_id,
        status: 'IN_PROGRESS',
        didit_verification_url: data.url,
        verification_url: data.url
      });

      if (insertError) {
        console.error('CRITICAL: Failed to save verification attempt:', {
          error: insertError,
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          signerId,
          sessionId: data.session_id
        });

        // Attempt to delete the Didit session to avoid orphaned sessions
        try {
          await fetch(`https://verification.didit.me/v1/session/${data.session_id}/delete/`, {
            method: 'DELETE',
            headers: {
              'x-api-key': api_key,
              'Accept': 'application/json'
            }
          });
          console.log('Cleaned up Didit session after DB failure:', data.session_id);
        } catch (cleanupError) {
          console.error('Failed to cleanup Didit session:', cleanupError);
        }

        // Return error to client
        return new Response(
          JSON.stringify({
            error: 'Failed to save verification attempt to database',
            details: insertError.message,
            code: insertError.code
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Successfully saved verification attempt:', data.session_id);

      // Log audit event for verification started
      let auditSignerData = signerData;
      if (!auditSignerData && signerId) {
        const { data: signer } = await supabase
          .from('document_signers')
          .select('id, name, email, document_id')
          .eq('id', signerId)
          .single();
        if (signer) {
          auditSignerData = signer;
        }
      }

      if (auditSignerData) {
        const { error: auditError } = await supabase.from('audit_log').insert({
          document_id: auditSignerData.document_id,
          signer_id: signerId,
          event_type: 'identity_verification_started',
          description: `Verificación de identidad iniciada para ${auditSignerData.name} (${auditSignerData.email})`,
          actor_type: 'signer',
          event_data: {
            session_id: data.session_id,
            verification_url: data.url
          }
        });

        if (auditError) {
          console.error('Error saving audit log:', auditError);
        }
      }

      return new Response(
        JSON.stringify({
          sessionId: data.session_id,
          verificationUrl: data.url
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get-status') {
      const { sessionId } = body;
      if (!token && signerId) {
        const { data: attempt } = await supabase
          .from('verification_attempts')
          .select('id')
          .eq('signer_id', signerId)
          .eq('didit_session_id', sessionId)
          .single();
        if (!attempt) {
          return new Response(
            JSON.stringify({ error: 'Session not found for signer' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const response = await fetch(`https://verification.didit.me/v2/session/${sessionId}/`, {
        method: 'GET',
        headers: {
          'x-api-key': api_key,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: errorText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      return new Response(
        JSON.stringify(data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get-decision') {
      const { sessionId } = body;
      if (!token && signerId) {
        const { data: attempt } = await supabase
          .from('verification_attempts')
          .select('id')
          .eq('signer_id', signerId)
          .eq('didit_session_id', sessionId)
          .single();
        if (!attempt) {
          return new Response(
            JSON.stringify({ error: 'Session not found for signer' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const response = await fetch(`https://verification.didit.me/v3/session/${sessionId}/decision/`, {
        method: 'GET',
        headers: {
          'x-api-key': api_key,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: errorText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      return new Response(
        JSON.stringify(data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get-session-detail') {
      const { sessionId } = body;
      if (!token && signerId) {
        const { data: attempt } = await supabase
          .from('verification_attempts')
          .select('id')
          .eq('signer_id', signerId)
          .eq('didit_session_id', sessionId)
          .single();
        if (!attempt) {
          return new Response(
            JSON.stringify({ error: 'Session not found for signer' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const decisionUrls = [
        `https://verification.didit.me/v3/session/${sessionId}/decision/`,
        `https://verification.didit.me/v3/session/${sessionId}/decision`
      ];

      for (const url of decisionUrls) {
        const decisionResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': api_key,
            'Accept': 'application/json'
          }
        });
        if (decisionResponse.ok) {
          const decisionData = await decisionResponse.json();
          return new Response(
            JSON.stringify(decisionData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const detailUrls = [
        `https://verification.didit.me/v3/session/${sessionId}`,
        `https://verification.didit.me/v3/session/${sessionId}/`,
        `https://verification.didit.me/v2/session/${sessionId}`,
        `https://verification.didit.me/v2/session/${sessionId}/`
      ];

      let detailData: unknown = null;
      let lastStatus = 500;
      let lastErrorText = 'Could not fetch session detail';

      for (const url of detailUrls) {
        const detailResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': api_key,
            'Accept': 'application/json'
          }
        });

        if (detailResponse.ok) {
          detailData = await detailResponse.json();
          break;
        }

        lastStatus = detailResponse.status;
        lastErrorText = await detailResponse.text();
      }

      if (!detailData) {
        return new Response(
          JSON.stringify({ error: lastErrorText }),
          { status: lastStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(detailData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update-status') {
      const { sessionId, newStatus, comment } = body;

      if (!sessionId || !newStatus) {
        return new Response(
          JSON.stringify({ error: 'Missing sessionId or newStatus' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch(`https://verification.didit.me/v3/session/${sessionId}/update-status`, {
        method: 'PATCH',
        headers: {
          'x-api-key': api_key,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          new_status: newStatus,
          comment: comment || ''
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: responseText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        responseText || JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'generate-pdf') {
      const { sessionId } = body;

      const response = await fetch(`https://verification.didit.me/v3/session/${sessionId}/generate-pdf`, {
        method: 'GET',
        headers: {
          'x-api-key': api_key
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: errorText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pdfBuffer = await response.arrayBuffer();
      return new Response(pdfBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="didit-verification.pdf"'
        }
      });
    }

    if (action === 'delete-session') {
      const { sessionId } = body;

      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Missing sessionId' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await fetch(`https://verification.didit.me/v1/session/${sessionId}/delete/`, {
        method: 'DELETE',
        headers: {
          'x-api-key': api_key,
          'Accept': 'application/json'
        }
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        return new Response(
          JSON.stringify({ error: errorText }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ deleted: response.status !== 404 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
