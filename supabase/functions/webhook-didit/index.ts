import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Send email notification via Resend
 */
async function sendEmail(options: {
  to: string
  subject: string
  html: string
  from?: string
}) {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not configured - skipping email notification')
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const fromEmail = options.from || Deno.env.get('EMAIL_FROM') || 'noreply@resend.dev'

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error('Resend API error:', errorData)
      return { success: false, error: errorData }
    }

    const data = await response.json()
    console.log('Email sent successfully:', data.id)
    return { success: true, id: data.id }
  } catch (error) {
    console.error('Error sending email:', error)
    return { success: false, error: error.message }
  }
}

async function getCreatorContact(supabase: any, documentId: string) {
  const { data: document } = await supabase
    .from('documents')
    .select('id, file_name, created_by')
    .eq('id', documentId)
    .single()

  if (!document?.created_by) {
    return { document, creator: null }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', document.created_by)
    .single()

  let email = profile?.email || null
  let name = profile?.full_name || null

  if (!email) {
    const { data: user } = await supabase.auth.admin.getUserById(document.created_by)
    email = user?.user?.email || null
    if (!name) {
      name = user?.user?.user_metadata?.full_name || null
    }
  }

  return {
    document,
    creator: email ? { email, name } : null
  }
}

async function sendCreatorVerificationEmail(params: {
  to: string
  creatorName?: string | null
  signerName?: string | null
  signerEmail?: string | null
  documentTitle?: string | null
  statusLabel: string
  detail?: string | null
}) {
  const subject = `${params.statusLabel}${params.documentTitle ? `: ${params.documentTitle}` : ''}`
  const html = `
    <div style="font-family: Arial, sans-serif; color:#0f172a; line-height:1.5; background:#f8fafc; padding:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0; overflow:hidden;">
        <tr>
          <td style="background:#0f172a; padding:20px 24px; text-align:center;">
            <img src="https://trustgate.2asoft.tech/logo.png" alt="TrustGate" style="height:28px; display:inline-block; vertical-align:middle;" />
            <div style="color:#e2e8f0; font-size:12px; letter-spacing:0.2em; text-transform:uppercase; font-weight:600; margin-top:6px;">
              TrustGate
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <h2 style="margin:0 0 8px; font-size:20px;">${params.statusLabel}</h2>
            <p style="margin:0 0 16px; color:#475569;">
              ${params.creatorName ? `Hola <strong>${params.creatorName}</strong>,` : 'Hola,'} hay una actualización de identidad.
            </p>
            ${params.documentTitle ? `<p style="margin:0 0 8px; color:#475569;">Documento: <strong>${params.documentTitle}</strong></p>` : ''}
            <p style="margin:0; color:#475569;">
              Firmante: <strong>${params.signerName || 'Sin nombre'}</strong>${params.signerEmail ? ` (${params.signerEmail})` : ''}
            </p>
            ${params.detail ? `<p style="margin:12px 0 0; color:#64748b; font-size:13px;">${params.detail}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc; padding:16px 24px; font-size:12px; color:#94a3b8;">
            TrustGate
          </td>
        </tr>
      </table>
    </div>
  `

  return await sendEmail({ to: params.to, subject, html })
}

async function hasAuditEvent(supabase: any, documentId: string, eventType: string, signerId?: string | null) {
  let query = supabase
    .from('audit_log')
    .select('id')
    .eq('document_id', documentId)
    .eq('event_type', eventType)
    .limit(1)

  if (signerId) {
    query = query.eq('signer_id', signerId)
  }

  const { data } = await query
  return (data || []).length > 0
}

/**
 * Send review approved notification email with continuity link
 */
async function sendReviewApprovedEmail(signer: {
  name: string
  email: string
  signing_token: string
}, continuityToken: string, documentTitle?: string) {
  const appBaseUrl = Deno.env.get('APP_BASE_URL') || 'https://app.example.com'
  const continuityLink = `${appBaseUrl}/sign/${signer.signing_token}?continuity_token=${continuityToken}`

  const html = `
    <div style="font-family: Arial, sans-serif; color:#0f172a; line-height:1.5; background:#f8fafc; padding:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0; overflow:hidden;">
        <tr>
          <td style="background:#0f172a; padding:20px 24px; text-align:center;">
            <img src="https://trustgate.2asoft.tech/logo.png" alt="TrustGate" style="height:28px; display:inline-block; vertical-align:middle;" />
            <div style="color:#e2e8f0; font-size:12px; letter-spacing:0.2em; text-transform:uppercase; font-weight:600; margin-top:6px;">
              TrustGate
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <h2 style="margin:0 0 8px; font-size:20px;">Verificación aprobada</h2>
            <p style="margin:0 0 16px; color:#475569;">
              Hola <strong>${signer.name}</strong>, tu verificación de identidad fue aprobada exitosamente.
            </p>

            ${documentTitle ? `<p style="margin:0 0 16px; color:#475569;">Documento: <strong>${documentTitle}</strong></p>` : ''}

            <div style="margin:20px 0; text-align:center;">
              <a href="${continuityLink}"
                 style="background:#10b981; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:10px; display:inline-block; font-weight:600;">
                Continuar con la firma
              </a>
            </div>

            <p style="margin:0 0 8px; font-size:13px; color:#64748b;">
              Importante: una vez que hagas clic tendrás <strong>5 minutos</strong> para completar la firma. Este enlace expira en 48 horas.
            </p>
            <p style="margin:0; font-size:12px; color:#94a3b8; word-break: break-all;">
              Si el botón no funciona, copia y pega este enlace: ${continuityLink}
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc; padding:16px 24px; font-size:12px; color:#94a3b8;">
            TrustGate · ${appBaseUrl}
          </td>
        </tr>
      </table>
    </div>
  `

  return await sendEmail({
    to: signer.email,
    subject: `✓ Verificación aprobada - Continúa con tu firma${documentTitle ? `: ${documentTitle}` : ''}`,
    html,
  })
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse webhook payload (need raw body for signature validation)
    const rawBody = await req.text()
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch (parseError) {
      console.error('Invalid JSON payload')
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Received Didit webhook:', JSON.stringify(payload, null, 2))

    // Validate webhook signature (Didit: X-Signature-V2 recommended, then X-Signature-Simple, then X-Signature)
    const signatureV2 = req.headers.get('x-signature-v2')
    const signatureSimple = req.headers.get('x-signature-simple')
    const signature = req.headers.get('x-signature')
    const timestampHeader = req.headers.get('x-timestamp')

    const normalizeStatus = (value: unknown): string =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_\s-]+/g, '_')

    const normalizeEventKey = (value: unknown): string =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')

    const { data: integration } = await supabase
      .from('tenant_integrations')
      .select('config')
      .eq('integration_type', 'didit')
      .eq('is_enabled', true)
      .single()

    if (integration?.config?.webhook_secret) {
      const webhookSecret = integration.config.webhook_secret

      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )

      const toHex = (buffer: ArrayBuffer) =>
        Array.from(new Uint8Array(buffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')

      const sortKeysDeep = (value: any): any => {
        if (Array.isArray(value)) {
          return value.map(sortKeysDeep)
        }
        if (value && typeof value === 'object') {
          return Object.keys(value)
            .sort()
            .reduce((acc: any, key) => {
              acc[key] = sortKeysDeep(value[key])
              return acc
            }, {})
        }
        return value
      }

      const verifySignature = async () => {
        if (signatureV2) {
          const canonical = JSON.stringify(sortKeysDeep(payload))
          const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical))
          const expected = toHex(sig)
          if (expected === signatureV2) return true
        }

        if (signatureSimple && timestampHeader) {
          const sessionIdSimple =
            payload?.session_id || payload?.data?.session_id || payload?.data?.sessionId
          const statusSimple = payload?.status || payload?.data?.status
          const webhookTypeSimple = payload?.webhook_type || payload?.event || payload?.type

          if (sessionIdSimple && statusSimple && webhookTypeSimple) {
            const simpleString = `${timestampHeader}:${sessionIdSimple}:${statusSimple}:${webhookTypeSimple}`
            const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(simpleString))
            const expected = toHex(sig)
            if (expected === signatureSimple) return true
          }
        }

        if (signature) {
          const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
          const expected = toHex(sig)
          if (expected === signature) return true
        }

        return false
      }

      if (!signatureV2 && !signatureSimple && !signature) {
        console.error('Missing webhook signature headers')
        return new Response(
          JSON.stringify({ success: false, error: 'Missing signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const isValid = await verifySignature()
      if (!isValid) {
        console.error('Invalid webhook signature')
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (timestampHeader) {
        let timestampMs = Number(timestampHeader)
        if (!Number.isNaN(timestampMs)) {
          // Didit can send unix seconds or milliseconds.
          if (timestampMs < 1_000_000_000_000) {
            timestampMs *= 1000
          }
          const driftMs = Math.abs(Date.now() - timestampMs)
          if (driftMs > 5 * 60 * 1000) {
            console.error('Webhook timestamp outside allowed window')
            return new Response(
              JSON.stringify({ success: false, error: 'Stale timestamp' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        }
      }
    }

    const eventType = payload.webhook_type || payload.event || payload.type
    const eventData = payload.data || payload
    const sessionId =
      eventData.session_id ||
      eventData.sessionId ||
      eventData.session?.id ||
      payload.session_id ||
      payload.sessionId ||
      payload.session?.id

    const eventKey = normalizeEventKey(eventType)
    const statusValue = normalizeStatus(
      eventData.status ||
      payload.status ||
      eventData?.decision?.status ||
      payload?.decision?.status
    )

    if (!sessionId) {
      console.error('No session_id found in webhook payload')
      return new Response(
        JSON.stringify({ success: false, error: 'Missing session_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Find verification attempt by session_id
    console.log('Searching for verification attempt with session_id:', sessionId)
    const { data: attempt, error: attemptError } = await supabase
      .from('verification_attempts')
      .select('*, signer:document_signers(*)')
      .eq('didit_session_id', sessionId)
      .single()

    if (attemptError || !attempt) {
      console.error('CRITICAL: Verification attempt not found for session:', {
        sessionId,
        error: attemptError,
        eventType,
        payload: JSON.stringify(payload),
        hint: 'This usually means the verification_attempt was not created in didit-proxy/create-session'
      })
      // Return 200 to prevent Didit from retrying (session is orphaned)
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Verification attempt not found',
          sessionId,
          note: 'This is likely due to database insert failure during session creation'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Found verification attempt:', {
      attemptId: attempt.id,
      signerId: attempt.signer_id,
      currentStatus: attempt.status,
      sessionId
    })

    // Route to appropriate handler based on event type
    switch (eventKey) {
      case 'statusupdated': {
        if (['approved', 'verified', 'completed', 'success'].includes(statusValue)) {
          await handleVerificationSuccess(supabase, attempt, eventData)
        } else if (['declined', 'failed', 'rejected'].includes(statusValue)) {
          await handleVerificationFailed(supabase, attempt, eventData)
        } else if (['abandoned', 'expired', 'cancelled', 'canceled'].includes(statusValue)) {
          await handleVerificationExpired(supabase, attempt, eventData)
        } else if (['in_review'].includes(statusValue)) {
          // Manual review - generate continuity token
          await handleVerificationInReview(supabase, attempt, eventData)
        } else if (['in_progress', 'started', 'pending'].includes(statusValue)) {
          await handleVerificationInProgress(supabase, attempt, eventData)
        } else {
          await handleVerificationInProgress(supabase, attempt, eventData)
        }
        break
      }
      case 'dataupdated':
        await handleVerificationDataUpdated(supabase, attempt, eventData)
        break

      case 'sessioncompleted':
      case 'sessionverified':
      case 'verificationcompleted':
        await handleVerificationSuccess(supabase, attempt, eventData)
        break

      case 'sessionfailed':
      case 'verificationfailed':
        await handleVerificationFailed(supabase, attempt, eventData)
        break

      case 'sessionexpired':
      case 'verificationexpired':
        await handleVerificationExpired(supabase, attempt, eventData)
        break

      default:
        // Fallback for unknown event names: derive transition from status.
        if (['approved', 'verified', 'completed', 'success'].includes(statusValue)) {
          await handleVerificationSuccess(supabase, attempt, eventData)
        } else if (['declined', 'failed', 'rejected'].includes(statusValue)) {
          await handleVerificationFailed(supabase, attempt, eventData)
        } else if (['abandoned', 'expired', 'cancelled', 'canceled'].includes(statusValue)) {
          await handleVerificationExpired(supabase, attempt, eventData)
        } else if (['in_review'].includes(statusValue)) {
          await handleVerificationInReview(supabase, attempt, eventData)
        } else if (['in_progress', 'started', 'pending'].includes(statusValue)) {
          await handleVerificationInProgress(supabase, attempt, eventData)
        } else {
          console.log(`Unhandled Didit webhook event`, {
            eventType,
            eventKey,
            statusValue,
            sessionId
          })
        }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Handle successful verification
 */
async function handleVerificationSuccess(supabase: any, attempt: any, eventData: any) {
  console.log('Processing verification success')

  const signerId = attempt.signer_id
  const verifiedAt =
    eventData?.decision?.verified_at ||
    eventData?.verified_at ||
    eventData?.completedAt ||
    new Date().toISOString()

  // Check if this attempt went through manual review
  const wasInReview = attempt.was_in_review === true

  if (wasInReview) {
    // Manual review case: set REVIEW_APPROVED, do NOT set verified_at yet
    // User must redeem continuity token to start TTL
    console.log('Verification approved after manual review - waiting for token redemption')

    const { error: attemptError } = await supabase
      .from('verification_attempts')
      .update({
        status: 'REVIEW_APPROVED',
        completed_at: verifiedAt,
        verification_data: eventData
      })
      .eq('id', attempt.id)

    if (attemptError) {
      console.error('Error updating verification attempt:', attemptError)
    }

    const { error: signerError } = await supabase
      .from('document_signers')
      .update({
        status: 'REVIEW_APPROVED'
      })
      .eq('id', signerId)

    if (signerError) {
      console.error('Error updating signer:', signerError)
    } else {
      console.log(`Signer ${signerId} marked as REVIEW_APPROVED (awaiting token redemption)`)
    }

    // Log audit event for review approval and send notification email
    const { data: signer } = await supabase
      .from('document_signers')
      .select('document_id, name, email, signing_token')
      .eq('id', signerId)
      .single()

    if (signer) {
      // Get document title for the email
      const { data: document } = await supabase
        .from('documents')
        .select('file_name')
        .eq('id', signer.document_id)
        .single()

      await supabase
        .from('audit_log')
        .insert({
          document_id: signer.document_id,
          signer_id: signerId,
          verification_attempt_id: attempt.id,
          event_type: 'identity_review_approved',
          description: `Revisión manual aprobada para ${signer.name} (${signer.email}) - esperando token de continuidad`,
          actor_type: 'system',
          event_data: {
            session_id: eventData.session_id || eventData.sessionId,
            approved_at: verifiedAt,
            continuity_token: attempt.continuity_token
          }
        })

      // Send email notification to user with continuity link
      const emailResult = await sendReviewApprovedEmail(
        signer,
        attempt.continuity_token,
      document?.file_name
    )

      // Log email send result in audit
      await supabase
        .from('audit_log')
        .insert({
          document_id: signer.document_id,
          signer_id: signerId,
          verification_attempt_id: attempt.id,
          event_type: 'review_approved_email_sent',
          description: emailResult.success
            ? `Email de notificación enviado a ${signer.email}`
            : `Error enviando email a ${signer.email}: ${emailResult.error}`,
          actor_type: 'system',
          event_data: {
            email_sent: emailResult.success,
            email_id: emailResult.id,
            error: emailResult.error
          }
        })
    }

    return
  }

  // Direct success case (no manual review): original flow
  // Update verification attempt
  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      status: 'SUCCESS',
      completed_at: verifiedAt,
      verification_data: eventData
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }

  // Update signer status to VERIFIED with verified_at (starts TTL)
  const { error: signerError } = await supabase
    .from('document_signers')
    .update({
      status: 'VERIFIED',
      verified_at: verifiedAt
    })
    .eq('id', signerId)

  if (signerError) {
    console.error('Error updating signer:', signerError)
  } else {
    console.log(`Signer ${signerId} marked as VERIFIED`)
  }

  // Log audit event
  const { data: signer } = await supabase
    .from('document_signers')
    .select('document_id, name, email')
    .eq('id', signerId)
    .single()

  if (signer) {
    await supabase
      .from('audit_log')
      .insert({
        document_id: signer.document_id,
        signer_id: signerId,
        verification_attempt_id: attempt.id,
        event_type: 'identity_verified',
        description: `Identidad verificada para ${signer.name} (${signer.email})`,
        actor_type: 'signer',
        event_data: {
          session_id: eventData.session_id || eventData.sessionId,
          verified_at: verifiedAt
        }
      })
  }
}

/**
 * Handle failed verification
 */
async function handleVerificationFailed(supabase: any, attempt: any, eventData: any) {
  console.log('Processing verification failure')

  const signerId = attempt.signer_id
  const failureReason =
    eventData?.decision?.reason ||
    eventData?.decision?.status_reason ||
    eventData?.failure_reason ||
    eventData?.error ||
    'Verification failed'

  // Update verification attempt
  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      status: 'FAILED',
      completed_at: new Date().toISOString(),
      failure_reason: failureReason,
      verification_data: eventData
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }

  // Update signer status to VERIFICATION_FAILED
  const { error: signerError } = await supabase
    .from('document_signers')
    .update({
      status: 'VERIFICATION_FAILED'
    })
    .eq('id', signerId)

  if (signerError) {
    console.error('Error updating signer:', signerError)
  } else {
    console.log(`Signer ${signerId} marked as VERIFICATION_FAILED`)
  }

  // Log audit event
  const { data: signer } = await supabase
    .from('document_signers')
    .select('document_id, name, email')
    .eq('id', signerId)
    .single()

  if (signer) {
    await supabase
      .from('audit_log')
      .insert({
        document_id: signer.document_id,
        signer_id: signerId,
        verification_attempt_id: attempt.id,
        event_type: 'identity_verification_failed',
        description: `Verificación de identidad falló para ${signer.name}: ${failureReason}`,
        actor_type: 'signer',
        event_data: {
          session_id: eventData.session_id || eventData.sessionId,
          failure_reason: failureReason
        }
      })

    const creatorInfo = await getCreatorContact(supabase, signer.document_id)
    if (creatorInfo?.creator?.email && !(await hasAuditEvent(supabase, signer.document_id, 'creator_identity_failed_email_sent', signerId))) {
      const emailResult = await sendCreatorVerificationEmail({
        to: creatorInfo.creator.email,
        creatorName: creatorInfo.creator.name,
        signerName: signer.name,
        signerEmail: signer.email,
        documentTitle: creatorInfo.document?.file_name || null,
        statusLabel: 'Verificación de identidad fallida',
        detail: failureReason ? `Motivo: ${failureReason}` : null
      })

      await supabase
        .from('audit_log')
        .insert({
          document_id: signer.document_id,
          signer_id: signerId,
          verification_attempt_id: attempt.id,
          event_type: 'creator_identity_failed_email_sent',
          description: emailResult.success
            ? `Email de verificación fallida enviado a ${creatorInfo.creator.email}`
            : `Error enviando email de verificación fallida a ${creatorInfo.creator.email}: ${emailResult.error}`,
          actor_type: 'system',
          event_data: {
            email_sent: emailResult.success,
            email_id: emailResult.id,
            error: emailResult.error
          }
        })
    }
  }
}

/**
 * Handle expired verification
 */
async function handleVerificationExpired(supabase: any, attempt: any, eventData: any) {
  console.log('Processing verification expiration')

  const signerId = attempt.signer_id

  // Update verification attempt
  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      status: 'EXPIRED',
      completed_at: new Date().toISOString(),
      verification_data: eventData
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }

  // Update signer status to VERIFICATION_FAILED (can retry)
  const { error: signerError } = await supabase
    .from('document_signers')
    .update({
      status: 'VERIFICATION_FAILED'
    })
    .eq('id', signerId)

  if (signerError) {
    console.error('Error updating signer:', signerError)
  } else {
    console.log(`Signer ${signerId} verification expired`)
  }

  // Log audit event
  const { data: signer } = await supabase
    .from('document_signers')
    .select('document_id, name, email')
    .eq('id', signerId)
    .single()

  if (signer) {
    await supabase
      .from('audit_log')
      .insert({
        document_id: signer.document_id,
        signer_id: signerId,
        verification_attempt_id: attempt.id,
        event_type: 'identity_verification_expired',
        description: `Verificación de identidad expiró para ${signer.name}`,
        actor_type: 'system',
        event_data: {
          session_id: eventData.session_id || eventData.sessionId
        }
      })
  }
}

/**
 * Handle in-progress verification (automatic processing)
 */
async function handleVerificationInProgress(supabase: any, attempt: any, eventData: any) {
  const signerId = attempt.signer_id

  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      status: 'IN_PROGRESS',
      verification_data: eventData
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }

  const { error: signerError } = await supabase
    .from('document_signers')
    .update({
      status: 'VERIFYING'
    })
    .eq('id', signerId)

  if (signerError) {
    console.error('Error updating signer:', signerError)
  }
}

/**
 * Handle in-review verification (manual review required)
 * Generates a continuity token so user can return after review is complete
 */
async function handleVerificationInReview(supabase: any, attempt: any, eventData: any) {
  console.log('Processing verification in-review - generating continuity token')

  const signerId = attempt.signer_id

  // Generate continuity token with 48h expiration
  const continuityToken = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48 hours

  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      status: 'IN_REVIEW',
      verification_data: eventData,
      was_in_review: true,
      continuity_token: continuityToken,
      continuity_token_expires_at: expiresAt
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }

  const { error: signerError } = await supabase
    .from('document_signers')
    .update({
      status: 'VERIFYING'
    })
    .eq('id', signerId)

  if (signerError) {
    console.error('Error updating signer:', signerError)
  }

  // Log audit event
  const { data: signer } = await supabase
    .from('document_signers')
    .select('document_id, name, email')
    .eq('id', signerId)
    .single()

  if (signer) {
    await supabase
      .from('audit_log')
      .insert({
        document_id: signer.document_id,
        signer_id: signerId,
        verification_attempt_id: attempt.id,
        event_type: 'identity_verification_in_review',
        description: `Verificación enviada a revisión manual para ${signer.name} (${signer.email})`,
        actor_type: 'system',
        event_data: {
          session_id: eventData.session_id || eventData.sessionId,
          continuity_token_expires_at: expiresAt
        }
      })

    const creatorInfo = await getCreatorContact(supabase, signer.document_id)
    if (creatorInfo?.creator?.email && !(await hasAuditEvent(supabase, signer.document_id, 'creator_identity_in_review_email_sent', signerId))) {
      const emailResult = await sendCreatorVerificationEmail({
        to: creatorInfo.creator.email,
        creatorName: creatorInfo.creator.name,
        signerName: signer.name,
        signerEmail: signer.email,
        documentTitle: creatorInfo.document?.file_name || null,
        statusLabel: 'Verificación enviada a revisión',
        detail: 'La verificación de identidad requiere revisión manual.'
      })

      await supabase
        .from('audit_log')
        .insert({
          document_id: signer.document_id,
          signer_id: signerId,
          verification_attempt_id: attempt.id,
          event_type: 'creator_identity_in_review_email_sent',
          description: emailResult.success
            ? `Email de verificación en revisión enviado a ${creatorInfo.creator.email}`
            : `Error enviando email de verificación en revisión a ${creatorInfo.creator.email}: ${emailResult.error}`,
          actor_type: 'system',
          event_data: {
            email_sent: emailResult.success,
            email_id: emailResult.id,
            error: emailResult.error
          }
        })
    }
  }

  console.log(`Continuity token generated for signer ${signerId}, expires at ${expiresAt}`)
}

/**
 * Handle data.updated webhook (store updated decision/fields)
 */
async function handleVerificationDataUpdated(supabase: any, attempt: any, eventData: any) {
  const { error: attemptError } = await supabase
    .from('verification_attempts')
    .update({
      verification_data: eventData
    })
    .eq('id', attempt.id)

  if (attemptError) {
    console.error('Error updating verification attempt:', attemptError)
  }
}
