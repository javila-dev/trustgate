import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'
import { useNavigate, Link } from 'react-router-dom'

const OrganizationAccount = () => {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('account')
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('tenant_member')
  const [tenantRole, setTenantRole] = useState('tenant_member')
  const [tenantName, setTenantName] = useState('')

  const invokeAdmin = async (body) => {
    let session = (await supabase.auth.getSession()).data?.session
    if (!session) {
      const refresh = await supabase.auth.refreshSession()
      session = refresh.data?.session || null
    }
    const token = session?.access_token
    if (!token) {
      throw new Error('Sesión expirada. Inicia sesión nuevamente.')
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      throw new Error('Faltan variables de Supabase en el entorno.')
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      const error = new Error(errorText || 'Error en Edge Function')
      error.context = { status: response.status }
      throw error
    }

    return { data: await response.json(), error: null }
  }

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const { data: response } = await invokeAdmin({ action: 'tenant-account' })
        setData(response)
        await loadCurrentUser()
      } catch (err) {
        setError(err?.message || 'Error al cargar la información')
        addToast(err?.message || 'Error al cargar la información', { type: 'error' })
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const loadCurrentUser = async () => {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (session?.user?.email) {
      setUserEmail(session.user.email)
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

      setTenantRole(tenantUser?.role || 'tenant_member')
      setUserRole(profile?.role === 'platform_admin' ? 'platform_admin' : (tenantUser?.role || 'tenant_member'))
      setTenantName(tenantUser?.tenant?.name || '')
    }
  }

  const formatDate = (value) => {
    if (!value) return '—'
    return new Date(value).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatCurrency = (valueCents) => {
    if (!valueCents) return '$0'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(valueCents / 100)
  }

  const tenant = data?.tenant
  const plan = data?.plan
  const metrics = data?.metrics
  const usagePercent = plan?.docs_limit_month
    ? Math.min(100, Math.round((metrics?.docs_used || 0) / plan.docs_limit_month * 100))
    : 0

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className={`
        fixed lg:sticky lg:top-0 inset-y-0 left-0 z-50
        w-72 bg-white border-r border-slate-200/60
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:h-screen flex flex-col shadow-xl lg:shadow-none
      `}>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shadow-lg shadow-emerald-200">
              <img src="/logo.png" alt="TrustGate" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="brand-wordmark text-slate-900">TrustGate</h1>
              <p className="text-xs text-slate-400">{tenantName || 'Cuenta de organización'}</p>
            </div>
          </div>
        </div>

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
                <Link
                  to="/organization"
                  onClick={() => setActiveSection('account')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
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

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50/50">
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

        <main className="flex-1 p-6 lg:p-10">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm p-6 md:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Cuenta de organización</p>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-2">
                {tenant?.name || 'Organización'}
              </h1>
              <p className="text-sm text-slate-500 mt-2">
                {tenant?.slug ? `ID interno: ${tenant.slug}` : 'Gestiona el estado de tu plan y uso mensual.'}
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm p-10 text-center text-slate-500">
                Cargando información...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                    <p className="text-xs text-slate-500">Plan</p>
                    <p className="text-xl font-semibold text-slate-900 mt-2">{plan?.name || 'Sin plan'}</p>
                    <p className="text-sm text-slate-500 mt-2">Costo mensual: {formatCurrency(plan?.mrr_cents || 0)}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                    <p className="text-xs text-slate-500">Periodo de facturación</p>
                    <p className="text-base font-semibold text-slate-900 mt-2">
                      {tenant?.billing_period_start && tenant?.billing_period_end
                        ? `${formatDate(tenant.billing_period_start)} · ${formatDate(tenant.billing_period_end)}`
                        : 'Sin periodo activo'}
                    </p>
                    <p className="text-sm text-slate-500 mt-2">Cliente desde: {formatDate(tenant?.customer_since)}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-5">
                    <p className="text-xs text-slate-500">Límite mensual de documentos</p>
                    <p className="text-xl font-semibold text-slate-900 mt-2">
                      {plan?.docs_limit_month ? plan.docs_limit_month : '∞'} docs
                    </p>
                    <p className="text-sm text-slate-500 mt-2">Disponibles: {metrics?.docs_available ?? '∞'}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">Uso del mes</h2>
                      <p className="text-sm text-slate-500">
                        {metrics?.docs_used ?? 0} de {plan?.docs_limit_month || '∞'} documentos usados
                      </p>
                    </div>
                    <div className="text-2xl font-bold text-slate-900">{usagePercent}%</div>
                  </div>
                  <div className="mt-4 w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all"
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-slate-900">Detalles del plan</h2>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-600">
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Costo mensual</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{formatCurrency(plan?.mrr_cents || 0)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Documentos disponibles</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{metrics?.docs_available ?? '∞'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Próxima renovación</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{formatDate(tenant?.billing_period_end)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Cliente desde</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{formatDate(tenant?.customer_since)}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default OrganizationAccount
