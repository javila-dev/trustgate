import { useState, useEffect, useRef } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'
import DiditService from '../services/didit.service'
import DocumensoService from '../services/documenso.service'
import AuditPackageService from '../services/audit-package.service'
import NewDocumentModal from '../components/NewDocumentModal'
import PDFFieldPositioner from '../components/PDFFieldPositioner'

const DocumentDetail = () => {
  const { documentId } = useParams()
  const navigate = useNavigate()
  const { addToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [document, setDocument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [auditSessionId, setAuditSessionId] = useState(null)
  const [signerSessions, setSignerSessions] = useState({})
  const [signerContinuityTokens, setSignerContinuityTokens] = useState({})
  const [signerAttempts, setSignerAttempts] = useState({})
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const downloadMenuRef = useRef(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [documensoLoading, setDocumensoLoading] = useState(false)
  const [auditReportLoading, setAuditReportLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [createdByLabel, setCreatedByLabel] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userId, setUserId] = useState(null)
  const [userRole, setUserRole] = useState('tenant_member')
  const [tenantRole, setTenantRole] = useState('tenant_member')
  const [tenantName, setTenantName] = useState('')
  const [userContextLoaded, setUserContextLoaded] = useState(false)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [reviewSigner, setReviewSigner] = useState(null)
  const [reviewWarnings, setReviewWarnings] = useState([])
  const [reviewEvidence, setReviewEvidence] = useState({ faceMatches: [], identityImages: [], livenessImages: [] })
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewRefreshing, setReviewRefreshing] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [showSignaturePreview, setShowSignaturePreview] = useState(false)
  const [signatureFields, setSignatureFields] = useState([])
  const [signaturePdfUrl, setSignaturePdfUrl] = useState('')

  useEffect(() => {
    if (!downloadMenuOpen) return

    const handleClickOutside = (event) => {
      if (!downloadMenuRef.current || downloadMenuRef.current.contains(event.target)) return
      setDownloadMenuOpen(false)
    }

    window.document.addEventListener('mousedown', handleClickOutside)
    return () => window.document.removeEventListener('mousedown', handleClickOutside)
  }, [downloadMenuOpen])
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  useEffect(() => {
    fetchDocument()
    fetchAuditLog()
    loadCurrentUser()
  }, [documentId])

  // Check access permissions - members can only view their own documents
  useEffect(() => {
    if (!userContextLoaded || loading) return
    if (document && userId && tenantRole) {
      const isAdmin = tenantRole === 'tenant_admin' || userRole === 'platform_admin'
      const isOwner = document.created_by === userId

      if (!isAdmin && !isOwner) {
        addToast('No tienes permiso para ver este documento', { type: 'error' })
        navigate('/')
      }
    }
  }, [document, userId, tenantRole, userRole, loading, userContextLoaded])

  const loadCurrentUser = async () => {
    try {
      setUserContextLoaded(false)
      const { data } = await supabase.auth.getSession()
      const session = data?.session
      if (!session?.user?.email) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('role, tenant:tenants(name)')
        .eq('user_id', session.user.id)
        .single()

      setUserId(session.user.id)
      setUserEmail(session.user.email)
      setTenantRole(tenantUser?.role || 'tenant_member')
      setUserRole(profile?.role === 'platform_admin' ? 'platform_admin' : (tenantUser?.role || 'tenant_member'))
      setTenantName(tenantUser?.tenant?.name || '')
    } finally {
      setUserContextLoaded(true)
    }
  }

  const fetchDocument = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('documents')
        .select(`
          *,
          signers:document_signers(
            id,
            name,
            email,
            status,
            signing_order,
            role,
            signing_token,
            requires_verification,
            signed_at,
            verified_at,
            fields:signer_fields(
              id,
              signer_id,
              field_type,
              page,
              position_x,
              position_y,
              width,
              height,
              is_required
            )
          )
        `)
        .eq('id', documentId)
        .single()

      if (error) throw error
      setDocument(data)
      if (data?.signers?.length) {
        const loadedFields = []
        data.signers.forEach((signer) => {
          if (signer.fields && signer.fields.length > 0) {
            signer.fields.forEach((field) => {
              loadedFields.push({
                id: field.id,
                signerId: signer.id,
                type: field.field_type,
                page: field.page,
                positionX: field.position_x,
                positionY: field.position_y,
                width: field.width,
                height: field.height,
                isRequired: field.is_required
              })
            })
          }
        })
        setSignatureFields(loadedFields)
      } else {
        setSignatureFields([])
      }
      if (data?.created_by) {
        const { data: creator } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', data.created_by)
          .single()

        const displayName = creator?.full_name?.trim()
        const displayEmail = creator?.email?.trim()
        setCreatedByLabel(displayName || displayEmail || `Usuario ${data.created_by.slice(0, 8)}`)
      } else {
        setCreatedByLabel('')
      }
    } catch (error) {
      console.error('Error fetching document:', error)
      addToast('Error al cargar el documento', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const fetchAuditLog = async () => {
    try {
      setAuditLoading(true)
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      setAuditEvents(data || [])

      // Check for verification session
      const { data: doc } = await supabase
        .from('documents')
        .select('signers:document_signers(id)')
        .eq('id', documentId)
        .single()

      if (doc?.signers?.length > 0) {
        const { data: attemptRows } = await supabase
          .from('verification_attempts')
          .select('signer_id, didit_session_id, continuity_token, continuity_token_expires_at, status, was_in_review')
          .in('signer_id', doc.signers.map(s => s.id))
          .order('created_at', { ascending: false })

        if (attemptRows?.length) {
          const sessionMap = attemptRows.reduce((acc, row) => {
            if (row.signer_id && row.didit_session_id && !acc[row.signer_id]) {
              acc[row.signer_id] = row.didit_session_id
            }
            return acc
          }, {})
          setSignerSessions(sessionMap)
          setSignerAttempts(attemptRows.reduce((acc, row) => {
            if (row.signer_id && row.didit_session_id && !acc[row.signer_id]) {
              acc[row.signer_id] = row
            }
            return acc
          }, {}))
          const firstSession = attemptRows.find(row => row.didit_session_id)?.didit_session_id
          if (firstSession) setAuditSessionId(firstSession)

          // Build continuity token map for signers in review
          const tokenMap = attemptRows.reduce((acc, row) => {
            if (row.signer_id && row.continuity_token && !acc[row.signer_id]) {
              acc[row.signer_id] = {
                token: row.continuity_token,
                expiresAt: row.continuity_token_expires_at,
                status: row.status,
                wasInReview: row.was_in_review
              }
            }
            return acc
          }, {})
          setSignerContinuityTokens(tokenMap)
        }
      }
    } catch (error) {
      console.error('Error fetching audit log:', error)
    } finally {
      setAuditLoading(false)
    }
  }

  const copySigningLink = (signingToken) => {
    const url = `${window.location.origin}/sign/${signingToken}`
    navigator.clipboard.writeText(url)
    addToast('Link copiado al portapapeles', { type: 'success' })
  }

  const copyContinuityLink = (signingToken, continuityToken) => {
    const url = `${window.location.origin}/sign/${signingToken}?continuity_token=${continuityToken}`
    navigator.clipboard.writeText(url)
    addToast('Link de continuidad copiado', { type: 'success' })
  }

  const downloadVerificationPdf = async (sessionId) => {
    if (!sessionId) return
    try {
      setPdfLoading(true)
      const blob = await DiditService.generatePdf(sessionId)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `verification-${sessionId}.pdf`
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      addToast('PDF descargado correctamente', { type: 'success' })
    } catch (error) {
      addToast(`Error al descargar PDF: ${error.message}`, { type: 'error' })
    } finally {
      setPdfLoading(false)
    }
  }

  const downloadDocumensoPdf = async () => {
    if (!document?.documenso_envelope_id) {
      addToast('Este documento no está en Documenso', { type: 'error' })
      return
    }

    try {
      setDocumensoLoading(true)
      const { blob, fileName } = await DocumensoService.downloadCompletedDocument(
        document.documenso_envelope_id
      )
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = fileName || 'documento-firmado.pdf'
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      addToast('Documento descargado correctamente', { type: 'success' })
    } catch (error) {
      addToast(`Error al descargar documento: ${error.message}`, { type: 'error' })
    } finally {
      setDocumensoLoading(false)
    }
  }

  const downloadOriginalDocument = async () => {
    if (!document?.file_url) {
      addToast('No se encontró el archivo original', { type: 'error' })
      return
    }

    try {
      const downloadUrl = await getDocumentDownloadUrl()
      if (!downloadUrl) throw new Error('No se pudo generar el enlace de descarga')
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        throw new Error(`No se pudo descargar el archivo original (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.file_name || 'documento-original.pdf'
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      addToast('Documento original descargado', { type: 'success' })
    } catch (error) {
      addToast(`Error al descargar original: ${error.message}`, { type: 'error' })
    }
  }

  const getDocumentDownloadUrl = async () => {
    if (!document?.file_url) return null

    if (document.file_url.startsWith('http')) {
      return document.file_url
    }

    const bucket = 'documents'
    const rawPath = document.file_url
    const publicPrefix = `/storage/v1/object/public/${bucket}/`
    const privatePrefix = `/storage/v1/object/${bucket}/`
    const path = rawPath
      .replace(publicPrefix, '')
      .replace(privatePrefix, '')
      .replace(`/${bucket}/`, '')
      .replace(/^\/+/, '')

    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(path, 60 * 10)

    if (error) {
      console.error('Error creating signed url:', error)
      return null
    }
    return data?.signedUrl || null
  }


  const FEATURE_MAP = {
    ID_VERIFICATION: { key: 'id_verifications', label: 'Verificación de identidad' },
    NFC: { key: 'nfc_verifications', label: 'NFC / Chip' },
    LIVENESS: { key: 'liveness_checks', label: 'Prueba de vida' },
    FACE_MATCH: { key: 'face_matches', label: 'Coincidencia facial' },
    POA: { key: 'poa_verifications', label: 'Comprobante de domicilio' },
    PHONE: { key: 'phone_verifications', label: 'Verificación de teléfono' },
    DATABASE_VALIDATION: { key: 'database_validations', label: 'Validación en bases' },
    AML: { key: 'aml_checks', label: 'Listas AML' },
    IP_ANALYSIS: { key: 'ip_analysis', label: 'Análisis de IP' },
    EMAIL: { key: 'email_verifications', label: 'Verificación de email' }
  }

  const getReviewPayload = (sessionDetail = {}) => {
    if (sessionDetail?.decision && typeof sessionDetail.decision === 'object') {
      return sessionDetail.decision
    }
    return sessionDetail
  }

  const extractWarnings = (sessionDetail = {}) => {
    const payload = getReviewPayload(sessionDetail)
    const features = Array.isArray(payload.features) ? payload.features : []
    const grouped = []

    features.forEach((feature) => {
      const config = FEATURE_MAP[feature]
      if (!config) return
      const items = payload[config.key]
      if (!Array.isArray(items)) return
      const warnings = []

      items.forEach((item) => {
        const score =
          item?.score ??
          item?.similarity_score ??
          item?.similarity_percentage ??
          item?.front_image_camera_front_face_match_score ??
          item?.back_image_camera_front_face_match_score ??
          null

        const itemWarnings = Array.isArray(item?.warnings) ? item.warnings : []
        itemWarnings.forEach((warning) => {
          warnings.push({
            risk: warning.risk,
            shortDescription: warning.short_description || warning.shortDescription,
            longDescription: warning.long_description || warning.longDescription,
            logType: warning.log_type || warning.logType,
            score
          })
        })
      })

      if (warnings.length > 0) {
        grouped.push({
          feature,
          label: config.label,
          warnings
        })
      }
    })

    return grouped
  }

  const extractReviewEvidence = (sessionDetail = {}) => {
    const payload = getReviewPayload(sessionDetail)

    const faceMatches = Array.isArray(payload.face_matches)
      ? payload.face_matches
          .filter((item) => item?.source_image || item?.target_image)
          .map((item, idx) => ({
            id: `${idx}-${item?.node_id || 'face'}`,
            score: item?.score ?? item?.similarity_score ?? item?.similarity_percentage ?? null,
            sourceImage: item?.source_image || null,
            targetImage: item?.target_image || null,
            risk: Array.isArray(item?.warnings) ? item.warnings.map((w) => w?.risk).filter(Boolean) : []
          }))
      : []

    const identityImages = Array.isArray(payload.id_verifications)
      ? payload.id_verifications
          .flatMap((item, idx) => ([
            { id: `${idx}-front`, label: 'Documento frente', url: item?.front_image || item?.full_front_image || null },
            { id: `${idx}-back`, label: 'Documento reverso', url: item?.back_image || item?.full_back_image || null },
            { id: `${idx}-portrait`, label: 'Retrato del documento', url: item?.portrait_image || null }
          ]))
          .filter((item) => !!item.url)
      : []

    const livenessImages = Array.isArray(payload.liveness_checks)
      ? payload.liveness_checks
          .map((item, idx) => ({
            id: `${idx}-liveness-ref`,
            label: 'Selfie / Referencia',
            url: item?.reference_image || null
          }))
          .filter((item) => !!item.url)
      : []

    return { faceMatches, identityImages, livenessImages }
  }

  const loadReviewData = async (signer) => {
    const sessionId = signerSessions[signer.id]
    if (!sessionId) {
      addToast('No se encontró la sesión de verificación', { type: 'error' })
      return false
    }

    try {
      setReviewWarnings([])
      setReviewEvidence({ faceMatches: [], identityImages: [], livenessImages: [] })
      const detail = await DiditService.getSessionDetail(sessionId)
      const warnings = extractWarnings(detail)
      const evidence = extractReviewEvidence(detail)
      setReviewWarnings(warnings)
      setReviewEvidence(evidence)
      return true
    } catch (error) {
      addToast(`Error al cargar la revisión: ${error.message}`, { type: 'error' })
      return false
    }
  }

  const handleRefreshReviewData = async () => {
    if (!reviewSigner) return
    try {
      setReviewRefreshing(true)
      const ok = await loadReviewData(reviewSigner)
      if (ok) {
        addToast('Evidencia recargada', { type: 'success' })
      }
    } finally {
      setReviewRefreshing(false)
    }
  }

  const handleOpenReview = async (signer) => {
    try {
      setReviewLoading(true)
      setReviewComment('')
      setReviewSigner(signer)
      setReviewModalOpen(true)
      await loadReviewData(signer)
    } finally {
      setReviewLoading(false)
    }
  }

  const handleManualDecision = async (decision) => {
    if (!reviewSigner) return
    if (!reviewComment.trim()) {
      addToast('Debes agregar un comentario antes de continuar', { type: 'error' })
      return
    }

    const sessionId = signerSessions[reviewSigner.id]
    if (!sessionId) {
      addToast('No se encontró la sesión de verificación', { type: 'error' })
      return
    }

    try {
      setReviewSubmitting(true)
      const newStatus = decision === 'approve' ? 'Approved' : 'Declined'
      await DiditService.updateSessionStatus(sessionId, newStatus, reviewComment.trim())

      const { data: attempt } = await supabase
        .from('verification_attempts')
        .select('*')
        .eq('signer_id', reviewSigner.id)
        .eq('didit_session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const manualPayload = {
        manual_review: {
          decision: decision === 'approve' ? 'approved' : 'declined',
          comment: reviewComment.trim(),
          actor_id: userId,
          decided_at: new Date().toISOString()
        }
      }

      await supabase
        .from('verification_attempts')
        .update({
          status: decision === 'approve' ? 'REVIEW_APPROVED' : 'FAILED',
          completed_at: new Date().toISOString(),
          verification_data: {
            ...(attempt?.verification_data || {}),
            ...manualPayload
          }
        })
        .eq('id', attempt?.id)

      await supabase
        .from('document_signers')
        .update({
          status: decision === 'approve' ? 'REVIEW_APPROVED' : 'VERIFICATION_FAILED'
        })
        .eq('id', reviewSigner.id)

      await supabase
        .from('audit_log')
        .insert({
          document_id: document?.id,
          signer_id: reviewSigner.id,
          event_type: decision === 'approve' ? 'verification_manual_approved' : 'verification_manual_declined',
          description: `El usuario ${userEmail || 'desconocido'} ${decision === 'approve' ? 'aprobó' : 'rechazó'} la revisión manual requerida de identidad`,
          actor_type: 'admin',
          actor_id: userId,
          event_data: {
            session_id: sessionId,
            comment: reviewComment.trim()
          }
        })

      addToast(`Revisión ${decision === 'approve' ? 'aprobada' : 'rechazada'} correctamente`, { type: 'success' })
      setReviewModalOpen(false)
      fetchDocument()
      fetchAuditLog()
    } catch (error) {
      addToast(`Error al ${decision === 'approve' ? 'aprobar' : 'rechazar'} la revisión: ${error.message}`, { type: 'error' })
    } finally {
      setReviewSubmitting(false)
    }
  }

  const exportAuditReportPdf = async () => {
    try {
      setAuditReportLoading(true)

      // Build list of Didit session IDs with signer names
      const diditSessionIds = (document.signers || [])
        .filter(signer => signer.requires_verification && signerSessions[signer.id])
        .map(signer => ({
          sessionId: signerSessions[signer.id],
          signerName: signer.name || 'firmante'
        }))

      const { fileName, errors } = await AuditPackageService.downloadAuditPackage({
        document,
        signers: document.signers || [],
        auditEvents,
        tenantName,
        diditSessionIds
      })

      if (errors.length > 0) {
        addToast(`Paquete generado con advertencias: ${errors.join(', ')}`, { type: 'warning' })
      } else {
        addToast(`Paquete de auditoria descargado: ${fileName}`, { type: 'success' })
      }
    } catch (error) {
      addToast(`Error al generar paquete: ${error.message}`, { type: 'error' })
    } finally {
      setAuditReportLoading(false)
    }
  }

  const handleCancelEnvelope = async () => {
    if (!document) return

    try {
      setCancelLoading(true)

      if (document.documenso_envelope_id) {
        await DocumensoService.deleteEnvelope(document.documenso_envelope_id, document.tenant_id)
      }

      await supabase
        .from('documents')
        .update({
          status: 'CANCELLED',
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', document.id)

      await supabase
        .from('document_signers')
        .update({ status: 'CANCELLED' })
        .eq('document_id', document.id)
        .neq('status', 'SIGNED')

      await supabase
        .from('audit_log')
        .insert({
          document_id: document.id,
          event_type: 'document_cancelled',
          description: `El documento fue cancelado por ${userEmail || 'usuario'}`,
          actor_type: 'admin',
          actor_id: userId,
          event_data: {
            documenso_envelope_id: document.documenso_envelope_id || null
          }
        })

      addToast('Documento cancelado', { type: 'success' })
      fetchDocument()
      fetchAuditLog()
    } catch (error) {
      addToast(`Error al cancelar documento: ${error.message}`, { type: 'error' })
    } finally {
      setCancelLoading(false)
    }
  }

  const canEdit = () => {
    if (!document) return false
    if (document.status === 'DRAFT') return true
    if (!document.signers || document.signers.length === 0) return true
    return !document.signers.some(s => s.status === 'SIGNED')
  }

  const canCancel = () => {
    if (!document) return false
    if (document.status === 'COMPLETED' || document.status === 'CANCELLED') return false
    const isAdmin = tenantRole === 'tenant_admin' || userRole === 'platform_admin'
    const isOwner = document.created_by === userId
    if (!isAdmin && !isOwner) return false
    return true
  }

  const getStatusConfig = (status) => {
    const configs = {
      DRAFT: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Borrador', dot: 'bg-slate-400' },
      PENDING: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pendiente', dot: 'bg-amber-500' },
      IN_PROGRESS: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'En progreso', dot: 'bg-blue-500 animate-pulse' },
      COMPLETED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completado', dot: 'bg-emerald-500' },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelado', dot: 'bg-red-500' },
      EXPIRED: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Expirado', dot: 'bg-orange-500' }
    }
    return configs[status] || configs.DRAFT
  }

  const getSignerStatusConfig = (status) => {
    const configs = {
      PENDING: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pendiente', icon: 'clock' },
      READY: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Listo para firmar', icon: 'pen' },
      VERIFYING: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Verificando', icon: 'shield' },
      IN_REVIEW: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'En revisión manual', icon: 'eye' },
      REVIEW_APPROVED: { bg: 'bg-green-100', text: 'text-green-700', label: 'Aprobado (esperando)', icon: 'check-circle' },
      VERIFIED: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Verificado', icon: 'check-shield' },
      SIGNED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Firmado', icon: 'check' },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelado', icon: 'ban' }
    }
    return configs[status] || configs.PENDING
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatShortDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-slate-600 font-medium">Cargando documento...</p>
        </div>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-5 bg-slate-100 rounded-2xl flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-lg text-slate-700 font-semibold mb-1">Documento no encontrado</p>
          <p className="text-sm text-slate-500 mb-6">El documento que buscas no existe o fue eliminado</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-all"
          >
            Volver al dashboard
          </Link>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(document.status)
  const signedCount = document.signers?.filter(s => s.status === 'SIGNED').length || 0
  const totalSigners = document.signers?.length || 0
  const allSigned = totalSigners > 0 && signedCount === totalSigners
  const sortedSigners = (document.signers || [])
    .slice()
    .sort((a, b) => {
      const aOrder = a.signing_order ?? 1
      const bOrder = b.signing_order ?? 1
      if (aOrder !== bOrder) return aOrder - bOrder
      const aName = a.name || ''
      const bName = b.name || ''
      return aName.localeCompare(bName)
    })
  const progressPercent = totalSigners > 0 ? (signedCount / totalSigners) * 100 : 0

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Same as Dashboard */}
      <aside className={`
        fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50
        w-72 bg-white border-r border-slate-200/60
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:h-screen flex flex-col shadow-xl lg:shadow-none
      `}>
        {/* Logo/Brand */}
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shadow-lg shadow-emerald-200">
              <img src="/logo.png" alt="TrustGate" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="brand-wordmark text-slate-900">TrustGate</h1>
              <p className="text-xs text-slate-400">{tenantName || 'Firma digital segura'}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 pb-4 space-y-1 overflow-y-auto">
          <p className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Principal</p>

          <Link to="/" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
            <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <span className="font-medium">Dashboard</span>
          </Link>

          <Link to="/?section=documents" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
            <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-medium">Documentos</span>
          </Link>

          <Link to="/" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
            <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className="font-medium">Usuarios</span>
          </Link>

          {(tenantRole === 'tenant_admin' || userRole === 'platform_admin') && (
            <>
              <div className="pt-4">
                <p className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Configuración</p>
              </div>

              {tenantRole === 'tenant_admin' && (
                <Link to="/integrations" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
                  <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="font-medium">Integraciones</span>
                </Link>
              )}

              {tenantRole === 'tenant_admin' && (
                <Link to="/organization" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
                  <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3zm8 3a8 8 0 11-16 0 8 8 0 0116 0z" />
                    </svg>
                  </div>
                  <span className="font-medium">Cuenta</span>
                </Link>
              )}

              {userRole === 'platform_admin' && (
                <Link to="/admin" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
                  <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l8 4v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V7l8-4z" />
                    </svg>
                  </div>
                  <span className="font-medium">Admin</span>
                </Link>
              )}
            </>
          )}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center text-white font-semibold text-sm shadow-sm">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{userEmail || 'Usuario'}</p>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 uppercase">
                  {userRole === 'platform_admin' ? 'superadmin' : userRole === 'tenant_admin' ? 'admin' : 'member'}
                </span>
                <span className="text-xs text-slate-400">Sesión activa</span>
              </div>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                navigate('/login')
              }}
              className="btn btn-ghost btn-xs"
            >
              Salir
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50/50">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white/80 backdrop-blur-sm border-b border-slate-200/60 p-4 sticky top-0 z-30">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-bold text-slate-900">{document.file_name}</span>
            <div className="w-10"></div>
          </div>
        </header>

        {/* Page Header */}
        <div className="bg-white border-b border-slate-200/60">
          <div className="px-6 lg:px-10 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => navigate('/')}
                  className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-slate-900">{document.file_name}</h1>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg ${statusConfig.bg} ${statusConfig.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`}></span>
                      {statusConfig.label}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {createdByLabel ? (
                      <>
                        Creado por <span className="font-semibold text-slate-700">{createdByLabel}</span> el{' '}
                        <span className="font-semibold text-slate-700">{formatDate(document.created_at)}</span>
                      </>
                    ) : (
                      <>
                        Creado el <span className="font-semibold text-slate-700">{formatDate(document.created_at)}</span>
                      </>
                    )}{' '}
                    · ID: {document.id.slice(0, 8)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {document.status === 'COMPLETED' && (
                  <button
                    onClick={exportAuditReportPdf}
                    disabled={auditReportLoading}
                    className="btn btn-outline btn-sm gap-2"
                    title="Descarga un paquete ZIP con el certificado de auditoria, verificacion de identidad y documento firmado"
                  >
                    {auditReportLoading ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    )}
                    Paquete de auditoria
                  </button>
                )}
                <button
                  onClick={async () => {
                    const url = await getDocumentDownloadUrl()
                    if (!url) {
                      addToast('No se pudo cargar el PDF', { type: 'error' })
                      return
                    }
                    setSignaturePdfUrl(url)
                    setShowSignaturePreview(true)
                  }}
                  disabled={signatureFields.length === 0 || !document.file_url}
                  className="btn btn-outline btn-sm gap-2"
                  title={signatureFields.length === 0 ? 'No hay campos de firma para mostrar' : 'Ver firmas'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Ver firmas
                </button>
                <div className="relative" ref={downloadMenuRef}>
                  <button
                    onClick={() => setDownloadMenuOpen((prev) => !prev)}
                    className="btn btn-outline btn-sm gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Descargar
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {downloadMenuOpen && (
                    <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg p-2 z-30">
                      <button
                        onClick={() => {
                          setDownloadMenuOpen(false)
                          downloadOriginalDocument()
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50"
                      >
                        Descargar documento original
                      </button>
                      <button
                        onClick={() => {
                          setDownloadMenuOpen(false)
                          downloadDocumensoPdf()
                        }}
                        disabled={!document.documenso_envelope_id || !allSigned || documensoLoading}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                      >
                        Descargar documento firmado
                      </button>
                    </div>
                  )}
                </div>
                {canCancel() && (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    disabled={cancelLoading}
                    className="btn btn-outline btn-sm gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {cancelLoading ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728" />
                      </svg>
                    )}
                    Cancelar
                  </button>
                )}
                {canEdit() && (
                  <button
                    onClick={() => setShowEditModal(true)}
                    className="btn btn-primary btn-sm gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Editar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <main className="flex-1 p-6 lg:p-10">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Main Content - Left Column */}
            <div className="xl:col-span-2 space-y-6">
              {/* Progress Card */}
              <div className="card bg-base-100 shadow-sm border border-slate-200/60">
                <div className="card-body">
                  <h2 className="card-title text-base">Progreso de firmas</h2>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-4">
                      <div className="radial-progress text-emerald-500" style={{"--value": progressPercent, "--size": "4rem", "--thickness": "4px"}} role="progressbar">
                        <span className="text-sm font-bold text-slate-700">{Math.round(progressPercent)}%</span>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-slate-900">{signedCount} de {totalSigners}</p>
                        <p className="text-sm text-slate-500">firmantes completados</p>
                      </div>
                    </div>
                    <div className="flex gap-6">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-amber-600">{document.signers?.filter(s => s.status === 'PENDING' || s.status === 'READY').length || 0}</p>
                        <p className="text-xs text-slate-500">Pendientes</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600">{document.signers?.filter(s => s.status === 'VERIFYING' || s.status === 'VERIFIED').length || 0}</p>
                        <p className="text-xs text-slate-500">Verificando</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-emerald-600">{signedCount}</p>
                        <p className="text-xs text-slate-500">Firmados</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Signers Section */}
              <div className="card bg-base-100 shadow-sm border border-slate-200/60">
                <div className="card-body">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="card-title text-base">Firmantes</h2>
                      <p className="text-sm text-slate-500">{totalSigners} firmante{totalSigners !== 1 ? 's' : ''} asignado{totalSigners !== 1 ? 's' : ''}</p>
                    </div>
                  </div>

                  {document.signers?.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      </div>
                      <p className="text-slate-600 font-medium">Sin firmantes</p>
                      <p className="text-sm text-slate-400">Agrega firmantes editando el documento</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedSigners.map((signer, idx) => {
                        const signerStatus = getSignerStatusConfig(signer.status)
                        const signingOrder = signer.signing_order ?? idx + 1
                        return (
                          <div key={signer.id} className="flex items-center gap-4 p-4 bg-slate-50/80 hover:bg-slate-100/80 rounded-2xl transition-colors">
                            <div className="flex items-center gap-4 flex-1">
                              <div className={`avatar placeholder`}>
                                <div className={`w-12 rounded-xl text-white ${
                                  idx === 0 ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' :
                                  idx === 1 ? 'bg-gradient-to-br from-blue-400 to-blue-600' :
                                  idx === 2 ? 'bg-gradient-to-br from-purple-400 to-purple-600' :
                                  'bg-gradient-to-br from-slate-400 to-slate-600'
                                }`}>
                                  <span className="text-lg font-semibold">{signer.name.charAt(0).toUpperCase()}</span>
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm text-slate-800">{signer.name}</p>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-200/70 text-slate-600">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M6 7v10a2 2 0 002 2h8a2 2 0 002-2V7" />
                                    </svg>
                                    Orden {signingOrder}
                                  </span>
                                  {signer.requires_verification && (
                                    <span className={`badge badge-sm border-0 ${
                                      signer.status === 'VERIFIED' || signer.status === 'SIGNED'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}>
                                      {signer.status === 'VERIFIED' || signer.status === 'SIGNED'
                                        ? 'ID Verificado'
                                        : 'Requiere ID'}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-slate-500 truncate">{signer.email}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className={`badge badge-sm ${signerStatus.bg} ${signerStatus.text} border-0`}>
                                    {signerStatus.label}
                                  </span>
                                  {signer.role && (
                                    <span className="text-xs text-slate-400">Rol: {signer.role}</span>
                                  )}
                                </div>
                                {/* Continuity token fallback for IN_REVIEW or REVIEW_APPROVED */}
                                {signerContinuityTokens[signer.id]?.token &&
                                 (signer.status === 'VERIFYING' || signer.status === 'IN_REVIEW' || signer.status === 'REVIEW_APPROVED') && (
                                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                      <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                      </svg>
                                      <span className="text-xs font-medium text-amber-700">
                                        {signer.status === 'REVIEW_APPROVED'
                                          ? 'Link de continuidad (enviar al cliente)'
                                          : 'Link de continuidad (guardar)'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        readOnly
                                        value={`${window.location.origin}/sign/${signer.signing_token}?continuity_token=${signerContinuityTokens[signer.id].token}`}
                                        className="flex-1 text-[10px] bg-white border border-amber-300 rounded px-2 py-1 text-amber-800 truncate"
                                      />
                                      <button
                                        onClick={() => copyContinuityLink(signer.signing_token, signerContinuityTokens[signer.id].token)}
                                        className="btn btn-xs bg-amber-500 hover:bg-amber-600 text-white border-0"
                                      >
                                        Copiar
                                      </button>
                                    </div>
                                    {signerContinuityTokens[signer.id].expiresAt && (
                                      <p className="text-[10px] text-amber-600 mt-1">
                                        Expira: {new Date(signerContinuityTokens[signer.id].expiresAt).toLocaleString('es-ES')}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              {signer.signing_token && signer.status !== 'SIGNED' ? (
                                <button
                                  onClick={() => copySigningLink(signer.signing_token)}
                                  className="btn btn-primary btn-sm gap-2"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  Copiar link
                                </button>
                              ) : signer.status === 'SIGNED' ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg bg-white">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Firmado
                                </div>
                              ) : (
                                <span className="badge badge-ghost badge-lg">Sin link</span>
                              )}
                              {signer.requires_verification &&
                                signerSessions[signer.id] &&
                                (signer.status === 'VERIFIED' || signer.status === 'SIGNED') && (
                                <button
                                  onClick={() => downloadVerificationPdf(signerSessions[signer.id])}
                                  disabled={pdfLoading}
                                  className="btn btn-outline btn-sm gap-2 ml-2"
                                >
                                  {pdfLoading ? (
                                    <span className="loading loading-spinner loading-xs"></span>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                  )}
                                  Certificado
                                </button>
                              )}
                              {signerAttempts[signer.id]?.status === 'IN_REVIEW' && (
                                <button
                                  onClick={() => handleOpenReview(signer)}
                                  className="btn btn-outline btn-sm gap-2 ml-2"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  Revisar
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Sidebar - Activity Timeline */}
            <div className="xl:col-span-1">
              <div className="card bg-base-100 shadow-sm border border-slate-200/60 sticky top-6 max-h-[42rem] flex flex-col">
                <div className="card-body flex flex-col min-h-0">
                  <h2 className="card-title text-base mb-4">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Historial de actividad
                  </h2>

                  {auditLoading ? (
                    <div className="flex flex-col items-center justify-center py-8">
                      <span className="loading loading-spinner loading-md text-primary"></span>
                      <p className="text-sm text-slate-500 mt-2">Cargando historial...</p>
                    </div>
                  ) : auditEvents.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 mx-auto mb-3 bg-slate-100 rounded-xl flex items-center justify-center">
                        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm text-slate-500">Sin actividad registrada</p>
                    </div>
                  ) : (
                    <div className="space-y-4 overflow-y-auto pr-1">
                      {auditEvents.map((event, idx) => (
                        <div key={event.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="w-2 h-2 rounded-full bg-slate-400 mt-1.5"></span>
                            {idx !== auditEvents.length - 1 && (
                              <span className="w-px flex-1 bg-slate-200 mt-1"></span>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-[13px] font-medium text-slate-700">{event.description || event.event_type}</p>
                            <time className="text-[11px] text-slate-400">{formatShortDate(event.created_at)}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showSignaturePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowSignaturePreview(false)}
          />
          <div className="relative w-full max-w-6xl bg-white rounded-2xl shadow-xl border border-slate-200 h-[85vh] max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Posiciones de firma</h3>
                <p className="text-sm text-slate-500">{document?.file_name || 'Documento'}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSignaturePreview(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-4 flex-1 min-h-0 overflow-hidden">
              <div className="h-full min-h-0">
                <PDFFieldPositioner
                  file={signaturePdfUrl || document?.file_url}
                  signers={document?.signers || []}
                  initialFields={signatureFields}
                  onFieldsChange={() => {}}
                  readOnly
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {reviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !reviewSubmitting && setReviewModalOpen(false)}
          />
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200">
            <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Revisión manual de identidad</h3>
                <p className="text-sm text-slate-500">
                  {reviewSigner ? `${reviewSigner.name} · ${reviewSigner.email}` : 'Detalle de la sesión'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshReviewData}
                  disabled={reviewLoading || reviewRefreshing || reviewSubmitting || !reviewSigner}
                  className="btn btn-ghost btn-xs"
                >
                  {reviewRefreshing ? 'Recargando...' : 'Recargar evidencia'}
                </button>
                <button
                  type="button"
                  onClick={() => !reviewSubmitting && setReviewModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {reviewLoading ? (
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span className="loading loading-spinner loading-sm"></span>
                  Cargando revisión...
                </div>
              ) : (
                <>
                  {(reviewEvidence.faceMatches.length > 0 || reviewEvidence.identityImages.length > 0 || reviewEvidence.livenessImages.length > 0) && (
                    <div className="space-y-4">
                  {reviewEvidence.faceMatches.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white">
                      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                        <h4 className="text-sm font-semibold text-slate-800">Comparación facial</h4>
                      </div>
                      <div className="p-4 space-y-4">
                        {reviewEvidence.faceMatches.map((item) => (
                          <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-medium text-slate-700">Face Match</p>
                              <div className="flex items-center gap-2">
                                {item.score !== null && item.score !== undefined && (
                                  <span className="text-xs font-semibold text-amber-700">Score: {item.score}</span>
                                )}
                                {item.risk?.length > 0 && (
                                  <span className="text-[11px] text-red-700 font-semibold">{item.risk.join(', ')}</span>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {item.sourceImage && (
                                <a href={item.sourceImage} target="_blank" rel="noreferrer" className="block">
                                  <p className="text-xs text-slate-500 mb-1">Fuente (selfie)</p>
                                  <img src={item.sourceImage} alt="Selfie validacion" className="w-full h-40 object-cover rounded-lg border border-slate-200" />
                                </a>
                              )}
                              {item.targetImage && (
                                <a href={item.targetImage} target="_blank" rel="noreferrer" className="block">
                                  <p className="text-xs text-slate-500 mb-1">Objetivo (documento)</p>
                                  <img src={item.targetImage} alt="Foto documento" className="w-full h-40 object-cover rounded-lg border border-slate-200" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                    </div>
                  )}

                  {reviewWarnings.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      No se encontraron warnings en esta sesión.
                    </div>
                  ) : (
                    reviewWarnings.map((group) => (
                      <div key={group.feature} className="rounded-xl border border-slate-200 bg-white">
                        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                          <h4 className="text-sm font-semibold text-slate-800">{group.label}</h4>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          {group.warnings.map((warning, idx) => (
                            <div key={`${warning.risk}-${idx}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-amber-900">{warning.shortDescription || warning.risk}</p>
                                {warning.score !== null && warning.score !== undefined && (
                                  <span className="text-xs font-semibold text-amber-700">Score: {warning.score}</span>
                                )}
                              </div>
                              {warning.longDescription && (
                                <p className="text-xs text-amber-800 mt-1">{warning.longDescription}</p>
                              )}
                              {warning.risk && (
                                <p className="text-[11px] text-amber-700 mt-1">Código: {warning.risk}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {(reviewEvidence.identityImages.length > 0 || reviewEvidence.livenessImages.length > 0) && !reviewLoading && (
                    <div className="rounded-xl border border-slate-200 bg-white">
                      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                        <h4 className="text-sm font-semibold text-slate-800">Imágenes de soporte</h4>
                      </div>
                      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[...reviewEvidence.identityImages, ...reviewEvidence.livenessImages].map((item) => (
                          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-200 p-2 hover:bg-slate-50">
                            <p className="text-xs text-slate-500 mb-1">{item.label}</p>
                            <img src={item.url} alt={item.label} className="w-full h-28 object-cover rounded-md border border-slate-200" />
                          </a>
                        ))}
                      </div>
                    </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Comentario del revisor</label>
                <textarea
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  rows={3}
                  placeholder="Describe el motivo de la decisión"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                disabled={reviewSubmitting}
                className="btn btn-ghost btn-sm"
              >
                Cancelar
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleManualDecision('decline')}
                  disabled={reviewSubmitting}
                  className="btn btn-outline btn-sm text-red-600 border-red-200 hover:bg-red-50"
                >
                  {reviewSubmitting ? 'Procesando...' : 'Rechazar'}
                </button>
                <button
                  type="button"
                  onClick={() => handleManualDecision('approve')}
                  disabled={reviewSubmitting}
                  className="btn btn-primary btn-sm"
                >
                  {reviewSubmitting ? 'Procesando...' : 'Aprobar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <NewDocumentModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onDocumentCreated={() => {
          setShowEditModal(false)
          fetchDocument()
          fetchAuditLog()
        }}
        existingDocument={document}
      />

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowCancelModal(false)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Cancelar documento</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Ya no se podrá firmar este documento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
              Documento: <span className="font-semibold text-slate-800">{document?.file_name}</span>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleCancelEnvelope()
                  setShowCancelModal(false)
                }}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition"
              >
                Cancelar documento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DocumentDetail
