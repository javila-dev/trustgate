import { supabase } from '../supabaseClient'

/**
 * Documenso Service
 * Handles all interactions with the Documenso API
 */

const DocumensoService = {
  /**
   * Get Documenso credentials from tenant_integrations
   */
  async getCredentials(tenantIdOverride) {
    let tenantId = tenantIdOverride

    if (!tenantId) {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id

      if (!userId) {
        throw new Error('No hay sesión activa')
      }

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', userId)
        .single()

      if (!tenantUser?.tenant_id) {
        throw new Error('No se encontró el tenant del usuario')
      }

      tenantId = tenantUser.tenant_id
    }

    const { data: integration, error } = await supabase
      .from('tenant_integrations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('integration_type', 'documenso')
      .eq('is_enabled', true)
      .single()

    if (error || !integration) {
      throw new Error('La integración de Documenso no está configurada')
    }

    const { api_token, base_url } = integration.config

    if (!api_token || !base_url) {
      throw new Error('Las credenciales de Documenso están incompletas')
    }

    return { apiToken: api_token, baseUrl: base_url }
  },

  /**
   * Map field types from our system to Documenso
   */
  mapFieldType(type) {
    const mapping = {
      'SIGNATURE': 'SIGNATURE',
      'DATE': 'DATE',
      'TEXT': 'TEXT',
      'EMAIL': 'EMAIL',
      'NAME': 'NAME',
      'CHECKBOX': 'CHECKBOX'
    }
    return mapping[type] || 'SIGNATURE'
  },

  /**
   * Create a document in Documenso (API v2)
   * @param {File} pdfFile - The PDF file
   * @param {string} documentName - Document title
   * @param {Array} signers - Array of {id, name, email, role, order}
   * @param {Array} fields - Array of {signerId, type, page, positionX, positionY, width, height, isRequired}
   * @returns {Object} {envelopeId, signersData: [{signerId, recipientToken, documensoRecipientId}]}
   */
  async createDocument(pdfFile, documentName, signers, fields, tenantIdOverride) {
    try {
      // 1. Get credentials
      const { apiToken, baseUrl } = await this.getCredentials(tenantIdOverride)

      const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

      // 2. Prepare recipients (fields will be added via create-many)
      const recipients = signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        role: signer.role || 'SIGNER',
        signingOrder: signer.order ?? index + 1
      }))

      // 3. Call Documenso API v2 (multipart/form-data)
      const formData = new FormData()
      const payload = {
        type: 'DOCUMENT',
        title: documentName,
        recipients,
        meta: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      }

      formData.append('payload', JSON.stringify(payload))
      formData.append('files', pdfFile, pdfFile.name)

      const response = await fetch(`${normalizedBaseUrl}/api/v2/envelope/create`, {
        method: 'POST',
        headers: {
          'Authorization': apiToken
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('Documenso error response:', errorData)
        console.error('Payload sent:', JSON.stringify(payload, null, 2))
        throw new Error(
          `Error de Documenso (${response.status}): ${
            JSON.stringify(errorData.error || errorData.message || errorData, null, 2)
          }`
        )
      }

      const data = await response.json()

      // 4. Map response to our structure
      const envelopeId = data.id || data.documentId

      // 5. Fetch envelope to get recipient IDs + envelope items
      const envelopeResponse = await fetch(`${normalizedBaseUrl}/api/v2/envelope/${envelopeId}`, {
        method: 'GET',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      })

      if (!envelopeResponse.ok) {
        throw new Error(`Error al obtener envelope: ${envelopeResponse.statusText}`)
      }

      const envelopeData = await envelopeResponse.json()

      const envelopeItems =
        envelopeData.envelopeItems ||
        envelopeData.items ||
        envelopeData.documents ||
        envelopeData.files ||
        []

      const recipientsByEmail = new Map()
      ;(envelopeData.recipients || []).forEach(recipient => {
        if (recipient?.email) {
          recipientsByEmail.set(recipient.email.toLowerCase(), recipient)
        }
      })

      // 6. Create fields via /envelope/field/create-many to ensure positioning
      if (fields?.length) {
        const signerIdToRecipientId = new Map()
        signers.forEach(signer => {
          const recipient = recipientsByEmail.get(signer.email?.toLowerCase())
          if (recipient?.id != null) {
            signerIdToRecipientId.set(signer.id, recipient.id)
          }
        })

        const defaultEnvelopeItemId = envelopeItems[0]?.id || envelopeItems[0]?.envelopeItemId

        const fieldsPayload = fields
          .map(field => {
            const recipientId = signerIdToRecipientId.get(field.signerId)
            if (!recipientId) return null

            const payload = {
              recipientId,
              type: this.mapFieldType(field.type),
              page: Number(field.page),
              positionX: Number(field.positionX),
              positionY: Number(field.positionY),
              width: Number(field.width),
              height: Number(field.height)
            }

            if (defaultEnvelopeItemId) {
              payload.envelopeItemId = defaultEnvelopeItemId
            }

            return payload
          })
          .filter(Boolean)

        if (fieldsPayload.length === 0) {
          throw new Error('No se pudieron mapear campos a recipients/envelope items.')
        }

        const fieldsResponse = await fetch(`${normalizedBaseUrl}/api/v2/envelope/field/create-many`, {
          method: 'POST',
          headers: {
            'Authorization': apiToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            envelopeId,
            data: fieldsPayload
          })
        })

        if (!fieldsResponse.ok) {
          const errorText = await fieldsResponse.text()
          throw new Error(`Error al crear campos en Documenso: ${errorText}`)
        }
      }

      // 7. Distribute envelope so it's ready to sign
      const distributeResponse = await fetch(`${normalizedBaseUrl}/api/v2/envelope/distribute`, {
        method: 'POST',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ envelopeId })
      })

      if (!distributeResponse.ok) {
        const errorText = await distributeResponse.text()
        throw new Error(`Error al distribuir envelope: ${errorText}`)
      }

      // 8. Fetch envelope again to get recipient tokens after distribution
      const envelopeAfterDistribute = await fetch(`${normalizedBaseUrl}/api/v2/envelope/${envelopeId}`, {
        method: 'GET',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      })

      if (!envelopeAfterDistribute.ok) {
        throw new Error(`Error al obtener envelope post-distribute: ${envelopeAfterDistribute.statusText}`)
      }

      const envelopeFinal = await envelopeAfterDistribute.json()
      const recipientsByEmailFinal = new Map()
      ;(envelopeFinal.recipients || []).forEach(recipient => {
        if (recipient?.email) {
          recipientsByEmailFinal.set(recipient.email.toLowerCase(), recipient)
        }
      })

      const signersData = signers.map((signer, index) => {
        const recipient =
          recipientsByEmailFinal.get(signer.email?.toLowerCase()) ||
          envelopeFinal.recipients?.[index]

        return {
          signerId: signer.id,
          recipientToken: recipient?.token || recipient?.signingUrl || null,
          documensoRecipientId: recipient?.id != null ? String(recipient.id) : String(index + 1)
        }
      })

      return {
        envelopeId,
        signersData
      }
    } catch (error) {
      console.error('Error creating document in Documenso:', error)
      throw error
    }
  },

  /**
   * Get document status from Documenso
   */
  async getDocumentStatus(envelopeId, tenantIdOverride) {
    try {
      const { apiToken, baseUrl } = await this.getCredentials(tenantIdOverride)

      const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
      const response = await fetch(`${normalizedBaseUrl}/api/v2/envelope/${envelopeId}`, {
        method: 'GET',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Error al obtener estado del documento: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error getting document status:', error)
      throw error
    }
  }
  ,
  /**
   * Download completed document PDF for an envelope
   * @param {string} envelopeId
   * @returns {Object} { blob, fileName }
   */
  async downloadCompletedDocument(envelopeId, tenantIdOverride) {
    try {
      const { apiToken, baseUrl } = await this.getCredentials(tenantIdOverride)
      const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

      const envelope = await this.getDocumentStatus(envelopeId, tenantIdOverride)
      const envelopeItems =
        envelope.envelopeItems ||
        envelope.items ||
        envelope.documents ||
        envelope.files ||
        []

      const firstItem = envelopeItems[0]
      const envelopeItemId = firstItem?.id || firstItem?.envelopeItemId

      if (!envelopeItemId) {
        throw new Error('No se encontró el archivo del documento en Documenso')
      }

      const response = await fetch(`${normalizedBaseUrl}/api/v2/envelope/item/${envelopeItemId}/download`, {
        method: 'GET',
        headers: {
          'Authorization': apiToken
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error al descargar documento: ${errorText || response.statusText}`)
      }

      const blob = await response.blob()
      const rawName = firstItem?.title || envelope?.title || 'documento-firmado'
      const fileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`

      return { blob, fileName }
    } catch (error) {
      console.error('Error downloading Documenso document:', error)
      throw error
    }
  },

  /**
   * Get signing URL for a specific signer (by email) from an envelope
   * @param {string} envelopeId
   * @param {string} signerEmail
   * @returns {string|null} signing URL
   */
  async getSigningUrl(envelopeId, signerEmail, tenantIdOverride) {
    try {
      const { apiToken, baseUrl } = await this.getCredentials(tenantIdOverride)
      const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

      const response = await fetch(`${normalizedBaseUrl}/api/v2/envelope/${envelopeId}`, {
        method: 'GET',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Error al obtener envelope: ${response.statusText}`)
      }

      const envelopeData = await response.json()
      const recipients = envelopeData.recipients || []

      const recipient = recipients.find(r =>
        r?.email?.toLowerCase() === signerEmail?.toLowerCase()
      )

      const token = recipient?.token || recipient?.signingUrl || null
      if (!token) return null

      if (token.startsWith('http')) return token
      return `${normalizedBaseUrl}/sign/${token}`
    } catch (error) {
      console.error('Error getting signing URL from Documenso:', error)
      throw error
    }
  }
  ,
  /**
   * Delete (or cancel) an envelope in Documenso
   * @param {string} envelopeId
   */
  async deleteEnvelope(envelopeId, tenantIdOverride) {
    try {
      if (!envelopeId) return { deleted: false }
      const { apiToken, baseUrl } = await this.getCredentials(tenantIdOverride)
      const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

      const primaryResponse = await fetch(`${normalizedBaseUrl}/api/v2/envelope/delete`, {
        method: 'POST',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ envelopeId })
      })

      if (primaryResponse.ok) {
        return { deleted: true }
      }

      const fallbackResponse = await fetch(`${normalizedBaseUrl}/api/v2/envelope/${envelopeId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      })

      if (!fallbackResponse.ok) {
        const errorText = await fallbackResponse.text()
        throw new Error(errorText || 'Error al eliminar envelope')
      }

      return { deleted: true }
    } catch (error) {
      console.error('Error deleting Documenso envelope:', error)
      throw error
    }
  }
}

export default DocumensoService
