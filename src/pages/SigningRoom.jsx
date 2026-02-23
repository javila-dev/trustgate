import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import DiditService from '../services/didit.service'
import DocumensoService from '../services/documenso.service'
import { EmbedSignDocument } from '@documenso/embed-react'

// Flow states
const FLOW_STATES = {
  LOADING: 'loading',
  UNAUTHORIZED: 'unauthorized',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  NEEDS_VERIFICATION: 'needs_verification',
  VERIFYING: 'verifying',
  IN_REVIEW: 'in_review',
  REVIEW_APPROVED: 'review_approved', // Approved after manual review, waiting for token redemption
  VERIFICATION_FAILED: 'verification_failed',
  SESSION_EXPIRED: 'session_expired',
  READY_TO_SIGN: 'ready_to_sign',
  ALREADY_SIGNED: 'already_signed',
  ORDER_BLOCKED: 'order_blocked'
}

const normalizeDocumensoHost = (value) => {
  if (!value) return ''
  return value.replace(/\/$/, '')
}

const getDocumensoSigningUrl = (value, host) => {
  if (!value) return null
  if (value.startsWith('http')) return value
  const normalizedHost = normalizeDocumensoHost(host)
  if (!normalizedHost) return null
  return `${normalizedHost}/sign/${value}`
}

const getDocumensoToken = (value) => {
  if (!value) return null
  if (!value.startsWith('http')) return value

  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/sign\/([^/]+)/)
    return match ? match[1] : null
  } catch (err) {
    console.error('Invalid Documenso URL:', err)
    return null
  }
}

const VERIFICATION_TTL_MINUTES = 10
const VERIFICATION_TTL_MS = VERIFICATION_TTL_MINUTES * 60 * 1000
const DEVICE_TOKEN_STORAGE_KEY = 'trustgate_device_token'
const SESSION_EXPIRE_REASONS = {
  TTL: 'ttl_expired',
  DEVICE_MISMATCH: 'device_mismatch',
  TOKEN_MISSING: 'token_missing',
  NOT_VERIFIED: 'not_verified'
}

