import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

async function sendCreatorSignerSignedEmail(params: {
  to: string
  creatorName?: string | null
  signerName?: string | null
  signerEmail?: string | null
  documentTitle?: string | null
}) {
  const subject = `Firma completada${params.documentTitle ? `: ${params.documentTitle}` : ''}`
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
            <h2 style="margin:0 0 8px; font-size:20px;">Firma completada</h2>
            <p style="margin:0 0 16px; color:#475569;">
              ${params.creatorName ? `Hola <strong>${params.creatorName}</strong>,` : 'Hola,'} un firmante completó su firma.
            </p>
            ${params.documentTitle ? `<p style="margin:0 0 8px; color:#475569;">Documento: <strong>${params.documentTitle}</strong></p>` : ''}
            <p style="margin:0; color:#475569;">
              Firmante: <strong>${params.signerName || 'Sin nombre'}</strong>${params.signerEmail ? ` (${params.signerEmail})` : ''}
            </p>
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

async function sendCreatorAllSignedEmail(params: {
  to: string
  creatorName?: string | null
  documentTitle?: string | null
}) {
  const subject = `Documento completado${params.documentTitle ? `: ${params.documentTitle}` : ''}`
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
            <h2 style="margin:0 0 8px; font-size:20px;">Documento completado</h2>
            <p style="margin:0 0 16px; color:#475569;">
              ${params.creatorName ? `Hola <strong>${params.creatorName}</strong>,` : 'Hola,'} todas las firmas fueron completadas.
            </p>
            ${params.documentTitle ? `<p style="margin:0; color:#475569;">Documento: <strong>${params.documentTitle}</strong></p>` : ''}
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

    // Parse webhook payload
    const payload = await req.json()
    console.log('Received Documenso webhook:', JSON.stringify(payload, null, 2))

    // Validate webhook signature
    const signature = req.headers.get('x-documenso-signature') || req.headers.get('x-webhook-signature')
    if (signature) {
      // Get webhook secret from database
      const { data: integration } = await supabase
        .from('tenant_integrations')
        .select('config')
        .eq('integration_type', 'documenso')
        .eq('is_enabled', true)
        .single()

      if (integration?.config?.webhook_secret) {
        const webhookSecret = integration.config.webhook_secret
        const payloadString = JSON.stringify(payload)

        // Compute HMAC-SHA256 signature
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(webhookSecret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
        const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadString))
        const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')

        // Compare signatures
        if (signature !== expectedSignature) {
          console.error('Invalid webhook signature')
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid signature' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    }

    const eventType = payload.event || payload.type
    const eventData = payload.payload || payload.data || payload
    const eventTypeLower = (eventType || '').toLowerCase()

    // Route to appropriate handler based on event type
    switch (eventTypeLower) {
      case 'document_signed':
      case 'recipient.signed':
      case 'recipient_signed':
        await handleRecipientSigned(supabase, eventData)
        break

      case 'document_completed':
      case 'document.completed':
      case 'document_completed':
        await handleDocumentCompleted(supabase, eventData)
        break

      case 'document_cancelled':
      case 'document.cancelled':
      case 'document_cancelled':
        await handleDocumentCancelled(supabase, eventData)
        break

      default:
        console.log(`Unhandled event type: ${eventType}`)
        // Heuristic fallback for unknown event types
        if (Array.isArray(eventData?.recipients)) {
          await handleRecipientSigned(supabase, eventData)
        }

        const statusValue = String(eventData?.status || payload?.status || '')
        if (eventTypeLower.includes('completed') || statusValue.toLowerCase() === 'completed') {
          await handleDocumentCompleted(supabase, eventData)
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
 * Handle when a recipient signs a document
 */
async function handleRecipientSigned(supabase: any, eventData: any) {
  console.log('Processing recipient.signed event')

  const envelopeId = eventData.id || eventData.documentId || eventData.envelope_id
  const recipients = eventData.recipients || eventData.Recipient || []

  // Find document by envelope_id
  let { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, file_name, created_by')
    .eq('documenso_envelope_id', envelopeId)
    .single()

  if (docError || !document) {
    // Fallback: resolve document by recipient id
    const recipientIdFallback = recipients?.[0]?.id || recipients?.[0]?.recipientId
    if (recipientIdFallback) {
      const { data: signerRow } = await supabase
        .from('document_signers')
        .select('document_id')
        .eq('documenso_recipient_id', String(recipientIdFallback))
        .single()
      if (signerRow?.document_id) {
        document = { id: signerRow.document_id }
      }
    }
  }

  if (!document) {
    console.error('Document not found:', envelopeId)
    return
  }

  // Update signers that have signed
  for (const recipient of recipients) {
    const signingStatus = String(recipient.signingStatus || recipient.status || '').toUpperCase()
    if (signingStatus === 'SIGNED' || recipient.signed === true) {
      const recipientId = String(recipient.id || recipient.recipientId)
      const signedAt = recipient.signedAt || recipient.signed_at || new Date().toISOString()

      // Get signer info and current status before updating
      const { data: signerInfo } = await supabase
        .from('document_signers')
        .select('id, name, email, status')
        .eq('documenso_recipient_id', recipientId)
        .single()

      // Skip if already signed (avoid duplicate events)
      if (signerInfo?.status === 'SIGNED') {
        console.log(`Signer ${recipientId} already SIGNED, skipping`)
        continue
      }

      const { error: updateError } = await supabase
        .from('document_signers')
        .update({
          status: 'SIGNED',
          signed_at: signedAt
        })
        .eq('documenso_recipient_id', recipientId)

      if (updateError) {
        console.error('Error updating signer:', updateError)
      } else {
        console.log(`Signer ${recipientId} marked as SIGNED`)

        // Log audit event with signer details
        await supabase
          .from('audit_log')
          .insert({
            document_id: document.id,
            signer_id: signerInfo?.id || null,
            event_type: 'recipient_signed',
            description: signerInfo
              ? `${signerInfo.name} (${signerInfo.email}) completó su firma`
              : `Firmante completó su firma`,
            actor_type: 'signer',
            event_data: {
              recipient_id: recipientId,
              signed_at: signedAt,
              signer_name: signerInfo?.name,
              signer_email: signerInfo?.email
            }
          })

        // Notify creator per signature (avoid duplicates)
        if (signerInfo?.id && !(await hasAuditEvent(supabase, document.id, 'signer_signed_email_sent', signerInfo.id))) {
          const creatorInfo = await getCreatorContact(supabase, document.id)
          if (creatorInfo?.creator?.email) {
            const emailResult = await sendCreatorSignerSignedEmail({
              to: creatorInfo.creator.email,
              creatorName: creatorInfo.creator.name,
              signerName: signerInfo?.name,
              signerEmail: signerInfo?.email,
              documentTitle: creatorInfo.document?.file_name || null
            })

            await supabase
              .from('audit_log')
              .insert({
                document_id: document.id,
                signer_id: signerInfo.id,
                event_type: 'signer_signed_email_sent',
                description: emailResult.success
                  ? `Email de firma completada enviado a ${creatorInfo.creator.email}`
                  : `Error enviando email de firma completada a ${creatorInfo.creator.email}: ${emailResult.error}`,
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
    }
  }

  // Check if there are pending signers
  const { data: pendingSigners } = await supabase
    .from('document_signers')
    .select('id')
    .eq('document_id', document.id)
    .neq('status', 'SIGNED')
    .eq('role', 'SIGNER')

  // Update document status
  if (pendingSigners && pendingSigners.length > 0) {
    // Still have pending signers -> IN_PROGRESS
    await supabase
      .from('documents')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', document.id)
      .eq('status', 'PENDING') // Only update if still PENDING

    console.log(`Document ${document.id} -> IN_PROGRESS (${pendingSigners.length} signers pending)`)
  } else {
    // All signed -> mark completed (fallback if no document.completed webhook)
    await supabase
      .from('documents')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString()
      })
      .eq('id', document.id)

    console.log(`Document ${document.id} -> COMPLETED (all signers signed)`)

    if (!(await hasAuditEvent(supabase, document.id, 'document_completed_email_sent'))) {
      const creatorInfo = await getCreatorContact(supabase, document.id)
      if (creatorInfo?.creator?.email) {
        const emailResult = await sendCreatorAllSignedEmail({
          to: creatorInfo.creator.email,
          creatorName: creatorInfo.creator.name,
          documentTitle: creatorInfo.document?.file_name || null
        })

        await supabase
          .from('audit_log')
          .insert({
            document_id: document.id,
            event_type: 'document_completed_email_sent',
            description: emailResult.success
              ? `Email de documento completado enviado a ${creatorInfo.creator.email}`
              : `Error enviando email de documento completado a ${creatorInfo.creator.email}: ${emailResult.error}`,
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
}

/**
 * Handle when document is completed (all signatures collected)
 */
async function handleDocumentCompleted(supabase: any, eventData: any) {
  console.log('Processing document.completed event')

  const envelopeId = eventData.id || eventData.documentId || eventData.envelope_id

  // Find document
  let { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, file_name, created_by')
    .eq('documenso_envelope_id', envelopeId)
    .single()

  if (docError || !document) {
    const recipientIdFallback = eventData?.recipients?.[0]?.id || eventData?.recipients?.[0]?.recipientId
    if (recipientIdFallback) {
      const { data: signerRow } = await supabase
        .from('document_signers')
        .select('document_id')
        .eq('documenso_recipient_id', String(recipientIdFallback))
        .single()
      if (signerRow?.document_id) {
        const { data: docRow } = await supabase
          .from('documents')
          .select('id, file_name, created_by')
          .eq('id', signerRow.document_id)
          .single()
        document = docRow || document
      }
    }
  }

  if (!document) {
    console.error('Document not found:', envelopeId)
    return
  }

  // Mark document as completed
  const { error: updateError } = await supabase
    .from('documents')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString()
    })
    .eq('id', document.id)

  if (updateError) {
    console.error('Error updating document:', updateError)
    return
  }

  console.log(`Document ${document.id} marked as COMPLETED`)

  // Log audit event
  await supabase
    .from('audit_log')
    .insert({
      document_id: document.id,
      event_type: 'document_completed',
      description: `Documento "${document.file_name}" completado - todas las firmas recibidas`,
      actor_type: 'system',
      event_data: {
        envelope_id: envelopeId,
        completed_at: new Date().toISOString()
      }
    })

  if (!(await hasAuditEvent(supabase, document.id, 'document_completed_email_sent'))) {
    const creatorInfo = await getCreatorContact(supabase, document.id)
    if (creatorInfo?.creator?.email) {
      const emailResult = await sendCreatorAllSignedEmail({
        to: creatorInfo.creator.email,
        creatorName: creatorInfo.creator.name,
      documentTitle: creatorInfo.document?.file_name || null
    })

      await supabase
        .from('audit_log')
        .insert({
          document_id: document.id,
          event_type: 'document_completed_email_sent',
          description: emailResult.success
            ? `Email de documento completado enviado a ${creatorInfo.creator.email}`
            : `Error enviando email de documento completado a ${creatorInfo.creator.email}: ${emailResult.error}`,
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
 * Handle when document is cancelled
 */
async function handleDocumentCancelled(supabase: any, eventData: any) {
  console.log('Processing document.cancelled event')

  const envelopeId = eventData.id || eventData.documentId || eventData.envelope_id

  // Find document
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, file_name')
    .eq('documenso_envelope_id', envelopeId)
    .single()

  if (docError || !document) {
    console.error('Document not found:', envelopeId)
    return
  }

  // Mark document as cancelled
  const { error: updateError } = await supabase
    .from('documents')
    .update({
      status: 'CANCELLED'
    })
    .eq('id', document.id)

  if (updateError) {
    console.error('Error updating document:', updateError)
    return
  }

  console.log(`Document ${document.id} marked as CANCELLED`)

  // Log audit event
  await supabase
    .from('audit_log')
    .insert({
      document_id: document.id,
      event_type: 'document_cancelled',
      description: `Documento "${document.file_name}" fue cancelado`,
      actor_type: 'system',
      event_data: {
        envelope_id: envelopeId,
        cancelled_at: new Date().toISOString()
      }
    })
}
