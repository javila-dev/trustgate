import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import NewDocumentModal from '../components/NewDocumentModal'
import TenantUsersPanel from '../components/TenantUsersPanel'
import FolderModal from '../components/FolderModal'
import FolderCard from '../components/FolderCard'
import { useToast } from '../components/ToastProvider'

const Home = () => {
  const { addToast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewDocModal, setShowNewDocModal] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(false)
  const [checkingCredentials, setCheckingCredentials] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [userEmail, setUserEmail] = useState('')
  const [userId, setUserId] = useState(null)
  const [userRole, setUserRole] = useState('tenant_member')
  const [tenantRole, setTenantRole] = useState('tenant_member')
  const [tenantId, setTenantId] = useState(null)
  const [tenantName, setTenantName] = useState('')
  const [activeSection, setActiveSection] = useState('dashboard')
  const [documentQuery, setDocumentQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [showHiddenCancelled, setShowHiddenCancelled] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0
  })

  // Folder states
  const [folders, setFolders] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [editingFolder, setEditingFolder] = useState(null)
  const [folderLoading, setFolderLoading] = useState(false)
  const [draggedDocumentId, setDraggedDocumentId] = useState(null)
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState(null)

  useEffect(() => {
    loadCurrentUser()
  }, [])

  const loadCurrentUser = async () => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (session?.user?.email) {
      setUserEmail(session.user.email)
      setUserId(session.user.id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id, role, tenant:tenants(name)')
        .eq('user_id', session.user.id)
        .single()

      const currentTenantRole = tenantUser?.role || 'tenant_member'
      const currentUserRole = profile?.role === 'platform_admin' ? 'platform_admin' : currentTenantRole

      setTenantRole(currentTenantRole)
      setUserRole(currentUserRole)
      setTenantId(tenantUser?.tenant_id || null)
      setTenantName(tenantUser?.tenant?.name || '')

      if (tenantUser?.tenant_id) {
        await checkIntegrations(tenantUser.tenant_id)
        await fetchDocuments(tenantUser.tenant_id, session.user.id, currentTenantRole, currentUserRole)
        await fetchFolders(tenantUser.tenant_id)
      } else {
        setCheckingCredentials(false)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [documents.length, pageSize])

  useEffect(() => {
    if (activeSection === 'documents') {
      setCurrentPage(1)
    }
  }, [documentQuery, statusFilter, activeSection])

  useEffect(() => {
    if (!showHiddenCancelled && statusFilter === 'HIDDEN') {
      setStatusFilter('ALL')
    }
  }, [showHiddenCancelled, statusFilter])

  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section')
    if (section === 'documents') {
      setActiveSection('documents')
      setCurrentPage(1)
    }
  }, [location.search])

  const checkIntegrations = async (tenantIdValue) => {
    try {
      setCheckingCredentials(true)

      if (!tenantIdValue) {
        setHasCredentials(false)
        return
      }

      // Check if Documenso integration is enabled and configured
      const { data: integrations, error: integrationsError } = await supabase
        .from('tenant_integrations')
        .select('*')
        .eq('tenant_id', tenantIdValue)
        .eq('integration_type', 'documenso')
        .eq('is_enabled', true)

      if (integrationsError || !integrations || integrations.length === 0) {
        setHasCredentials(false)
        return
      }

      // Check if credentials are present
      const documenso = integrations[0]
      const hasValidConfig =
        documenso.config?.api_token &&
        documenso.config?.base_url

      setHasCredentials(hasValidConfig)
    } catch (error) {
      console.error('Error checking integrations:', error)
      setHasCredentials(false)
    } finally {
      setCheckingCredentials(false)
    }
  }

  const fetchDocuments = async (tenantIdValue, userId = null, role = null, platformRole = null) => {
    try {
      setLoading(true)

      // Build query
      let query = supabase
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
            signing_token
          )
        `)
        .eq('tenant_id', tenantIdValue)

      // Members can only see their own documents
      // Admins (tenant_admin and platform_admin) see all documents
      const effectiveRole = role || tenantRole
      const effectivePlatformRole = platformRole || userRole
      const isAdmin = effectiveRole === 'tenant_admin' || effectivePlatformRole === 'platform_admin'

      if (!isAdmin && userId) {
        query = query.eq('created_by', userId)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) throw error

      setDocuments(data || [])

      // Hidden cancelled documents should not affect dashboard counters.
      const visibleDocuments = (data || []).filter((d) => !d.is_hidden)
      const total = visibleDocuments.length || 0
      const pending = visibleDocuments.filter(d => d.status === 'PENDING').length || 0
      const inProgress = visibleDocuments.filter(d => d.status === 'IN_PROGRESS').length || 0
      const completed = visibleDocuments.filter(d => d.status === 'COMPLETED').length || 0

      setStats({ total, pending, inProgress, completed })
    } catch (error) {
      console.error('Error fetching documents:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchFolders = async (tenantIdValue) => {
    try {
      const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('tenant_id', tenantIdValue)
        .order('position', { ascending: true })

      if (error) throw error
      setFolders(data || [])
    } catch (error) {
      console.error('Error fetching folders:', error)
    }
  }

  const createFolder = async (folderData) => {
    try {
      setFolderLoading(true)
      const { data: session } = await supabase.auth.getSession()
      const userId = session?.session?.user?.id

      const { data, error } = await supabase
        .from('folders')
        .insert({
          tenant_id: tenantId,
          name: folderData.name,
          color: folderData.color,
          position: folders.length,
          created_by: userId
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          addToast('Ya existe una carpeta con ese nombre', { type: 'error' })
        } else {
          addToast(`Error al crear carpeta: ${error.message}`, { type: 'error' })
        }
        return false
      }

      setFolders([...folders, data])
      addToast('Carpeta creada exitosamente', { type: 'success' })
      return true
    } catch (error) {
      addToast(`Error al crear carpeta: ${error.message}`, { type: 'error' })
      return false
    } finally {
      setFolderLoading(false)
    }
  }

  const updateFolder = async (folderId, updates) => {
    try {
      setFolderLoading(true)
      const { error } = await supabase
        .from('folders')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', folderId)

      if (error) {
        if (error.code === '23505') {
          addToast('Ya existe una carpeta con ese nombre', { type: 'error' })
        } else {
          addToast(`Error al actualizar carpeta: ${error.message}`, { type: 'error' })
        }
        return false
      }

      setFolders(folders.map(f => f.id === folderId ? { ...f, ...updates } : f))
      addToast('Carpeta actualizada', { type: 'success' })
      return true
    } catch (error) {
      addToast(`Error al actualizar carpeta: ${error.message}`, { type: 'error' })
      return false
    } finally {
      setFolderLoading(false)
    }
  }

  const deleteFolder = async (folderId) => {
    try {
      const { error } = await supabase
        .from('folders')
        .delete()
        .eq('id', folderId)

      if (error) {
        addToast(`Error al eliminar carpeta: ${error.message}`, { type: 'error' })
        return
      }

      setFolders(folders.filter(f => f.id !== folderId))
      if (selectedFolderId === folderId) setSelectedFolderId(null)

      // Update local documents state to remove folder_id
      setDocuments(documents.map(doc =>
        doc.folder_id === folderId ? { ...doc, folder_id: null } : doc
      ))

      addToast('Carpeta eliminada', { type: 'success' })
    } catch (error) {
      addToast(`Error al eliminar carpeta: ${error.message}`, { type: 'error' })
    }
  }

  const requestDeleteFolder = (folderId) => {
    const folder = folders.find(f => f.id === folderId) || null
    setPendingDeleteFolder(folder)
    setShowDeleteFolderModal(true)
  }

  const moveDocumentToFolder = async (documentId, folderId) => {
    try {
      const { error } = await supabase
        .from('documents')
        .update({ folder_id: folderId })
        .eq('id', documentId)

      if (error) {
        addToast(`Error al mover documento: ${error.message}`, { type: 'error' })
        return
      }

      setDocuments(documents.map(doc =>
        doc.id === documentId ? { ...doc, folder_id: folderId } : doc
      ))

      const folderName = folderId
        ? folders.find(f => f.id === folderId)?.name
        : 'Sin carpeta'
      addToast(`Documento movido a "${folderName}"`, { type: 'success' })
    } catch (error) {
      addToast(`Error al mover documento: ${error.message}`, { type: 'error' })
    }
  }

  const toggleDocumentHidden = async (doc) => {
    if (!doc?.id) return

    const nextHidden = !doc.is_hidden
    if (nextHidden && doc.status !== 'CANCELLED') {
      addToast('Solo se pueden ocultar documentos cancelados', { type: 'error' })
      return
    }

    try {
      const { error } = await supabase
        .from('documents')
        .update({ is_hidden: nextHidden, updated_at: new Date().toISOString() })
        .eq('id', doc.id)

      if (error) {
        addToast(`Error al ${nextHidden ? 'ocultar' : 'mostrar'} documento: ${error.message}`, { type: 'error' })
        return
      }

      setDocuments((prevDocs) =>
        prevDocs.map((item) =>
          item.id === doc.id
            ? { ...item, is_hidden: nextHidden, updated_at: new Date().toISOString() }
            : item
        )
      )

      addToast(nextHidden ? 'Documento oculto del listado' : 'Documento visible nuevamente', { type: 'success' })
    } catch (error) {
      addToast(`Error al ${nextHidden ? 'ocultar' : 'mostrar'} documento: ${error.message}`, { type: 'error' })
    }
  }

  const getStatusBadge = (status) => {
    const badges = {
      DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
      PENDING: 'bg-amber-100 text-amber-700 border-amber-200',
      IN_PROGRESS: 'bg-blue-100 text-blue-700 border-blue-200',
      COMPLETED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      CANCELLED: 'bg-red-100 text-red-700 border-red-200',
      EXPIRED: 'bg-orange-100 text-orange-700 border-orange-200'
    }
    return badges[status] || badges.DRAFT
  }

  const getStatusLabel = (status) => {
    const labels = {
      DRAFT: 'Borrador',
      PENDING: 'Pendiente',
      IN_PROGRESS: 'En progreso',
      COMPLETED: 'Completado',
      CANCELLED: 'Cancelado',
      EXPIRED: 'Expirado'
    }
    return labels[status] || status
  }

  const getSignersStatus = (signers) => {
    if (!signers || signers.length === 0) return 'Sin firmantes'

    const signed = signers.filter(s => s.status === 'SIGNED').length
    const total = signers.length

    return `${signed}/${total} firmados`
  }

  const isDocumentsView = activeSection === 'documents'
  const documentsForView = showHiddenCancelled
    ? documents
    : documents.filter((doc) => !doc.is_hidden)
  const sortedDocuments = [...documentsForView].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const normalizedQuery = documentQuery.trim().toLowerCase()
  const folderDocumentCounts = documentsForView.reduce((acc, doc) => {
    const key = doc.folder_id || 'root'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const foldersWithCounts = folders.map(folder => ({
    ...folder,
    documentCount: folderDocumentCounts[folder.id] || 0
  }))
  const folderMap = new Map(folders.map(folder => [folder.id, folder]))
  const filteredDocuments = sortedDocuments.filter((document) => {
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'HIDDEN') {
        if (!document.is_hidden) {
          return false
        }
      } else if (document.status !== statusFilter) {
        return false
      }
    }

    if (!showHiddenCancelled && document.is_hidden) {
      return false
    }

    if (selectedFolderId) {
      if (selectedFolderId === 'root' && document.folder_id) {
        return false
      }
      if (selectedFolderId !== 'root' && document.folder_id !== selectedFolderId) {
        return false
      }
    }

    if (!normalizedQuery) {
      return true
    }

    const signerMatch = (document.signers || []).some((signer) =>
      `${signer.name || ''} ${signer.email || ''}`.toLowerCase().includes(normalizedQuery)
    )

    return (
      document.file_name?.toLowerCase().includes(normalizedQuery) ||
      document.id?.toLowerCase().includes(normalizedQuery) ||
      signerMatch
    )
  })
  const totalItems = isDocumentsView ? filteredDocuments.length : sortedDocuments.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedDocuments = (isDocumentsView ? filteredDocuments : sortedDocuments).slice(startIndex, endIndex)
  const tableDocuments = isDocumentsView ? paginatedDocuments : sortedDocuments.slice(0, 10)

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const donutTotal = Math.max(stats.total, 0)
  const pendingRatio = donutTotal > 0 ? (stats.pending / donutTotal) : 0
  const inProgressRatio = donutTotal > 0 ? (stats.inProgress / donutTotal) : 0
  const completedRatio = donutTotal > 0 ? (stats.completed / donutTotal) : 0
  const pendingDeg = pendingRatio * 360
  const inProgressDeg = inProgressRatio * 360
  const completedDeg = completedRatio * 360
  const donutTrackColor = '#e2e8f0'
  const donutPendingColor = '#f59e0b'
  const donutInProgressColor = '#3b82f6'
  const donutCompletedColor = '#10b981'
  const donutGradient = donutTotal > 0
    ? `conic-gradient(
      ${donutPendingColor} 0deg ${pendingDeg}deg,
      ${donutInProgressColor} ${pendingDeg}deg ${pendingDeg + inProgressDeg}deg,
      ${donutCompletedColor} ${pendingDeg + inProgressDeg}deg ${pendingDeg + inProgressDeg + completedDeg}deg,
      ${donutTrackColor} ${pendingDeg + inProgressDeg + completedDeg}deg 360deg
    )`
    : `conic-gradient(${donutTrackColor} 0deg 360deg)`

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Modern Design */}
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

          <Link
            to="/"
            onClick={() => {
              setActiveSection('dashboard')
              setDocumentQuery('')
              setStatusFilter('ALL')
              setCurrentPage(1)
            }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'dashboard'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'dashboard' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center`}>
              <svg className={`w-5 h-5 ${activeSection === 'dashboard' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <span className="font-medium">Dashboard</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setActiveSection('documents')
              setCurrentPage(1)
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'documents'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'documents' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center transition-colors`}>
              <svg className={`w-5 h-5 ${activeSection === 'documents' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="font-medium">Documentos</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('users')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'users'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'users' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center transition-colors`}>
              <svg className={`w-5 h-5 ${activeSection === 'users' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className="font-medium">Usuarios</span>
          </button>

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
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden">
                <img src="/logo.png" alt="TrustGate" className="w-full h-full object-contain" />
              </div>
              <span className="brand-wordmark text-slate-900">TrustGate</span>
            </div>
            <div className="w-10"></div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-6 lg:p-10">
          {activeSection === 'users' ? (
            <TenantUsersPanel />
          ) : (
          <>
            {/* Header */}
            <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
                {isDocumentsView ? 'Documentos' : 'Dashboard'}
              </h2>
            </div>
            <p className="text-slate-500">
              {isDocumentsView
                ? 'Revisa todos los documentos y su estado de firma.'
                : 'Gestiona tus documentos y firmas electrónicas de forma segura'}
            </p>
            </div>

          {/* Credentials Warning Banner */}
          {!checkingCredentials && !hasCredentials && tenantRole === 'tenant_admin' && (
            <div className="mb-8 bg-gradient-to-r from-red-50 to-orange-50 border border-red-200/60 p-6 rounded-2xl shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-red-800 mb-1">
                    Configuración Requerida
                  </h3>
                  <p className="text-red-700 text-sm mb-4">
                    Antes de crear documentos, debes configurar tu API Token de Documenso.
                    Sin esta configuración, el sistema no podrá procesar firmas electrónicas.
                  </p>
                  <Link
                    to="/integrations"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Configurar Integraciones
                  </Link>
                </div>
              </div>
            </div>
          )}

          {isDocumentsView && (
            <div className="mb-6 bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Carpetas</h3>
                  <p className="text-sm text-slate-500">Organiza tus documentos por carpetas</p>
                </div>
                <button
                  onClick={() => {
                    setEditingFolder(null)
                    setShowFolderModal(true)
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Nueva carpeta
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  onClick={() => setSelectedFolderId(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  selectedFolderId === null
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos ({documentsForView.length})
                </button>
                <button
                  onClick={() => setSelectedFolderId('root')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    selectedFolderId === 'root'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Sin carpeta ({folderDocumentCounts.root || 0})
                </button>
              </div>

              {foldersWithCounts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {foldersWithCounts.map(folder => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      isSelected={selectedFolderId === folder.id}
                      onSelect={(folderId) => setSelectedFolderId(folderId)}
                      onEdit={(folderData) => {
                        setEditingFolder(folderData)
                        setShowFolderModal(true)
                      }}
                      onDelete={(folderId) => requestDeleteFolder(folderId)}
                      onDrop={(documentId, folderId) => moveDocumentToFolder(documentId, folderId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">
                  Aún no tienes carpetas. Crea una para empezar a organizar tus documentos.
                </div>
              )}

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const documentId = e.dataTransfer.getData('documentId')
                  if (documentId) {
                    moveDocumentToFolder(documentId, null)
                  }
                }}
                className="mt-5 p-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-sm text-slate-600 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-200/70 flex items-center justify-center">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">Soltar en “Sin carpeta”</p>
                    <p className="text-xs text-slate-500">Arrastra aquí para sacar un documento de su carpeta</p>
                  </div>
                </div>
                <span className="text-xs text-slate-500">{folderDocumentCounts.root || 0} documentos</span>
              </div>
            </div>
          )}

          {/* Stats Cards - Modern Design */}
          {!isDocumentsView && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {/* Total Documents */}
            <div className="group relative bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200">
              <div>
                <p className="text-sm text-slate-500 font-medium mb-1">Total Documentos</p>
              </div>
              <div className="mt-2 flex items-center gap-4">
                <div
                  className="relative w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: donutGradient }}
                >
                  <div className="w-16 h-16 rounded-full bg-white border border-slate-100 flex items-center justify-center">
                    <span className="text-2xl font-bold text-slate-900 leading-none">{stats.total}</span>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>Pendientes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>En progreso</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>Completados</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pending */}
            <div className="group relative bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md hover:border-amber-200 transition-all duration-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-amber-600 font-medium mb-1">Pendientes</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{stats.pending}</p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-amber-100 to-amber-50 rounded-xl flex items-center justify-center ring-1 ring-amber-200/50">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                {donutTotal > 0 ? `${Math.round(pendingRatio * 100)}% del total` : 'Sin documentos aún'}
              </p>
            </div>

            {/* In Progress */}
            <div className="group relative bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium mb-1">En Progreso</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{stats.inProgress}</p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-50 rounded-xl flex items-center justify-center ring-1 ring-blue-200/50">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                {donutTotal > 0 ? `${Math.round(inProgressRatio * 100)}% del total` : 'Sin documentos aún'}
              </p>
            </div>

            {/* Completed */}
            <div className="group relative bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all duration-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-emerald-600 font-medium mb-1">Completados</p>
                  <p className="text-3xl font-bold text-slate-900 tracking-tight">{stats.completed}</p>
                </div>
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-emerald-50 rounded-xl flex items-center justify-center ring-1 ring-emerald-200/50">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                {donutTotal > 0 ? `${Math.round(completedRatio * 100)}% del total` : 'Sin documentos aún'}
              </p>
            </div>
          </div>
          )}

          {/* Documents Table - Modern Design */}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50/50 to-white">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {isDocumentsView ? 'Todos los documentos' : 'Documentos recientes'}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {isDocumentsView
                    ? 'Gestiona y monitorea todos los documentos'
                    : 'Últimos 10 documentos creados'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {isDocumentsView && (
                  <>
                    <input
                      type="text"
                      value={documentQuery}
                      onChange={(event) => setDocumentQuery(event.target.value)}
                      placeholder="Buscar por documento o firmante"
                      className="input input-bordered input-sm min-w-[220px]"
                    />
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="select select-bordered select-sm"
                    >
                      <option value="ALL">Todos</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="IN_PROGRESS">En progreso</option>
                      <option value="COMPLETED">Completado</option>
                      <option value="CANCELLED">Cancelado</option>
                      <option value="EXPIRED">Expirado</option>
                      <option value="DRAFT">Borrador</option>
                      {showHiddenCancelled && <option value="HIDDEN">Ocultos</option>}
                    </select>
                  </>
                )}
                <label className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={showHiddenCancelled}
                    onChange={(event) => setShowHiddenCancelled(event.target.checked)}
                  />
                  Ver ocultos
                </label>
                <div className="relative group">
                  <button
                    onClick={() => hasCredentials && setShowNewDocModal(true)}
                    disabled={!hasCredentials}
                    className={`px-5 py-2.5 font-medium rounded-xl transition-all duration-200 flex items-center gap-2 ${
                      hasCredentials
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200 hover:shadow-md hover:shadow-emerald-200'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Nuevo documento
                  </button>
                  {!hasCredentials && (
                    <div className="absolute right-0 top-full mt-2 w-72 p-4 bg-slate-900 text-white text-sm rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-10 shadow-xl">
                      <div className="flex gap-3">
                        <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Configura el API Token de Documenso en la página de Integraciones primero
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="p-16 text-center">
                <div className="relative w-12 h-12 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"></div>
                </div>
                <p className="text-slate-600 font-medium">Cargando documentos...</p>
                <p className="text-sm text-slate-400 mt-1">Por favor espera</p>
              </div>
            ) : totalItems === 0 ? (
              <div className="p-16 text-center">
                <div className="w-20 h-20 mx-auto mb-5 bg-slate-100 rounded-2xl flex items-center justify-center">
                  <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-lg text-slate-700 font-semibold mb-1">
                  {isDocumentsView && (documentQuery || statusFilter !== 'ALL') ? 'No hay resultados' : 'No hay documentos'}
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  {isDocumentsView && (documentQuery || statusFilter !== 'ALL')
                    ? 'Prueba ajustando los filtros de búsqueda'
                    : 'Comienza creando tu primer documento para firmar'}
                </p>
                {hasCredentials && (
                  <button
                    onClick={() => setShowNewDocModal(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-all duration-200 shadow-sm shadow-emerald-200 hover:shadow-md"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Crear primer documento
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Documento
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Firmantes
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Estado
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Progreso
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Fecha
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tableDocuments.map((document) => {
                        const folder = document.folder_id ? folderMap.get(document.folder_id) : null
                        return (
                        <tr
                          key={document.id}
                          draggable={isDocumentsView}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('documentId', document.id)
                            setDraggedDocumentId(document.id)
                          }}
                          onDragEnd={() => setDraggedDocumentId(null)}
                          className={`group hover:bg-slate-50/50 transition-colors duration-150 ${
                            draggedDocumentId === document.id ? 'opacity-50' : ''
                          }`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 bg-gradient-to-br from-slate-100 to-slate-50 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ring-slate-200/50">
                                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div>
                              <p className="text-[13px] font-semibold text-slate-800">{document.file_name}</p>
                              <p className="text-[11px] text-slate-400 font-mono">{document.id.slice(0, 8)}</p>
                                {document.is_hidden && (
                                  <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border border-slate-300 bg-slate-100 text-slate-600">
                                    Oculto
                                  </span>
                                )}
                                {folder && (
                                  <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border border-slate-200 bg-white text-slate-600">
                                    <span
                                      className="w-2 h-2 rounded-full"
                                      style={{ backgroundColor: folder.color || '#94a3b8' }}
                                    />
                                    {folder.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex -space-x-2">
                              {document.signers?.slice(0, 3).map((signer, idx) => (
                                <div
                                  key={signer.id}
                                  className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white shadow-sm ${
                                    idx === 0 ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' :
                                    idx === 1 ? 'bg-gradient-to-br from-blue-400 to-blue-600' :
                                    'bg-gradient-to-br from-purple-400 to-purple-600'
                                  }`}
                                  title={signer.name}
                                >
                                  {signer.name.charAt(0).toUpperCase()}
                                </div>
                              ))}
                              {document.signers?.length > 3 && (
                                <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 text-xs font-semibold ring-2 ring-white">
                                  +{document.signers.length - 3}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg ${getStatusBadge(document.status)}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                document.status === 'COMPLETED' ? 'bg-emerald-500' :
                                document.status === 'IN_PROGRESS' ? 'bg-blue-500 animate-pulse' :
                                document.status === 'PENDING' ? 'bg-amber-500' :
                                'bg-slate-400'
                              }`}></span>
                              {getStatusLabel(document.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-slate-100 rounded-full h-1.5">
                                <div
                                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{
                                    width: `${document.signers?.length > 0
                                      ? (document.signers.filter(s => s.status === 'SIGNED').length / document.signers.length) * 100
                                      : 0}%`
                                  }}
                                />
                              </div>
                              <span className="text-[11px] font-medium text-slate-600">{getSignersStatus(document.signers)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-[12px] text-slate-500">{formatDate(document.created_at)}</p>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {isDocumentsView && (document.status === 'CANCELLED' || document.is_hidden) && (
                                <button
                                  type="button"
                                  onClick={() => toggleDocumentHidden(document)}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:text-slate-700 hover:bg-slate-100 font-medium text-[12px] rounded-xl transition-colors"
                                >
                                  {document.is_hidden ? 'Mostrar' : 'Ocultar'}
                                </button>
                              )}
                              <Link
                                to={`/document/${document.id}`}
                                className="inline-flex items-center gap-1.5 px-4 py-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 font-medium text-[12px] rounded-xl transition-colors opacity-70 group-hover:opacity-100"
                              >
                                Ver detalles
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
                {isDocumentsView ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    Mostrando {totalItems === 0 ? 0 : startIndex + 1}-{Math.min(endIndex, totalItems)} de {totalItems}
                  </p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Filas
                        <select
                          value={pageSize}
                          onChange={(event) => {
                            setPageSize(Number(event.target.value))
                            setCurrentPage(1)
                          }}
                          className="select select-bordered select-xs"
                        >
                          {[5, 10, 20, 50].map(size => (
                            <option key={size} value={size}>{size}</option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                          disabled={safePage === 1}
                          className="btn btn-ghost btn-xs"
                        >
                          Anterior
                        </button>
                        <span className="text-xs text-slate-500 px-2">
                          {safePage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                          disabled={safePage === totalPages}
                          className="btn btn-ghost btn-xs"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-6 py-4 border-t border-slate-100">
                    <p className="text-xs text-slate-500">Mostrando los 10 documentos más recientes.</p>
                  </div>
                )}
              </>
            )}
          </div>
          </>
          )}
        </main>
      </div>

      {/* New Document Modal */}
      <NewDocumentModal
        isOpen={showNewDocModal}
        onClose={() => setShowNewDocModal(false)}
        onDocumentCreated={(createdDocument) => {
          setShowNewDocModal(false)
          fetchDocuments(tenantId, userId, tenantRole, userRole)
          if (createdDocument?.id) {
            navigate(`/document/${createdDocument.id}`)
          }
        }}
      />

      {/* Folder Modal */}
      <FolderModal
        isOpen={showFolderModal}
        onClose={() => {
          setShowFolderModal(false)
          setEditingFolder(null)
        }}
        onSave={async (folderData) => {
          const success = editingFolder
            ? await updateFolder(editingFolder.id, folderData)
            : await createFolder(folderData)
          if (success) {
            setShowFolderModal(false)
            setEditingFolder(null)
          }
        }}
        folder={editingFolder}
        loading={folderLoading}
      />

      {showDeleteFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowDeleteFolderModal(false)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Eliminar carpeta</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Los documentos se moverán a la raíz.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteFolderModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
              Carpeta: <span className="font-semibold text-slate-800">{pendingDeleteFolder?.name || 'Sin nombre'}</span>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowDeleteFolderModal(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (pendingDeleteFolder?.id) {
                    await deleteFolder(pendingDeleteFolder.id)
                  }
                  setShowDeleteFolderModal(false)
                  setPendingDeleteFolder(null)
                }}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