const SigningRoom = () => {
  const { transactionId } = useParams() // This is actually the signing_token
  const [searchParams] = useSearchParams()

  const [flowState, setFlowState] = useState(FLOW_STATES.LOADING)
  const [signer, setSigner] = useState(null)
  const [document, setDocument] = useState(null)
  const [error, setError] = useState(null)
  const [verificationAttempt, setVerificationAttempt] = useState(null)
  const [verificationLoading, setVerificationLoading] = useState(false)
  const [documensoHost, setDocumensoHost] = useState('https://app.documenso.com')
  const [signingUrlOverride, setSigningUrlOverride] = useState(null)
  const [signingSaving, setSigningSaving] = useState(false)
  const [showSigningModal, setShowSigningModal] = useState(false)
  const [tenantName, setTenantName] = useState('')
  const [redeemingToken, setRedeemingToken] = useState(false)
  const [continuityCopied, setContinuityCopied] = useState(false)
  const [signingOrder, setSigningOrder] = useState({ blocked: false, pending: [] })
  const [deviceToken, setDeviceToken] = useState(null)
  const [sessionExpiryReason, setSessionExpiryReason] = useState(null)
  const [nowTs, setNowTs] = useState(Date.now())
  const processedContinuityTokenRef = useRef(null)

  const getSigningRoomUrl = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    return `${supabaseUrl}/functions/v1/signing-room`
  }

  const callSigningRoom = async (payload) => {
    const response = await fetch(getSigningRoomUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Error ${response.status}`)
    }

    return response.json()
  }

  const normalizeStatus = (value) => {
    if (!value || typeof value !== 'string') return ''
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  }

  const getStatusCandidates = (...values) => {
    const out = []
    values.forEach((value) => {
      if (!value) return
      if (typeof value === 'string') {
        out.push(normalizeStatus(value))
        return
      }
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (typeof item === 'string') out.push(normalizeStatus(item))
        })
      }
    })
    return out.filter(Boolean)
  }

  const isReviewStatus = (value) => {
    const status = normalizeStatus(value)
    return ['in_review', 'manual_review', 'review_pending'].includes(status)
  }

  const isRejectedStatus = (value) => {
    const status = normalizeStatus(value)
    return [
      'declined',
      'failed',
      'rejected',
      'verification_failed',
      'review_declined',
      'review_rejected',
      'not_approved',
      'denied'
    ].includes(status)
  }

  const isApprovedStatus = (value) => {
    const status = normalizeStatus(value)
    return ['review_approved', 'approved', 'verified', 'completed', 'success'].includes(status)
  }

  const formatRemaining = (deadline) => {
    if (!deadline) return null
    const remainingMs = deadline.getTime() - Date.now()
    if (remainingMs <= 0) return 'Plazo vencido'
    const minutes = Math.floor(remainingMs / 60000)
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} h`
    const days = Math.floor(hours / 24)
    return `${days} días`
  }

  const formatVerificationRemaining = (verifiedAt, referenceTs = Date.now()) => {
    if (!verifiedAt) return null
    const remainingMs = new Date(verifiedAt).getTime() + VERIFICATION_TTL_MS - referenceTs
    if (remainingMs <= 0) return 'Vencida'
    const minutes = Math.ceil(remainingMs / 60000)
    return `${minutes} min`
  }

  const getVerificationReminder = (verifiedAt, referenceTs = Date.now()) => {
    if (!verifiedAt) return null
    const remainingMs = new Date(verifiedAt).getTime() + VERIFICATION_TTL_MS - referenceTs
    if (remainingMs <= 0) return null
    if (remainingMs <= 60 * 1000) {
      return {
        tone: 'critical',
        text: 'Queda menos de 1 minuto para completar la firma.'
      }
    }
    if (remainingMs <= 2 * 60 * 1000) {
      return {
        tone: 'warning',
        text: 'Quedan menos de 2 minutos para completar la firma.'
      }
    }
    if (remainingMs <= 5 * 60 * 1000) {
      return {
        tone: 'info',
        text: 'Recuerda completar la firma pronto para no repetir la verificación.'
      }
    }
    return null
  }

  const getOrCreateDeviceToken = () => {
    let currentToken = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)
    if (currentToken) return currentToken

    currentToken = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, currentToken)
    return currentToken
  }

  const isVerificationWindowOpen = (verifiedAt) => {
    if (!verifiedAt) return false
    const verifiedAtMs = new Date(verifiedAt).getTime()
    if (!Number.isFinite(verifiedAtMs)) return false
    return (Date.now() - verifiedAtMs) < VERIFICATION_TTL_MS
  }

  const isSessionValidForSigning = (signerData, localToken) => {
    if (!signerData) return false
    return getSessionInvalidReason(signerData, localToken) === null
  }

  const getSessionInvalidReason = (signerData, localToken) => {
    if (!signerData) return SESSION_EXPIRE_REASONS.NOT_VERIFIED
    const requiresVerification = Boolean(signerData.document?.requires_identity_verification) && Boolean(signerData.requires_verification)
    if (!requiresVerification) return null
    if (signerData.status !== 'VERIFIED') return SESSION_EXPIRE_REASONS.NOT_VERIFIED
    if (!localToken || !signerData.device_session_token) return SESSION_EXPIRE_REASONS.TOKEN_MISSING
    if (localToken !== signerData.device_session_token) return SESSION_EXPIRE_REASONS.DEVICE_MISMATCH
    if (!isVerificationWindowOpen(signerData.verified_at)) return SESSION_EXPIRE_REASONS.TTL
    return null
  }

  const bindDeviceSessionIfMissing = async (signerData, localToken) => {
    const requiresVerification = Boolean(signerData?.document?.requires_identity_verification) && Boolean(signerData?.requires_verification)
    if (!requiresVerification) return signerData
    if (!localToken) return signerData
    if (signerData?.device_session_token) return signerData

    await callSigningRoom({
      action: 'bind-device-session',
      signingToken: transactionId,
      signerId: signerData.id,
      deviceSessionToken: localToken
    })

    return {
      ...signerData,
      device_session_token: localToken
    }
  }

  useEffect(() => {
    loadSignerData()
  }, [transactionId])

  useEffect(() => {
    if (!showSigningModal) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowSigningModal(false)
      }
    }

    window.document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSigningModal])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now())
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  // Check if returning from Didit verification
  useEffect(() => {
    const verified = searchParams.get('verified')
    if (verified === 'true' && signer) {
      // Reload data to get updated status
      loadSignerData()
    }
  }, [searchParams])

  // Check for continuity token in URL and redeem it
  useEffect(() => {
    const continuityToken = searchParams.get('continuity_token')
    if (!continuityToken || !signer || redeemingToken) return
    if (processedContinuityTokenRef.current === continuityToken) return

    processedContinuityTokenRef.current = continuityToken
    if (continuityToken && signer && !redeemingToken) {
      redeemContinuityToken(continuityToken)
    }
  }, [searchParams, signer, redeemingToken])

  const redeemContinuityToken = async (token) => {
    const removeContinuityTokenFromUrl = () => {
      const currentParams = new URLSearchParams(window.location.search)
      currentParams.delete('continuity_token')
      const nextQuery = currentParams.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`)
    }

    try {
      setRedeemingToken(true)
      setError(null)

      const response = await callSigningRoom({
        action: 'redeem-continuity-token',
        signingToken: transactionId,
        token
      })

      if (response?.ok) {
        // Clear the token from URL to prevent re-redemption
        removeContinuityTokenFromUrl()
        // Token redeemed successfully, reload data (now has verified_at, TTL started)
        await loadSignerData()
      }
    } catch (err) {
      console.error('Error redeeming continuity token:', err)
      const message = err?.message || 'Token inválido o expirado'
      const isReusableStateError =
        message.toLowerCase().includes('token ya utilizado') ||
        message.toLowerCase().includes('token expirado')

      if (isReusableStateError) {
        removeContinuityTokenFromUrl()
        await loadSignerData()
        return
      }

      setError(message)
    } finally {
      setRedeemingToken(false)
    }
  }

  const loadSignerData = async () => {
    try {
      setFlowState(FLOW_STATES.LOADING)
      setError(null)
      setShowSigningModal(false)
      setSessionExpiryReason(null)

      const response = await callSigningRoom({
        action: 'get-signer',
        signingToken: transactionId
      })

      const rawSignerData = response?.signer
      const documentData = response?.document

      if (!rawSignerData || !documentData) {
        setFlowState(FLOW_STATES.UNAUTHORIZED)
        setError('Link inválido o expirado. Por favor contacta al administrador.')
        return
      }

      const localToken = getOrCreateDeviceToken()
      setDeviceToken(localToken)
      const signerData = await bindDeviceSessionIfMissing(rawSignerData, localToken)

      setSigner(signerData)
      setDocument(documentData)
      setSigningOrder(response?.signingOrder || { blocked: false, pending: [] })
      const storedToken = signerData.documenso_recipient_token || signerData.signing_url
      setSigningUrlOverride(null)
      setTenantName(response?.tenantName || '')

      if (response?.documensoBaseUrl) {
        setDocumensoHost(response.documensoBaseUrl)
      }

      if (!storedToken && documentData?.documenso_envelope_id && signerData.email) {
        try {
          const signingUrl = await DocumensoService.getSigningUrl(
            documentData.documenso_envelope_id,
            signerData.email,
            documentData.tenant_id
          )

          if (signingUrl) {
            setSigningUrlOverride(signingUrl)
          }
        } catch (err) {
          console.error('Error fetching Documenso signing URL:', err)
        }
      }

      // 2. Check if document is expired
      if (signerData.document.signing_deadline) {
        const deadline = new Date(signerData.document.signing_deadline)
        if (deadline < new Date()) {
          setFlowState(FLOW_STATES.EXPIRED)
          return
        }
      }

      if (signerData.document.status === 'CANCELLED') {
        setFlowState(FLOW_STATES.CANCELLED)
        return
      }

      // 3. Determine flow state based on signer and document status
      const isOrderBlocked = response?.signingOrder?.blocked

      if (signerData.status === 'SIGNED') {
        setFlowState(FLOW_STATES.ALREADY_SIGNED)
      } else if (signerData.document.requires_identity_verification &&
                 signerData.requires_verification) {
        // Requires verification
        if (signerData.status === 'VERIFIED') {
          const isSessionValid = isSessionValidForSigning(signerData, localToken)
          if (isSessionValid) {
            setFlowState(isOrderBlocked ? FLOW_STATES.ORDER_BLOCKED : FLOW_STATES.READY_TO_SIGN)
          } else {
            setSessionExpiryReason(getSessionInvalidReason(signerData, localToken))
            setFlowState(FLOW_STATES.SESSION_EXPIRED)
          }
        } else if (signerData.status === 'REVIEW_APPROVED') {
          // Verification approved after manual review, waiting for token redemption
          setFlowState(FLOW_STATES.REVIEW_APPROVED)
          await loadVerificationAttempt(signerData.id, signerData.status)
        } else if (signerData.status === 'VERIFYING') {
          setFlowState(FLOW_STATES.VERIFYING)
          // Load verification attempt
          await loadVerificationAttempt(signerData.id, signerData.status)
        } else if (signerData.status === 'VERIFICATION_FAILED') {
          setFlowState(FLOW_STATES.VERIFICATION_FAILED)
        } else {
          setFlowState(FLOW_STATES.NEEDS_VERIFICATION)
          // Try to load any existing verification attempt (e.g., pending/in review)
          await loadVerificationAttempt(signerData.id, signerData.status)
        }
      } else {
        // No verification required
        setFlowState(isOrderBlocked ? FLOW_STATES.ORDER_BLOCKED : FLOW_STATES.READY_TO_SIGN)
      }
    } catch (err) {
      console.error('Error loading signer data:', err)
      setError(err.message || 'Error al cargar los datos')
      setFlowState(FLOW_STATES.UNAUTHORIZED)
    }
  }

  useEffect(() => {
    if (!signer?.verified_at || !deviceToken) return
    if (!signer.document?.requires_identity_verification || !signer.requires_verification) return
    if (signer.status !== 'VERIFIED') return

    const expiresAt = new Date(signer.verified_at).getTime() + VERIFICATION_TTL_MS
    const remaining = expiresAt - Date.now()

    if (remaining <= 0 || !isSessionValidForSigning(signer, deviceToken)) {
      setShowSigningModal(false)
      setSessionExpiryReason(getSessionInvalidReason(signer, deviceToken))
      setFlowState(FLOW_STATES.SESSION_EXPIRED)
      return
    }

    const timer = window.setTimeout(() => {
      setShowSigningModal(false)
      setSessionExpiryReason(SESSION_EXPIRE_REASONS.TTL)
      setFlowState(FLOW_STATES.SESSION_EXPIRED)
    }, remaining)

    return () => window.clearTimeout(timer)
  }, [signer?.verified_at, signer?.status, signer?.requires_verification, signer?.document?.requires_identity_verification, signer?.device_session_token, deviceToken])

  useEffect(() => {
    if (!signer?.id) return
    if (![FLOW_STATES.IN_REVIEW, FLOW_STATES.VERIFYING].includes(flowState)) return

    const intervalId = window.setInterval(() => {
      loadVerificationAttempt(signer.id, signer.status)
    }, 15000)

    return () => window.clearInterval(intervalId)
  }, [flowState, signer?.id, signer?.status])

  const loadVerificationAttempt = async (signerId, currentSignerStatus) => {
    try {
      const response = await callSigningRoom({
        action: 'get-latest-attempt',
        signingToken: transactionId,
        signerId
      })

      if (response?.attempt) {
        setVerificationAttempt(response.attempt)
        const statusCandidates = getStatusCandidates(
          response?.attempt?.status,
          response?.attempt?.verification_data?.status,
          response?.attempt?.verification_data?.decision?.status
        )

        if (statusCandidates.some(isRejectedStatus)) {
          if (currentSignerStatus !== 'VERIFICATION_FAILED') {
            await callSigningRoom({
              action: 'set-signer-status',
              signingToken: transactionId,
              signerId,
              status: 'VERIFICATION_FAILED'
            })
          }
          setFlowState(FLOW_STATES.VERIFICATION_FAILED)
          return
        }

        if (statusCandidates.some(isApprovedStatus)) {
          setFlowState(FLOW_STATES.REVIEW_APPROVED)
          return
        }

        if (statusCandidates.some(isReviewStatus)) {
          setFlowState(FLOW_STATES.IN_REVIEW)
          return
        }

        await loadVerificationDecision(response.attempt)
      }
    } catch (err) {
      console.error('Error loading verification attempt:', err)
    }
  }

  const loadVerificationDecision = async (attempt) => {
    try {
      const sessionId =
        attempt?.didit_session_id ||
        attempt?.session_id ||
        attempt?.sessionId

      if (!sessionId) return

      const decision = await DiditService.getSessionDecision(sessionId, signer?.id, transactionId)

      const statusValue =
        decision?.status ||
        decision?.decision?.status ||
        decision?.verification_status ||
        decision?.review_status

      if (isRejectedStatus(statusValue)) {
        if (signer?.id) {
          await callSigningRoom({
            action: 'set-signer-status',
            signingToken: transactionId,
            signerId: signer.id,
            status: 'VERIFICATION_FAILED'
          })
        }
        setFlowState(FLOW_STATES.VERIFICATION_FAILED)
        return
      }

      if (isApprovedStatus(statusValue)) {
        setFlowState(FLOW_STATES.REVIEW_APPROVED)
        return
      }

      if (isReviewStatus(statusValue)) {
        setFlowState(FLOW_STATES.IN_REVIEW)
      }
    } catch (err) {
      console.error('Error loading verification decision:', err)
    }
  }

  const handleStartVerification = async () => {
    try {
      setError(null)
      setVerificationLoading(true)
      const localToken = deviceToken || getOrCreateDeviceToken()
      setDeviceToken(localToken)

      if (signer?.device_session_token && signer.device_session_token !== localToken) {
        setSessionExpiryReason(SESSION_EXPIRE_REASONS.DEVICE_MISMATCH)
        setFlowState(FLOW_STATES.SESSION_EXPIRED)
        setError('Esta verificación está vinculada a otro navegador. Reinicia la verificación para continuar.')
        return
      }

      if (!signer?.device_session_token) {
        await callSigningRoom({
          action: 'bind-device-session',
          signingToken: transactionId,
          signerId: signer.id,
          deviceSessionToken: localToken
        })
      }

      // Start verification with Didit
      const callbackUrl = `${window.location.origin}/sign/${transactionId}?verified=true`
      const response = await DiditService.startVerification(
        signer.id,
        signer.email,
        signer.name,
        callbackUrl,
        transactionId
      )

      // Update signer status
      await callSigningRoom({
        action: 'set-signer-status',
        signingToken: transactionId,
        signerId: signer.id,
        status: 'VERIFYING'
      })

      // Redirect to Didit verification URL
      window.location.href = response.verificationUrl
    } catch (err) {
      console.error('Error starting verification:', err)
      setError(err.message || 'Error al iniciar la verificación')
    } finally {
      setVerificationLoading(false)
    }
  }

  const handleResetVerification = async () => {
    try {
      setError(null)
      setVerificationLoading(true)
      setShowSigningModal(false)
      setSessionExpiryReason(null)

      window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY)
      const newToken = crypto.randomUUID()
      window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, newToken)
      setDeviceToken(newToken)

      await callSigningRoom({
        action: 'reset-verification',
        signingToken: transactionId,
        signerId: signer.id
      })

      await callSigningRoom({
        action: 'bind-device-session',
        signingToken: transactionId,
        signerId: signer.id,
        deviceSessionToken: newToken
      })

      const callbackUrl = `${window.location.origin}/sign/${transactionId}?verified=true`
      const response = await DiditService.startVerification(
        signer.id,
        signer.email,
        signer.name,
        callbackUrl,
        transactionId
      )

      await callSigningRoom({
        action: 'set-signer-status',
        signingToken: transactionId,
        signerId: signer.id,
        status: 'VERIFYING'
      })

      window.location.href = response.verificationUrl
    } catch (err) {
      console.error('Error resetting verification:', err)
      setError(err.message || 'No pudimos reiniciar la verificación')
    } finally {
      setVerificationLoading(false)
    }
  }

  const handleRetryVerification = async () => {
    try {
      setError(null)

      // Reset signer status to allow retry
      await callSigningRoom({
        action: 'set-signer-status',
        signingToken: transactionId,
        signerId: signer.id,
        status: 'PENDING'
      })

      // Reload data
      await loadSignerData()
    } catch (err) {
      console.error('Error retrying verification:', err)
      setError(err.message || 'Error al reintentar')
    }
  }

  const handleDocumentCompleted = async () => {
    if (!signer?.id || !signer?.document_id) return

    try {
      setSigningSaving(true)
      await callSigningRoom({
        action: 'mark-signed',
        signingToken: transactionId,
        signerId: signer.id,
        deviceSessionToken: deviceToken || window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)
      })

      await loadSignerData()
    } catch (err) {
      console.error('Error updating signing status:', err)
      if (err?.message?.toLowerCase().includes('signing order')) {
        setError('Aún faltan firmantes anteriores por completar. Espera a que firmen primero.')
      } else {
        setError('No pudimos confirmar la firma. Refresca la página si el estado no se actualiza.')
      }
    } finally {
      setSigningSaving(false)
    }
  }

  // === RENDER STATES ===

  if (flowState === FLOW_STATES.LOADING) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin"></div>
          <p className="mt-3 text-sm text-slate-500">Cargando...</p>
        </div>
      </div>
    )
  }

  if (flowState === FLOW_STATES.UNAUTHORIZED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-3">
        <div className="max-w-sm w-full bg-white rounded-lg shadow-sm p-5">
          <div className="text-center">
            <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Link Inválido</h2>
            <p className="text-sm text-slate-500">
              {error || 'Este link no es válido o ha expirado. Contacta al administrador.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (flowState === FLOW_STATES.CANCELLED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-3">
        <div className="max-w-sm w-full bg-white rounded-lg shadow-sm p-5">
          <div className="text-center">
            <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Documento cancelado</h2>
            <p className="text-sm text-slate-500 mb-4">
              Este documento fue cancelado y ya no puede ser firmado.
            </p>
            <div className="text-xs text-slate-400">
              <p>Documento: <span className="font-medium text-slate-600">{document?.file_name}</span></p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (flowState === FLOW_STATES.EXPIRED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-3">
        <div className="max-w-sm w-full bg-white rounded-lg shadow-sm p-5">
          <div className="text-center">
            <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Documento Expirado</h2>
            <p className="text-sm text-slate-500 mb-4">
              El plazo para firmar ha expirado. Contacta al administrador.
            </p>
            <div className="text-xs text-slate-400">
              <p>Documento: <span className="font-medium text-slate-600">{document?.file_name}</span></p>
              <p>Expiró: {new Date(document?.signing_deadline).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (flowState === FLOW_STATES.ALREADY_SIGNED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-3">
        <div className="max-w-sm w-full bg-white rounded-lg shadow-sm p-5">
          <div className="text-center">
            <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Documento Firmado</h2>
            <p className="text-sm text-slate-500 mb-4">
              Ya has firmado este documento exitosamente.
            </p>
            <div className="bg-slate-50 rounded-md p-3 text-left">
              <p className="text-xs text-slate-400 mb-0.5">Documento</p>
              <p className="text-sm font-medium text-slate-700 mb-2">{document?.file_name}</p>
              <p className="text-xs text-slate-400 mb-0.5">Firmado el</p>
              <p className="text-sm font-medium text-slate-700">
                {signer?.signed_at ? new Date(signer.signed_at).toLocaleString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const normalizedHost = normalizeDocumensoHost(documensoHost)
  const rawTokenOrUrl =
    signer?.documenso_recipient_token ||
    signer?.signing_url ||
    signingUrlOverride
  const signingUrl = getDocumensoSigningUrl(rawTokenOrUrl, normalizedHost)
  const signingToken = getDocumensoToken(rawTokenOrUrl)
  const deadlineDate = document?.signing_deadline ? new Date(document.signing_deadline) : null
  const deadlineRemaining = formatRemaining(deadlineDate)
  const continuityUrl = verificationAttempt?.continuity_token
    ? `${window.location.origin}/sign/${transactionId}?continuity_token=${verificationAttempt.continuity_token}`
    : null

  const isVerificationFailed = flowState === FLOW_STATES.VERIFICATION_FAILED
  const isInReview = flowState === FLOW_STATES.IN_REVIEW
  const isReviewApproved = flowState === FLOW_STATES.REVIEW_APPROVED
  const isVerifying = flowState === FLOW_STATES.VERIFYING
  const isNeedsVerification = flowState === FLOW_STATES.NEEDS_VERIFICATION
  const isSessionExpired = flowState === FLOW_STATES.SESSION_EXPIRED
  const isReadyToSign = flowState === FLOW_STATES.READY_TO_SIGN
  const isOrderBlocked = flowState === FLOW_STATES.ORDER_BLOCKED
  const isSigned = flowState === FLOW_STATES.ALREADY_SIGNED

  const handleCopyContinuityLink = async () => {
    if (!continuityUrl) return
    try {
      await navigator.clipboard.writeText(continuityUrl)
      setContinuityCopied(true)
      window.setTimeout(() => setContinuityCopied(false), 1800)
    } catch (err) {
      console.error('Error copying continuity link:', err)
    }
  }

  const verificationStage = isVerificationFailed
    ? 'error'
    : isSessionExpired
      ? 'error'
      : (isInReview ? 'review' : isReviewApproved ? 'approved' : (isReadyToSign || isOrderBlocked || isSigned) ? 'done' : 'current')
  const signStage = isReadyToSign ? 'current' : isSigned ? 'done' : 'blocked'

  const verificationLabel = isVerificationFailed
    ? 'Fallida'
    : isSessionExpired
      ? 'Sesión no válida'
    : isInReview
      ? 'En revisión humana'
      : isReviewApproved
        ? 'Aprobada - Usa tu enlace'
        : isVerifying
          ? 'En progreso'
          : isNeedsVerification
            ? 'Pendiente'
            : 'Completada'
  const sessionReasonTitle =
    sessionExpiryReason === SESSION_EXPIRE_REASONS.TTL
      ? 'Ventana de firma vencida'
      : sessionExpiryReason === SESSION_EXPIRE_REASONS.DEVICE_MISMATCH
        ? 'Cambio de navegador detectado'
        : sessionExpiryReason === SESSION_EXPIRE_REASONS.TOKEN_MISSING
          ? 'No se pudo validar tu sesión'
          : 'Sesión no válida'
  const sessionReasonDescription =
    sessionExpiryReason === SESSION_EXPIRE_REASONS.TTL
      ? `La verificación se completó hace más de ${VERIFICATION_TTL_MINUTES} minutos.`
      : sessionExpiryReason === SESSION_EXPIRE_REASONS.DEVICE_MISMATCH
        ? 'La verificación se hizo en otro navegador o dispositivo.'
        : sessionExpiryReason === SESSION_EXPIRE_REASONS.TOKEN_MISSING
          ? 'No encontramos el identificador local de la verificación en este navegador.'
          : 'No pudimos confirmar que esta sesión sea válida para firmar.'
  const verificationReminder = signer?.verified_at
    ? getVerificationReminder(signer.verified_at, nowTs)
    : null

  // Calculate progress percentage
  // 0% = verification not done, 50% = verification done/in progress, 100% = document signed
  const progressPercentage = isSigned
    ? 100
    : (isReadyToSign || isOrderBlocked || isVerifying || isInReview || isReviewApproved)
      ? 50
      : 0

  return (
    <div className="min-h-screen bg-gray-100 p-3 py-6 flex items-center">
      <div className="relative max-w-xl mx-auto w-full">
        {/* Main card */}
        <div className="relative bg-white rounded-lg shadow-sm overflow-hidden">

          {/* Header section */}
          <div className="relative bg-gradient-to-b from-slate-700 to-slate-800 px-4 md:px-6 py-5 md:py-6">
            <div className="relative flex items-start justify-between gap-3 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <img src="/logo.png" alt="TrustGate" className="h-7 w-auto" />
                  <span className="brand-wordmark text-slate-200">TrustGate</span>
                </div>
                <h1 className="text-lg md:text-xl font-bold text-white mb-1 tracking-tight">
                  {tenantName ? `Firma tu documento de ${tenantName}` : 'Firma tu documento'}
                </h1>
                <p className="text-slate-300 text-sm">
                  {`Hola ${signer?.name || 'firmante'}, completa cada etapa para firmar de forma segura`}
                </p>
              </div>
              <button
                onClick={loadSignerData}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-600 hover:bg-slate-500 text-slate-200 text-xs font-medium transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Actualizar
              </button>
            </div>

            {/* Progress bar */}
            <div className="relative">
              <div className="flex justify-between text-xs font-medium text-slate-400 mb-1.5">
                <span>Progreso general</span>
                <span>{progressPercentage}%</span>
              </div>
              <div className="h-1.5 bg-slate-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-300 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Document info cards */}
          <div className="px-4 md:px-6 py-4 bg-slate-50 border-y border-slate-200">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-2.5 bg-white rounded-md px-3 py-2.5 border border-slate-200">
                <div className="w-8 h-8 rounded-md bg-slate-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Documento</p>
                  <p className="text-sm font-medium text-slate-800 truncate">{document?.file_name}</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 bg-white rounded-md px-3 py-2.5 border border-slate-200">
                <div className="w-8 h-8 rounded-md bg-slate-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Firmante</p>
                  <p className="text-sm font-medium text-slate-800 truncate">{signer?.name}</p>
                </div>
              </div>

              {deadlineDate && (
                <div className="flex items-center gap-2.5 bg-white rounded-md px-3 py-2.5 border border-slate-200 md:col-span-2">
                  <div className="w-8 h-8 rounded-md bg-slate-400 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Plazo</p>
                    <p className="text-sm font-medium text-slate-800">{deadlineRemaining || 'Vencido'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Steps section */}
          <div className="px-4 md:px-6 py-5">
            <div className="relative">
              <div className="space-y-5">
                {/* Step 1: Identity Verification */}
                <div className="relative">
                  <div className="flex gap-4">
                    {/* Step indicator */}
                    <div className="flex-shrink-0 relative">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm transition-all ${
                        verificationStage === 'done'
                          ? 'bg-emerald-500 text-white'
                          : verificationStage === 'approved'
                          ? 'bg-green-500 text-white'
                          : verificationStage === 'review'
                          ? 'bg-amber-400 text-white animate-pulse'
                          : verificationStage === 'error'
                          ? 'bg-red-500 text-white'
                          : verificationStage === 'current'
                          ? 'bg-slate-600 text-white'
                          : 'bg-slate-200 text-slate-500'
                      }`}>
                        {verificationStage === 'done' ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : verificationStage === 'approved' ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : '1'}
                      </div>
                    </div>

                    {/* Step content */}
                    <div className="flex-1 pb-5">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h2 className="text-base font-semibold text-slate-800">Verificación de identidad</h2>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded ${
                          verificationStage === 'done'
                            ? 'bg-emerald-50 text-emerald-600'
                            : verificationStage === 'approved'
                            ? 'bg-green-50 text-green-600'
                            : verificationStage === 'review'
                            ? 'bg-amber-50 text-amber-600'
                            : verificationStage === 'error'
                            ? 'bg-red-50 text-red-600'
                            : verificationStage === 'current'
                            ? 'bg-slate-600 text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${
                            verificationStage === 'done' ? 'bg-emerald-500' :
                            verificationStage === 'approved' ? 'bg-green-500' :
                            verificationStage === 'review' ? 'bg-amber-500 animate-pulse' :
                            verificationStage === 'error' ? 'bg-red-500' :
                            verificationStage === 'current' ? 'bg-white' : 'bg-slate-400'
                          }`}></span>
                          {verificationLabel}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          <img
                            src="https://cdn.brandfetch.io/id6uxz_U8z/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1762878035857"
                            alt="Didit"
                            className="h-2.5 w-auto"
                          />
                        </span>
                      </div>

                      {/* Description based on state */}
                      {!isInReview && !isReviewApproved && !redeemingToken && (
                        <div className="bg-slate-50 rounded-md p-3 mb-3">
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {isNeedsVerification && (
                              <>
                                <span className="font-semibold text-slate-700">Paso requerido:</span> Debes verificar tu identidad con un documento oficial antes de poder firmar.
                              </>
                            )}
                            {isVerifying && (
                              <>
                                <span className="font-semibold text-slate-700">En progreso:</span> Tu verificación está en curso. Completa el proceso en Didit para continuar.
                              </>
                            )}
                            {isVerificationFailed && (
                              <>
                                <span className="font-semibold text-red-600">Verificación fallida:</span> No pudimos verificar tu identidad. Intenta nuevamente con buena iluminación.
                              </>
                            )}
                            {isSessionExpired && (
                              <>
                                <span className="font-semibold text-amber-700">{sessionReasonTitle}.</span> {sessionReasonDescription} Por seguridad, para proteger tu identidad y la validez de la firma, reinicia la verificación en esta ventana y firma dentro de {VERIFICATION_TTL_MINUTES} minutos.
                              </>
                            )}
                            {(isReadyToSign || isSigned) && (
                              <>
                                <span className="font-semibold text-emerald-600">Verificación exitosa.</span> Tu identidad ha sido verificada correctamente.
                              </>
                            )}
                          </p>
                        </div>
                      )}

                      {error && (
                        <div className="bg-red-50 rounded-md p-2.5 mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0">
                              <div className="w-6 h-6 rounded-full bg-red-400 flex items-center justify-center">
                                <lord-icon
                                  src="https://cdn.lordicon.com/tdrtiskw.json"
                                  trigger="loop"
                                  colors="primary:#ffffff,secondary:#ffffff"
                                  style={{ width: '16px', height: '16px' }}
                                />
                              </div>
                            </div>
                            <p className="text-xs text-red-700 font-medium flex-1">{error}</p>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="space-y-2">
                        {isNeedsVerification && (
                          <button
                            onClick={handleStartVerification}
                            disabled={verificationLoading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-slate-600 hover:bg-slate-500 disabled:bg-slate-300 text-white font-medium text-sm transition-colors"
                          >
                            {verificationLoading ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Iniciando...
                              </>
                            ) : (
                              <>
                                <lord-icon
                                  src="https://cdn.lordicon.com/oqhlhtfq.json"
                                  trigger="hover"
                                  colors="primary:#ffffff,secondary:#ffffff"
                                  style={{ width: '18px', height: '18px' }}
                                />
                                Iniciar verificación de identidad
                              </>
                            )}
                          </button>
                        )}

                        {isSessionExpired && (
                          <button
                            onClick={handleResetVerification}
                            disabled={verificationLoading}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white font-medium text-sm transition-colors"
                          >
                            {verificationLoading ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Reiniciando...
                              </>
                            ) : (
                              'Reiniciar verificación de identidad'
                            )}
                          </button>
                        )}

                        {isVerifying && verificationAttempt?.verification_url && (
                          <button
                            onClick={() => window.location.href = verificationAttempt.verification_url}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-slate-600 hover:bg-slate-500 text-white font-medium text-sm transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Continuar verificación
                          </button>
                        )}

                        {isVerificationFailed && (
                          <button
                            onClick={handleRetryVerification}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-red-500 hover:bg-red-600 text-white font-medium text-sm transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Reintentar verificación
                          </button>
                        )}

                        {isInReview && (
                          <div className="bg-amber-50 rounded-md p-2.5">
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0">
                                <div className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center">
                                  <svg className="w-3 h-3 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </div>
                              </div>
                              <div className="flex-1">
                                <p className="font-semibold text-amber-800 text-xs mb-0.5">Revisión en curso</p>
                                <p className="text-[11px] text-amber-700 mb-2">
                                  Tu verificación requiere una revisión manual. Un especialista validará tu identidad y te avisaremos en cuanto esté lista para continuar.
                                </p>

                                {continuityUrl && (
                                  <div className="mt-2 p-2 bg-amber-100 rounded border border-amber-200">
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <p className="text-[10px] text-amber-800 font-semibold">Guarda tu enlace de continuidad</p>
                                        <p className="text-[10px] text-amber-700">Lo necesitarás para volver cuando termine la revisión.</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {continuityCopied && (
                                          <span className="text-[10px] text-amber-700 font-medium">Enlace copiado</span>
                                        )}
                                        <button
                                          onClick={handleCopyContinuityLink}
                                          className="px-2.5 py-1 text-[10px] bg-amber-500 hover:bg-amber-600 text-white rounded font-medium"
                                        >
                                          Copiar enlace
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {isReviewApproved && (
                          <div className="bg-green-50 rounded-md p-2.5">
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0">
                                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              </div>
                              <div className="flex-1">
                                <p className="font-semibold text-green-800 text-xs mb-0.5">¡Verificación aprobada!</p>
                                <p className="text-[11px] text-green-700 mb-2">Tu identidad ha sido verificada. Usa el enlace que guardaste para continuar con la firma.</p>

                                {continuityUrl && (
                                  <div className="mt-2 p-2 bg-green-100 rounded border border-green-200">
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <p className="text-[10px] text-green-800 font-semibold">Tu enlace está listo</p>
                                        <p className="text-[10px] text-green-700">Haz clic para continuar o cópialo.</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={handleCopyContinuityLink}
                                          className="px-2.5 py-1 text-[10px] bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded font-medium"
                                        >
                                          Copiar
                                        </button>
                                        <button
                                          onClick={() => {
                                            handleCopyContinuityLink()
                                            window.location.href = continuityUrl
                                          }}
                                          className="px-2.5 py-1 text-[10px] bg-green-500 hover:bg-green-600 text-white rounded font-medium"
                                        >
                                          Continuar
                                        </button>
                                      </div>
                                      {continuityCopied && (
                                        <span className="text-[10px] text-green-700 font-medium">Enlace copiado</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {!verificationAttempt?.continuity_token && (
                                  <p className="text-[10px] text-green-600 italic">
                                    Si perdiste el enlace, revisa tu correo electrónico.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {redeemingToken && (
                          <div className="bg-slate-50 rounded-md p-2.5">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 animate-spin text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <p className="text-xs text-slate-600">Validando token de continuidad...</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Document Signing */}
                <div className="relative">
                  <div className="flex gap-4">
                    {/* Step indicator */}
                    <div className="flex-shrink-0 relative">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm transition-all ${
                        signStage === 'done'
                          ? 'bg-emerald-500 text-white'
                          : signStage === 'current'
                          ? 'bg-slate-600 text-white'
                          : 'bg-slate-200 text-slate-500'
                      }`}>
                        {signStage === 'done' ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : '2'}
                      </div>
                      {signStage === 'blocked' && (
                        <div className="absolute -right-0.5 -top-0.5 w-3.5 h-3.5 bg-slate-400 rounded-full flex items-center justify-center">
                          <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h2 className="text-base font-semibold text-slate-800">Firma del documento</h2>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded ${
                          signStage === 'done'
                            ? 'bg-emerald-50 text-emerald-600'
                            : signStage === 'current'
                            ? 'bg-slate-600 text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          <span className={`w-1 h-1 rounded-full ${
                            signStage === 'done' ? 'bg-emerald-500' :
                            signStage === 'current' ? 'bg-white' : 'bg-slate-400'
                          }`}></span>
                          {isReadyToSign ? 'Habilitada' : isOrderBlocked || isSessionExpired ? 'Bloqueada' : isSigned ? 'Completada' : 'Pendiente'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          <img
                            src="https://cdn.brandfetch.io/idf_kAp5WV/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1689173015999"
                            alt="Documenso"
                            className="h-2.5 w-auto"
                          />
                        </span>
                      </div>

                      {/* Description */}
                      <div className={`rounded-md p-3 mb-3 ${
                        isReadyToSign
                          ? 'bg-emerald-50'
                          : 'bg-slate-50'
                      }`}>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {isReadyToSign ? (
                            <>
                              <span className="font-semibold text-emerald-600">Listo para firmar.</span> Tu identidad ha sido verificada.
                            </>
                          ) : isOrderBlocked ? (
                            <>
                              <span className="font-semibold text-slate-700">Firma en orden.</span> Espera a que los firmantes anteriores completen su firma.
                            </>
                          ) : isSessionExpired ? (
                            <>
                              <span className="font-semibold text-amber-700">Firma bloqueada:</span> {sessionReasonTitle.toLowerCase()}. Completa nuevamente la verificación para habilitar la firma.
                            </>
                          ) : (
                            <>
                              Completa la verificación de identidad antes de firmar.
                            </>
                          )}
                        </p>
                        {isOrderBlocked && (signingOrder?.pending?.length || 0) > 0 && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Pendientes: {signingOrder.pending.map((pendingSigner) => pendingSigner.name || pendingSigner.email).filter(Boolean).join(', ')}
                          </p>
                        )}
                        {isReadyToSign && signer?.verified_at && (
                          <p className="mt-1 text-[11px] text-emerald-700">
                            Tienes {formatVerificationRemaining(signer.verified_at, nowTs)} para firmar.
                          </p>
                        )}
                        {isReadyToSign && verificationReminder && (
                          <p className={`mt-1 text-[11px] ${
                            verificationReminder.tone === 'critical'
                              ? 'text-red-700'
                              : verificationReminder.tone === 'warning'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                          }`}>
                            {verificationReminder.text}
                          </p>
                        )}
                      </div>

                      {/* Signing interface */}
                      {isReadyToSign && (
                        <div className="space-y-2">
                          {signingToken ? (
                            <button
                              onClick={() => {
                                if (!isSessionValidForSigning(signer, deviceToken)) {
                                  setSessionExpiryReason(getSessionInvalidReason(signer, deviceToken))
                                  setFlowState(FLOW_STATES.SESSION_EXPIRED)
                                  setError('Tu sesión de verificación ya no es válida. Reinicia la verificación para continuar.')
                                  return
                                }
                                setShowSigningModal(true)
                              }}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-sm transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20h9" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                              </svg>
                              Firmar documento
                            </button>
                          ) : (
                            <div className="bg-red-50 rounded-md p-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-shrink-0">
                                  <div className="w-5 h-5 rounded-full bg-red-400 flex items-center justify-center">
                                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </div>
                                </div>
                                <div className="flex-1">
                                  <p className="font-semibold text-red-700 text-xs">Error de configuración</p>
                                  <p className="text-[11px] text-red-600">
                                    No se encontró token de firma. Contacta al administrador.
                                  </p>
                                  {signingUrl && (
                                    <button
                                      onClick={() => window.location.href = signingUrl}
                                      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-red-700 hover:text-red-800"
                                    >
                                      Abrir en Documenso
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          {signingSaving && (
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Actualizando estado de firma...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 md:px-6 py-2.5 bg-gradient-to-b from-slate-600 to-slate-700">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-300">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="font-medium">Firma segura con verificación de identidad</span>
            </div>
          </div>
        </div>
      </div>

      {showSigningModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70"
          onClick={() => setShowSigningModal(false)}
        >
          <button
            onClick={() => setShowSigningModal(false)}
            className="fixed top-3 right-3 z-50 w-10 h-10 rounded-full bg-white/90 backdrop-blur border border-white/60 shadow-lg flex items-center justify-center text-slate-600 hover:text-slate-800 hover:bg-white"
            aria-label="Cerrar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="absolute inset-3 md:inset-6">
            <div
              className="h-full w-full bg-white rounded-lg shadow-xl overflow-hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <EmbedSignDocument
                token={signingToken}
                host={normalizedHost || undefined}
                name={signer?.name}
                lockName
                className="w-full h-full"
                onDocumentCompleted={handleDocumentCompleted}
                onDocumentError={(message) => {
                  setError(`Error al firmar: ${message}`)
                }}
                onDocumentRejected={(data) => {
                  setError(`Documento rechazado: ${data.reason}`)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SigningRoom
