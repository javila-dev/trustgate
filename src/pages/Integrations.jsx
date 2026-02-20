import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'

const Integrations = () => {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tenantId, setTenantId] = useState(null)
  const [tenantName, setTenantName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('tenant_member')
  const [tenantRole, setTenantRole] = useState('tenant_member')
  const [activeSection, setActiveSection] = useState('integrations')

  // Documenso integration
  const [documensoEnabled, setDocumensoEnabled] = useState(false)
  const [documensoApiToken, setDocumensoApiToken] = useState('')
  const [documensoBaseUrl, setDocumensoBaseUrl] = useState('https://app.documenso.com')
  const [documensoWebhookSecret, setDocumensoWebhookSecret] = useState('')
  const [documensoStatus, setDocumensoStatus] = useState(null)

  // Didit integration
  const [diditEnabled, setDiditEnabled] = useState(false)
  const [diditApiKey, setDiditApiKey] = useState('')
  const [diditAppId, setDiditAppId] = useState('')
  const [diditWorkflowId, setDiditWorkflowId] = useState('')
  const [diditWebhookSecret, setDiditWebhookSecret] = useState('')
  const [diditEnvironment, setDiditEnvironment] = useState('production')
  const [diditStatus, setDiditStatus] = useState(null)

  useEffect(() => {
    loadTenantAndIntegrations()
  }, [])

  const loadTenantAndIntegrations = async () => {
    try {
      setLoading(true)

      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData?.session?.user?.id
      const sessionEmail = sessionData?.session?.user?.email
      if (!userId) throw new Error('No hay sesión activa')
      if (sessionEmail) setUserEmail(sessionEmail)

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()

      const { data: tenantUser, error: tenantUserError } = await supabase
        .from('tenant_users')
        .select('tenant_id, role, tenant:tenants(name)')
        .eq('user_id', userId)
        .single()

      if (tenantUserError || !tenantUser?.tenant_id) {
        throw new Error('No se encontró la organización del usuario')
      }

      setTenantRole(tenantUser?.role || 'tenant_member')
      setUserRole(profile?.role === 'platform_admin' ? 'platform_admin' : (tenantUser?.role || 'tenant_member'))

      if (tenantUser?.role !== 'tenant_admin') {
        addToast('No tienes permisos para ver Integraciones.', { type: 'error' })
        navigate('/')
        return
      }

      setTenantId(tenantUser.tenant_id)
      setTenantName(tenantUser.tenant?.name || '')

      // Load integrations
      const { data: integrations, error: integrationsError } = await supabase
        .from('tenant_integrations')
        .select('*')
        .eq('tenant_id', tenantUser.tenant_id)

      if (integrationsError && integrationsError.code !== 'PGRST116') {
        throw integrationsError
      }

      // Parse Documenso config
      const documenso = integrations?.find(i => i.integration_type === 'documenso')
      if (documenso) {
        setDocumensoEnabled(documenso.is_enabled)
        setDocumensoApiToken(documenso.config?.api_token || '')
        setDocumensoBaseUrl(documenso.config?.base_url || 'https://app.documenso.com')
        setDocumensoWebhookSecret(documenso.config?.webhook_secret || '')
        setDocumensoStatus(documenso.test_status)
      }

      // Parse Didit config
      const didit = integrations?.find(i => i.integration_type === 'didit')
      if (didit) {
        setDiditEnabled(didit.is_enabled)
        setDiditApiKey(didit.config?.api_key || '')
        setDiditAppId(didit.config?.app_id || '')
        setDiditWorkflowId(didit.config?.workflow_id || '')
        setDiditWebhookSecret(didit.config?.webhook_secret || '')
        setDiditEnvironment(didit.config?.environment || 'production')
        setDiditStatus(didit.test_status)
      }
    } catch (error) {
      console.error('Error loading integrations:', error)
      addToast(`Error al cargar las integraciones: ${error.message}`, { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const saveDocumensoIntegration = async () => {
    if (!tenantId) return

    try {
      setSaving(true)

      const { error } = await supabase
        .from('tenant_integrations')
        .upsert({
          tenant_id: tenantId,
          integration_type: 'documenso',
          is_enabled: documensoEnabled,
          config: {
            api_token: documensoApiToken,
            base_url: documensoBaseUrl,
            webhook_secret: documensoWebhookSecret
          },
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'tenant_id,integration_type'
        })

      if (error) throw error

      addToast('Configuración de Documenso guardada exitosamente', { type: 'success' })
      await loadTenantAndIntegrations()
    } catch (error) {
      console.error('Error saving Documenso:', error)
      addToast(`Error al guardar Documenso: ${error.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const saveDiditIntegration = async () => {
    if (!tenantId) return

    try {
      setSaving(true)

      const { error } = await supabase
        .from('tenant_integrations')
        .upsert({
          tenant_id: tenantId,
          integration_type: 'didit',
          is_enabled: diditEnabled,
          config: {
            api_key: diditApiKey,
            app_id: diditAppId,
            workflow_id: diditWorkflowId,
            webhook_secret: diditWebhookSecret,
            environment: diditEnvironment
          },
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'tenant_id,integration_type'
        })

      if (error) throw error

      addToast('Configuración de Didit guardada exitosamente', { type: 'success' })
      await loadTenantAndIntegrations()
    } catch (error) {
      console.error('Error saving Didit:', error)
      addToast(`Error al guardar Didit: ${error.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const generateWebhookSecret = () => {
    // Generate a secure random string for webhook secret
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const secret = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
    setDocumensoWebhookSecret(`whsec_${secret}`)
  }

  const getStatusBadge = (status) => {
    if (!status) return null

    const badges = {
      success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      failed: 'bg-red-100 text-red-700 border-red-200',
      pending: 'bg-amber-100 text-amber-700 border-amber-200'
    }

    const labels = {
      success: 'Conectado',
      failed: 'Error',
      pending: 'Pendiente'
    }

    return (
      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${badges[status]}`}>
        {labels[status]}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-600">Cargando configuración...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
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
            onClick={() => setActiveSection('dashboard')}
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

          <Link
            to="/"
            onClick={() => setActiveSection('documents')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
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
          </Link>

          <Link
            to="/"
            onClick={() => setActiveSection('users')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
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
          </Link>

          <div className="pt-4">
            <p className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Configuración</p>
          </div>

          <Link
            to="/integrations"
            onClick={() => setActiveSection('integrations')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'integrations'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'integrations' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center transition-colors`}>
              <svg className={`w-5 h-5 ${activeSection === 'integrations' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <span className="font-medium">Integraciones</span>
          </Link>

          {tenantRole === 'tenant_admin' && (
            <Link
              to="/organization"
              onClick={() => setActiveSection('account')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                activeSection === 'account'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                  : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
              }`}
            >
              <div className={`w-8 h-8 ${activeSection === 'account' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center transition-colors`}>
                <svg className={`w-5 h-5 ${activeSection === 'account' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3zm8 3a8 8 0 11-16 0 8 8 0 0116 0z" />
                </svg>
              </div>
              <span className="font-medium">Cuenta</span>
            </Link>
          )}

          {userRole === 'platform_admin' && (
            <Link to="/admin" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all duration-200 group">
              <div className="w-8 h-8 bg-slate-100 group-hover:bg-slate-200 rounded-lg flex items-center justify-center transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l8 4v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V7l8-4z" />
                </svg>
              </div>
              <span className="font-medium">Admin</span>
            </Link>
          )}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center text-white font-semibold text-sm shadow-sm">
              {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
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
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50/50">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white/80 backdrop-blur-sm border-b border-slate-200/60 p-4 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-6 lg:p-10">
          {/* Header */}
          <div className="max-w-5xl mx-auto mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Integraciones</h1>
            <p className="text-slate-500">
              Configura las credenciales de API para {tenantName || 'tu organización'}
            </p>
          </div>

          {/* Required Configuration Banner */}
          <div className="max-w-5xl mx-auto mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 p-6 rounded-2xl shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-blue-900 mb-1">
                  Configuración Obligatoria
                </h3>
                <p className="text-sm text-blue-800">
                  <span className="font-medium">Documenso</span> es obligatorio para el funcionamiento del sistema.
                  Debes habilitar la integración y configurar el API Token y Base URL antes de poder crear documentos.
                  <span className="block mt-1">
                    <span className="font-medium">Didit</span> es opcional pero necesario si deseas verificar la identidad de los firmantes.
                    Necesitas configurar tu API Key, Application ID y el Workflow ID del flujo de verificación que deseas usar.
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Integrations Grid */}
          <div className="max-w-5xl mx-auto space-y-6">
        {/* Documenso Integration */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">Documenso</h2>
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-lg border border-red-200">
                    OBLIGATORIO
                  </span>
                </div>
                <p className="text-sm text-slate-600">Plataforma de firma electrónica open-source</p>
              </div>
            </div>
            {getStatusBadge(documensoStatus)}
          </div>

          <div className="space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-900">Habilitar Documenso</p>
                <p className="text-sm text-slate-600">Activar integración con Documenso</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={documensoEnabled}
                  onChange={(e) => setDocumensoEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {/* API Token */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                API Token
              </label>
              <input
                type="text"
                value={documensoApiToken}
                onChange={(e) => setDocumensoApiToken(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500 mt-1">
                Obtén tu API token desde la configuración de tu cuenta en Documenso
              </p>
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Base URL
              </label>
              <input
                type="url"
                value={documensoBaseUrl}
                onChange={(e) => setDocumensoBaseUrl(e.target.value)}
                placeholder="https://app.documenso.com"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500 mt-1">
                URL de tu instancia de Documenso (self-hosted o cloud)
              </p>
            </div>

            {/* Webhook Secret */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Webhook Secret
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={documensoWebhookSecret}
                  onChange={(e) => setDocumensoWebhookSecret(e.target.value)}
                  placeholder="Haz clic en Generar"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
                  readOnly={!!documensoWebhookSecret}
                />
                {documensoWebhookSecret && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(documensoWebhookSecret)
                      addToast('Secreto copiado al portapapeles', { type: 'info' })
                    }}
                    className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copiar
                  </button>
                )}
                <button
                  type="button"
                  onClick={generateWebhookSecret}
                  className="px-4 py-2 border border-emerald-600 text-emerald-600 hover:bg-emerald-50 font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Generar
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Genera un secreto, cópialo y configúralo en Documenso → Webhooks (usa el mismo valor en ambos lados)
              </p>
            </div>

            {/* Webhook URL */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="block text-sm font-semibold text-blue-900 mb-2">
                Webhook URL para Documenso
              </label>
              <p className="text-xs text-blue-800 mb-3">
                <strong>Paso final:</strong> Copia esta URL y configúrala en Documenso → Settings → Webhooks junto con el secreto generado arriba.
                Selecciona los eventos: document.signed, document.completed, document.cancelled
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value="https://qkrspksafxhodnuivbkd.supabase.co/functions/v1/webhook-documenso"
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded-lg text-sm font-mono text-slate-700"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText('https://qkrspksafxhodnuivbkd.supabase.co/functions/v1/webhook-documenso')
                    addToast('URL copiada al portapapeles', { type: 'info' })
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copiar
                </button>
              </div>
            </div>

            {/* Save button */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={saveDocumensoIntegration}
                disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-medium rounded-xl transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
              <a
                href="https://documenso.com/docs/api"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors"
              >
                Ver documentación
              </a>
            </div>
          </div>
        </div>

        {/* Didit Integration */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">Didit</h2>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg border border-slate-200">
                    OPCIONAL
                  </span>
                </div>
                <p className="text-sm text-slate-600">Verificación de identidad digital</p>
              </div>
            </div>
            {getStatusBadge(diditStatus)}
          </div>

          <div className="space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-900">Habilitar Didit</p>
                <p className="text-sm text-slate-600">Activar verificación de identidad</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={diditEnabled}
                  onChange={(e) => setDiditEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                API Key
              </label>
              <input
                type="text"
                value={diditApiKey}
                onChange={(e) => setDiditApiKey(e.target.value)}
                placeholder="tu-api-key"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Obtén tu API Key desde Business Console → API & Webhooks
              </p>
            </div>

            {/* Application ID */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Application ID
              </label>
              <input
                type="text"
                value={diditAppId}
                onChange={(e) => setDiditAppId(e.target.value)}
                placeholder="your-app-id"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500 mt-1">
                ID de la aplicación/workspace en Didit
              </p>
            </div>

            {/* Workflow ID */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Workflow ID
              </label>
              <input
                type="text"
                value={diditWorkflowId}
                onChange={(e) => setDiditWorkflowId(e.target.value)}
                placeholder="workflow-id"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500 mt-1">
                ID del flujo de verificación (Orchestrated Workflow) que deseas usar
              </p>
            </div>

            {/* Environment */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Entorno
              </label>
              <select
                value={diditEnvironment}
                onChange={(e) => setDiditEnvironment(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="sandbox">Sandbox (Pruebas)</option>
                <option value="production">Production (Producción)</option>
              </select>
            </div>

            {/* Webhook Secret */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Webhook Secret
              </label>
              <input
                type="text"
                value={diditWebhookSecret}
                onChange={(e) => setDiditWebhookSecret(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-500 mt-1">
                Copia el Webhook Secret que Didit te proporciona en Business Console → API & Webhooks
              </p>
            </div>

            {/* Webhook URL */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <label className="block text-sm font-semibold text-purple-900 mb-2">
                Webhook URL para Didit
              </label>
              <p className="text-xs text-purple-800 mb-3">
                <strong>Paso final:</strong> Copia esta URL y configúrala en Didit → Business Console → API & Webhooks.
                Didit te proporcionará un Webhook Secret, cópialo y pégalo en el campo de arriba.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value="https://qkrspksafxhodnuivbkd.supabase.co/functions/v1/webhook-didit"
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border border-purple-300 rounded-lg text-sm font-mono text-slate-700"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText('https://qkrspksafxhodnuivbkd.supabase.co/functions/v1/webhook-didit')
                    addToast('URL copiada al portapapeles', { type: 'info' })
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copiar
                </button>
              </div>
            </div>

            {/* Save button */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={saveDiditIntegration}
                disabled={saving}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
              <a
                href="https://docs.didit.me/reference/api-full-flow"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors"
              >
                Ver documentación
              </a>
            </div>
          </div>
        </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Integrations
