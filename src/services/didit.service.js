import { supabase } from '../supabaseClient'
import { getSupabaseEnv } from '../utils/env'

/**
 * Didit Service
 * Handles identity verification via Didit API through Edge Function proxy
 */

const DiditService = {
  /**
   * Get the Edge Function URL
   */
  getProxyUrl() {
    const { url: supabaseUrl } = getSupabaseEnv()
    return `${supabaseUrl}/functions/v1/didit-proxy`
  },

  /**
   * Get authorization headers for Edge Function calls
   */
  async getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    const { anonKey } = getSupabaseEnv()
    if (session?.access_token) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey
      }
    }
    return {
      'Content-Type': 'application/json',
      'apikey': anonKey
    }
  },

  /**
   * Start identity verification session
   * @param {string} signerId - UUID of the signer
   * @param {string} email - Signer's email
   * @param {string} name - Signer's name
   * @returns {Object} {sessionId, verificationUrl}
   */
  async startVerification(signerId, email, name, callbackUrlOverride, signingToken) {
    try {
      const callbackUrl =
        callbackUrlOverride || `${window.location.origin}/sign/verify-callback`
      const language = 'es'

      const nameParts = (name || '').trim().split(/\s+/)
      const firstName = nameParts[0] || ''
      const lastName = nameParts.slice(1).join(' ') || ''

      const payload = {
        action: 'create-session',
        signerId,
        email,
        name,
        callbackUrl,
        language,
        signingToken
      }

      if (firstName || lastName) {
        payload.expectedDetails = {
          first_name: firstName,
          last_name: lastName
        }
      }

      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Error ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error starting verification:', error)
      throw error
    }
  },

  /**
   * Get verification session status
   * @param {string} sessionId - Didit session ID
   * @returns {Object} Session status data
   */
  async getSessionStatus(sessionId, signerId, signingToken) {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'get-status',
          sessionId,
          signerId,
          signingToken
        })
      })

      if (!response.ok) {
        throw new Error(`Error al obtener estado de la sesión`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error getting session status:', error)
      throw error
    }
  },

  /**
   * Get verification session decision (manual review, approved, declined, etc.)
   * @param {string} sessionId - Didit session ID
   * @returns {Object} Decision data
   */
  async getSessionDecision(sessionId, signerId, signingToken) {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'get-decision',
          sessionId,
          signerId,
          signingToken
        })
      })

      if (!response.ok) {
        throw new Error(`Error al obtener decisión de la sesión`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error getting session decision:', error)
      throw error
    }
  },

  /**
   * Get full verification session detail (warnings, checks, etc.)
   * @param {string} sessionId - Didit session ID
   * @returns {Object} Session detail data
   */
  async getSessionDetail(sessionId, signerId, signingToken) {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'get-session-detail',
          sessionId,
          signerId,
          signingToken
        })
      })

      if (!response.ok) {
        throw new Error(`Error al obtener detalle de la sesión`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error getting session detail:', error)
      throw error
    }
  },

  /**
   * Update verification session status (manual review approve/decline)
   * @param {string} sessionId - Didit session ID
   * @param {string} newStatus - Approved | Declined
   * @param {string} comment - Reviewer comment
   */
  async updateSessionStatus(sessionId, newStatus, comment) {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update-status',
          sessionId,
          newStatus,
          comment
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Error ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('Error updating session status:', error)
      throw error
    }
  },

  /**
   * Generate verification PDF report
   * @param {string} sessionId - Didit session ID
   * @returns {Blob} PDF blob
   */
  async generatePdf(sessionId) {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'generate-pdf',
          sessionId
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Error al generar PDF')
      }

      return await response.blob()
    } catch (error) {
      console.error('Error generating PDF:', error)
      throw error
    }
  },

  /**
   * Delete a verification session in Didit
   * @param {string} sessionId - Didit session ID
   * @returns {Object} { deleted: boolean }
   */
  async deleteSession(sessionId) {
    try {
      if (!sessionId) return { deleted: false }
      const headers = await this.getAuthHeaders()
      const response = await fetch(this.getProxyUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'delete-session',
          sessionId
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Error al eliminar sesión')
      }

      return await response.json()
    } catch (error) {
      console.error('Error deleting Didit session:', error)
      throw error
    }
  },

  /**
   * Check if Didit is configured and enabled
   */
  async isConfigured() {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single()

      if (!tenant) return false

      const { data: integration } = await supabase
        .from('tenant_integrations')
        .select('is_enabled, config')
        .eq('tenant_id', tenant.id)
        .eq('integration_type', 'didit')
        .single()

      if (!integration || !integration.is_enabled) return false

      const { api_key, workflow_id } = integration.config || {}
      return !!(api_key && workflow_id)
    } catch (error) {
      return false
    }
  }
}

export default DiditService
