import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'
import { useNavigate } from 'react-router-dom'

const AdminUsers = () => {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [contextReady, setContextReady] = useState(false)
  const [contextError, setContextError] = useState('')
  const [tenantCreating, setTenantCreating] = useState(false)
  const [tenantsLoading, setTenantsLoading] = useState(false)
  const [tenants, setTenants] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plans, setPlans] = useState([])
  const [activeSection, setActiveSection] = useState('tenants')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [context, setContext] = useState({
    tenantId: null,
    tenantName: '',
    isPlatformAdmin: false,
    isTenantAdmin: false
  })
  const [tenantName, setTenantName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [showTenantModal, setShowTenantModal] = useState(false)
  const [createMode, setCreateMode] = useState('tenant')
  const [showTenantStatusModal, setShowTenantStatusModal] = useState(false)
  const [pendingTenantStatus, setPendingTenantStatus] = useState(null)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [planName, setPlanName] = useState('')
  const [planDocsLimit, setPlanDocsLimit] = useState('')
  const [planMrr, setPlanMrr] = useState('')
  const [planCreating, setPlanCreating] = useState(false)
  const [showTenantUsersModal, setShowTenantUsersModal] = useState(false)
  const [tenantUsersLoading, setTenantUsersLoading] = useState(false)
  const [tenantUsers, setTenantUsers] = useState([])
  const [activeTenant, setActiveTenant] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteRole, setInviteRole] = useState('tenant_member')
  const [invitingUser, setInvitingUser] = useState(false)
  const [removingTenantUserId, setRemovingTenantUserId] = useState(null)
  const [unassignedUsersLoading, setUnassignedUsersLoading] = useState(false)
  const [unassignedUsers, setUnassignedUsers] = useState([])
  const [selectedUnassignedUserId, setSelectedUnassignedUserId] = useState('')
  const [assignRole, setAssignRole] = useState('tenant_member')
  const [assigningUser, setAssigningUser] = useState(false)
  const [showDeleteTenantModal, setShowDeleteTenantModal] = useState(false)
  const [pendingTenantDelete, setPendingTenantDelete] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deletingTenant, setDeletingTenant] = useState(false)
  const [deleteUsers, setDeleteUsers] = useState(false)
  const [reassignTenantId, setReassignTenantId] = useState('')
  const [reassignRole, setReassignRole] = useState('tenant_member')

  const invokeAdmin = async (body) => {
    const actionRaw = typeof body?.action === 'string' ? body.action.trim() : ''
    const action = actionRaw
      ? actionRaw.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
      : ''
    const functionName = (
      action === 'list-unassigned-users' || action === 'assign-user-to-tenant'
    )
      ? 'admin-users-platform'
      : (action === 'update-plan' ? 'admin-plan' : 'admin-users')

    const getAccessToken = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      let token = sessionData?.session?.access_token || null
      if (!token) {
        const { data: refreshData } = await supabase.auth.refreshSession()
        token = refreshData?.session?.access_token || null
      }
      return token
    }

    let accessToken = await getAccessToken()
    if (!accessToken) {
      const err = new Error('Sesión expirada. Inicia sesión nuevamente.')
      err.context = { status: 401 }
      throw err
    }

    let result = await supabase.functions.invoke(functionName, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    let fnError = result.error

    const isJwtError = (err) => {
      if (!err) return false
      const msg = `${err.message || ''}`.toLowerCase()
      return msg.includes('jwt') || msg.includes('token')
    }

    if (fnError && isJwtError(fnError)) {
      await supabase.auth.refreshSession()
      accessToken = await getAccessToken()
      result = await supabase.functions.invoke(functionName, {
        body,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
      })
      fnError = result.error
    }

    if (fnError) {
      let status = fnError?.context?.status || fnError?.status || 500
      let message = fnError?.message || 'Error en Edge Function'

      if (fnError?.context && typeof fnError.context.clone === 'function') {
        try {
          const response = fnError.context
          status = response.status || status
          const payload = await response.clone().json().catch(() => null)
          if (payload?.error || payload?.details || payload?.message) {
            message = payload.error || payload.details || payload.message
          }
        } catch {
          // keep default message
        }
      }

      const err = new Error(message)
      err.context = { status }
      throw err
    }

    return { data: result.data, error: null }
  }

  useEffect(() => {
    let isMounted = true
    let contextLoaded = false

    const init = async () => {
      const { data } = await supabase.auth.getSession()
      if (!isMounted) return
      if (data?.session) {
        if (!contextLoaded) {
          contextLoaded = true
          loadContext()
        }
      } else {
        setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      // Solo reaccionar a SIGNED_OUT, no a TOKEN_REFRESHED
      if (event === 'SIGNED_OUT' || !session) {
        setLoading(false)
        contextLoaded = false
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!loading && contextReady && !context.isPlatformAdmin) {
      addToast('No tienes permisos para acceder a Admin.', { type: 'error' })
      navigate('/')
    }
  }, [loading, contextReady, context.isPlatformAdmin, addToast, navigate])

  const loadContext = async () => {
    try {
      const { data, error } = await invokeAdmin({ action: 'get-context' })
      if (error) throw error
      let isPlatformAdmin = !!data?.isPlatformAdmin
      if (!isPlatformAdmin) {
        const { data: sessionData } = await supabase.auth.getSession()
        const userId = sessionData?.session?.user?.id
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .single()
          if (profile?.role === 'platform_admin') {
            isPlatformAdmin = true
          }
        }
      }
      setContext({
        tenantId: data?.tenantId || null,
        tenantName: data?.tenantName || '',
        isPlatformAdmin,
        isTenantAdmin: !!data?.isTenantAdmin
      })
      if (isPlatformAdmin) {
        await loadTenants()
        await loadPlans()
      }
      setContextReady(true)
      setLoading(false)
    } catch (err) {
      if (err.message?.includes('Sesión expirada')) {
        addToast(err.message, { type: 'error' })
        navigate('/login')
        return
      }
      setContextError(err?.message || 'Error al cargar contexto')
      addToast(err?.context?.status ? `Error ${err.context.status}: ${err.message}` : (err.message || 'Error al cargar contexto'), { type: 'error' })
      setLoading(false)
    }
  }

  const loadTenants = async () => {
    try {
      setTenantsLoading(true)
      const { data, error } = await invokeAdmin({ action: 'list-tenants' })
      if (error) throw error
      setTenants(data?.tenants || [])
    } catch (err) {
      addToast(err?.message || 'Error al cargar organizaciones', { type: 'error' })
    } finally {
      setTenantsLoading(false)
    }
  }

  const loadPlans = async () => {
    try {
      setPlansLoading(true)
      const { data, error } = await invokeAdmin({ action: 'list-plans' })
      if (error) throw error
      setPlans(data?.plans || [])
    } catch (err) {
      addToast(err?.message || 'Error al cargar planes', { type: 'error' })
    } finally {
      setPlansLoading(false)
    }
  }

  const loadTenantUsers = async (tenantIdValue) => {
    if (!tenantIdValue) {
      console.warn('loadTenantUsers: No tenantId provided')
      return
    }
    try {
      console.log('Loading users for tenant:', tenantIdValue)
      setTenantUsersLoading(true)
      const { data, error } = await invokeAdmin({ action: 'list-tenant-users', tenantId: tenantIdValue })
      console.log('Tenant users response:', { data, error })
      if (error) throw error
      const users = data?.users || []
      console.log('Setting tenant users:', users.length, users)
      setTenantUsers(users)
    } catch (err) {
      console.error('Error loading tenant users:', err)
      addToast(err?.message || 'Error al cargar usuarios del tenant', { type: 'error' })
    } finally {
      setTenantUsersLoading(false)
    }
  }

  const openTenantUsers = async (tenant) => {
    setActiveTenant(tenant)
    setShowTenantUsersModal(true)
    await Promise.all([
      loadTenantUsers(tenant?.id),
      loadUnassignedUsers()
    ])
  }

  const closeTenantUsersModal = () => {
    setShowTenantUsersModal(false)
    setActiveTenant(null)
    setTenantUsers([])
    setInviteEmail('')
    setInviteFullName('')
    setInviteRole('tenant_member')
    setUnassignedUsers([])
    setSelectedUnassignedUserId('')
    setAssignRole('tenant_member')
  }

  const loadUnassignedUsers = async () => {
    try {
      setUnassignedUsersLoading(true)
      const { data, error } = await invokeAdmin({ action: 'list-unassigned-users' })
      if (error) throw error
      setUnassignedUsers(data?.users || [])
    } catch (err) {
      addToast(err?.message || 'Error al cargar usuarios libres', { type: 'error' })
    } finally {
      setUnassignedUsersLoading(false)
    }
  }

  const openDeleteTenant = (tenant) => {
    setPendingTenantDelete(tenant)
    setDeletePassword('')
    setDeleteUsers(false)
    setReassignTenantId('')
    setReassignRole('tenant_member')
    setShowDeleteTenantModal(true)
  }

  const closeDeleteTenant = () => {
    setShowDeleteTenantModal(false)
    setPendingTenantDelete(null)
    setDeletePassword('')
    setDeleteUsers(false)
    setReassignTenantId('')
    setReassignRole('tenant_member')
  }

  const handleCreateTenant = async (event) => {
    event.preventDefault()
    setTenantCreating(true)
    try {
      const { error } = await invokeAdmin({
        action: 'create-tenant',
        name: tenantName
      })
      if (error) throw error
      addToast('Organización creada correctamente', { type: 'success' })
      setTenantName('')
      setShowTenantModal(false)
      await loadContext()
    } catch (err) {
      addToast(err.message || 'Error al crear organización', { type: 'error' })
    } finally {
      setTenantCreating(false)
    }
  }

  const handleCreateTenantAdmin = async (event) => {
    event.preventDefault()
    setTenantCreating(true)
    try {
      const { error } = await invokeAdmin({
        action: 'create-tenant-admin',
        name: tenantName,
        email: adminEmail
      })
      if (error) throw error
      addToast('Organización y admin creados', { type: 'success' })
      setTenantName('')
      setAdminEmail('')
      setShowTenantModal(false)
      await loadContext()
    } catch (err) {
      addToast(err.message || 'Error al crear organización', { type: 'error' })
    } finally {
      setTenantCreating(false)
    }
  }

  const handleToggleTenant = async (tenant) => {
    const nextActive = !tenant.is_active
    setPendingTenantStatus({
      tenant,
      nextActive
    })
    setShowTenantStatusModal(true)
  }

  const handleAssignPlan = async (tenantId, planId) => {
    try {
      const { data, error } = await invokeAdmin({
        action: 'set-tenant-plan',
        tenantId,
        planId
      })
      if (error) throw error
      const updated = data?.tenant
      setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, ...updated } : t)))
      await loadTenants()
    } catch (err) {
      addToast(err?.message || 'Error al asignar plan', { type: 'error' })
    }
  }

  const handleCreatePlan = async (event) => {
    event.preventDefault()
    if (!planName.trim()) {
      addToast('El nombre del plan es requerido', { type: 'error' })
      return
    }
    setPlanCreating(true)
    try {
      const mrrCents = Math.round(Number(planMrr || 0) * 100)
      const docsLimitMonth = Number(planDocsLimit || 0)
      if (docsLimitMonth < 0 || mrrCents < 0) {
        addToast('Los valores no pueden ser negativos', { type: 'error' })
        return
      }
      const { data, error } = await invokeAdmin(
        editingPlan?.id
          ? {
            action: 'update-plan',
            planId: editingPlan.id,
            name: planName.trim(),
            docsLimitMonth,
            mrrCents
          }
          : {
            action: 'create-plan',
            name: planName.trim(),
            docsLimitMonth,
            mrrCents
          }
      )
      if (error) throw error
      addToast(editingPlan?.id ? 'Plan actualizado' : 'Plan creado', { type: 'success' })
      if (editingPlan?.id) {
        setPlans((prev) => prev.map((plan) => (plan.id === editingPlan.id ? data?.plan : plan)))
      } else {
        setPlans((prev) => [data?.plan, ...prev].filter(Boolean))
      }
      setPlanName('')
      setPlanDocsLimit('')
      setPlanMrr('')
      setEditingPlan(null)
      setShowPlanModal(false)
    } catch (err) {
      addToast(err?.message || `Error al ${editingPlan?.id ? 'actualizar' : 'crear'} plan`, { type: 'error' })
    } finally {
      setPlanCreating(false)
    }
  }

  const openCreatePlanModal = () => {
    setEditingPlan(null)
    setPlanName('')
    setPlanDocsLimit('')
    setPlanMrr('')
    setShowPlanModal(true)
  }

  const openEditPlanModal = (plan) => {
    setEditingPlan(plan)
    setPlanName(plan?.name || '')
    setPlanDocsLimit(`${plan?.docs_limit_month ?? 0}`)
    setPlanMrr(`${((plan?.mrr_cents ?? 0) / 100)}`)
    setShowPlanModal(true)
  }

  const closePlanModal = () => {
    setShowPlanModal(false)
    setEditingPlan(null)
    setPlanName('')
    setPlanDocsLimit('')
    setPlanMrr('')
  }

  const handleInviteTenantUser = async (event) => {
    event.preventDefault()
    if (!activeTenant?.id) return
    setInvitingUser(true)
    try {
      const { error } = await invokeAdmin({
        action: 'invite-tenant-user',
        tenantId: activeTenant.id,
        email: inviteEmail,
        role: inviteRole,
        fullName: inviteFullName
      })
      if (error) throw error
      addToast('Invitación enviada', { type: 'success' })
      setInviteEmail('')
      setInviteFullName('')
      setInviteRole('tenant_member')
      await loadTenantUsers(activeTenant.id)
      await loadTenants()
    } catch (err) {
      addToast(err?.message || 'Error al invitar usuario', { type: 'error' })
    } finally {
      setInvitingUser(false)
    }
  }

  const handleRemoveTenantUser = async (user) => {
    if (!activeTenant?.id || !user?.id) return
    if (!window.confirm(`¿Desvincular a ${user.email} de ${activeTenant.name}?`)) return
    setRemovingTenantUserId(user.id)
    try {
      const { error } = await invokeAdmin({
        action: 'remove-tenant-user',
        tenantId: activeTenant.id,
        userId: user.id
      })
      if (error) throw error
      addToast('Usuario desvinculado del tenant', { type: 'success' })
      await loadTenantUsers(activeTenant.id)
      await loadUnassignedUsers()
      await loadTenants()
    } catch (err) {
      addToast(err?.message || 'Error al desvincular usuario', { type: 'error' })
    } finally {
      setRemovingTenantUserId(null)
    }
  }

  const handleAssignUnassignedUser = async (event) => {
    event.preventDefault()
    if (!activeTenant?.id || !selectedUnassignedUserId) return
    setAssigningUser(true)
    try {
      const { error } = await invokeAdmin({
        action: 'assign-user-to-tenant',
        tenantId: activeTenant.id,
        userId: selectedUnassignedUserId,
        role: assignRole
      })
      if (error) throw error
      addToast('Usuario asignado al tenant', { type: 'success' })
      setSelectedUnassignedUserId('')
      setAssignRole('tenant_member')
      await loadTenantUsers(activeTenant.id)
      await loadUnassignedUsers()
      await loadTenants()
    } catch (err) {
      addToast(err?.message || 'Error al asignar usuario', { type: 'error' })
    } finally {
      setAssigningUser(false)
    }
  }

  const handleDeleteTenant = async (event) => {
    event.preventDefault()
    if (!pendingTenantDelete?.id) return
    setDeletingTenant(true)
    try {
      const { error } = await invokeAdmin({
        action: 'delete-tenant',
        tenantId: pendingTenantDelete.id,
        password: deletePassword,
        deleteUsers,
        reassignTenantId: reassignTenantId || null,
        reassignRole
      })
      if (error) throw error
      addToast('Organización eliminada', { type: 'success' })
      closeDeleteTenant()
      await loadTenants()
    } catch (err) {
      addToast(err?.message || 'Error al eliminar organización', { type: 'error' })
    } finally {
      setDeletingTenant(false)
    }
  }

  const confirmToggleTenant = async () => {
    if (!pendingTenantStatus?.tenant) return
    const { tenant, nextActive } = pendingTenantStatus
    try {
      const { data, error } = await invokeAdmin({
        action: 'set-tenant-status',
        tenantId: tenant.id,
        isActive: nextActive
      })
      if (error) throw error
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, ...data.tenant } : t)))
      addToast(nextActive ? 'Organización activada' : 'Organización inactivada', { type: 'success' })
    } catch (err) {
      addToast(err?.message || 'Error al actualizar estado', { type: 'error' })
    } finally {
      setShowTenantStatusModal(false)
      setPendingTenantStatus(null)
    }
  }

  const formatDate = (value) => {
    if (!value) return '-'
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

  const getUserStatusPill = (user) => {
    if (user.disabled) {
      return { label: 'Inactivo', classes: 'bg-slate-100 text-slate-600 border-slate-200' }
    }
    if (user.email_confirmed) {
      return { label: 'Activo', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    }
    return { label: 'Pendiente', classes: 'bg-amber-50 text-amber-700 border-amber-200' }
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredTenants = tenants.filter((tenant) => {
    if (statusFilter !== 'all') {
      const isActive = statusFilter === 'active'
      if (tenant.is_active !== isActive) return false
    }
    if (planFilter !== 'all') {
      if ((tenant.plan_name || '').toLowerCase() !== planFilter) return false
    }
    if (!normalizedQuery) return true
    return (
      tenant.name?.toLowerCase().includes(normalizedQuery) ||
      tenant.slug?.toLowerCase().includes(normalizedQuery)
    )
  })

  const planOptions = Array.from(new Set(
    plans.map((plan) => (plan.name || '').toLowerCase()).filter(Boolean)
  ))

  const totalMrr = tenants.reduce((acc, tenant) => acc + (tenant.plan_mrr_cents || 0), 0)
  const totalUsers = tenants.reduce((acc, tenant) => acc + (tenant.user_count || 0), 0)
  const totalDocsMonth = tenants.reduce((acc, tenant) => acc + (tenant.docs_month || 0), 0)

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
              <p className="text-xs text-slate-400">Panel de plataforma</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 pb-4 space-y-1 overflow-y-auto">
          <p className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Administración</p>

          <button
            type="button"
            onClick={() => setActiveSection('tenants')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'tenants'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'tenants' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center`}>
              <svg className={`w-5 h-5 ${activeSection === 'tenants' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h6m4 0h6a2 2 0 002-2V7a2 2 0 00-2-2h-6m-4 0H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <span className="font-medium">Organizaciones</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('plans')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeSection === 'plans'
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200'
                : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900'
            }`}
          >
            <div className={`w-8 h-8 ${activeSection === 'plans' ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-slate-200'} rounded-lg flex items-center justify-center`}>
              <svg className={`w-5 h-5 ${activeSection === 'plans' ? 'text-white' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </div>
            <span className="font-medium">Planes</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 bg-white text-sm font-semibold transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Volver a la app
          </button>
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
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Panel de plataforma</p>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-2">
                    {activeSection === 'plans' ? 'Planes' : 'Administración'}
                  </h1>
                  <p className="text-sm text-slate-500 mt-2">
                    {context.tenantName ? `Organización: ${context.tenantName}` : (context.isPlatformAdmin ? 'Gestiona organizaciones y estado de la plataforma.' : 'No tienes permisos para administrar la plataforma.')}
                  </p>
                </div>
                {context.isPlatformAdmin && (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
                      <p className="text-xs text-slate-500">Total</p>
                      <p className="text-lg font-semibold text-slate-800">{tenants.length}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
                      <p className="text-xs text-slate-500">Activas</p>
                      <p className="text-lg font-semibold text-slate-800">
                        {tenants.filter((t) => t.is_active).length}
                      </p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
                      <p className="text-xs text-slate-500">Ingresos mensuales</p>
                      <p className="text-lg font-semibold text-slate-800">{formatCurrency(totalMrr)}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
                      <p className="text-xs text-slate-500">Usuarios</p>
                      <p className="text-lg font-semibold text-slate-800">{totalUsers}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
                      <p className="text-xs text-slate-500">Documentos del mes</p>
                      <p className="text-lg font-semibold text-slate-800">{totalDocsMonth}</p>
                    </div>
                    {activeSection === 'tenants' ? (
                      <button
                        type="button"
                        onClick={() => setShowTenantModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Nueva organización
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={openCreatePlanModal}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
                        </svg>
                        Crear plan
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {contextError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
                {contextError}
              </div>
            )}

            {context.isPlatformAdmin && activeSection === 'tenants' && (
              <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Organizaciones</h2>
                    <p className="text-sm text-slate-500">Controla estado, plan y actividad.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Buscar por nombre o slug"
                      className="px-4 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    />
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="px-3 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    >
                      <option value="all">Todos</option>
                      <option value="active">Activas</option>
                      <option value="inactive">Inactivas</option>
                    </select>
                    <select
                      value={planFilter}
                      onChange={(event) => setPlanFilter(event.target.value)}
                      className="px-3 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    >
                      <option value="all">Todos los planes</option>
                      {planOptions.map((plan) => (
                        <option key={plan} value={plan}>{plan}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {tenantsLoading ? (
                  <div className="py-10 text-center text-sm text-slate-500">Cargando organizaciones...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                          <th className="px-6 py-4 text-left font-semibold">Organización</th>
                          <th className="px-6 py-4 text-left font-semibold">Plan</th>
                          <th className="px-6 py-4 text-left font-semibold">Expira</th>
                          <th className="px-6 py-4 text-left font-semibold">Usuarios</th>
                          <th className="px-6 py-4 text-left font-semibold">Documentos del mes</th>
                          <th className="px-6 py-4 text-left font-semibold">Periodo MRR</th>
                          <th className="px-6 py-4 text-left font-semibold">Customer since</th>
                          <th className="px-6 py-4 text-left font-semibold">Estado</th>
                          <th className="px-6 py-4 text-left font-semibold">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTenants.map((tenant) => (
                          <tr key={tenant.id} className="hover:bg-slate-50/70 transition">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-semibold text-slate-800">{tenant.name}</p>
                                <p className="text-xs text-slate-500">{tenant.slug}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-slate-700">
                              <select
                                value={tenant.plan_id || ''}
                                onChange={(event) => handleAssignPlan(tenant.id, event.target.value || null)}
                                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                              >
                                <option value="">Sin plan</option>
                                {plans.map((plan) => (
                                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-6 py-4 text-slate-700">
                              {tenant.subscription_expires_at ? formatDate(tenant.subscription_expires_at) : '—'}
                            </td>
                            <td className="px-6 py-4 text-slate-700">
                              {tenant.user_count ?? 0}
                            </td>
                        <td className="px-6 py-4 text-slate-700">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800">{tenant.docs_month ?? 0}</span>
                                <span className="text-xs text-slate-400">/</span>
                                <span className="text-xs text-slate-500">
                                  {tenant.plan_docs_limit ? tenant.plan_docs_limit : '∞'}
                                </span>
                              </div>
                        </td>
                        <td className="px-6 py-4 text-slate-700">
                          {tenant.billing_period_start && tenant.billing_period_end
                            ? `${formatDate(tenant.billing_period_start)} · ${formatDate(tenant.billing_period_end)}`
                            : '—'}
                        </td>
                        <td className="px-6 py-4 text-slate-700">
                          {tenant.customer_since ? formatDate(tenant.customer_since) : '—'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${
                            tenant.is_active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {tenant.is_active ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                            <td className="px-6 py-4">
                              <button
                                type="button"
                                onClick={() => handleToggleTenant(tenant)}
                                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition"
                              >
                                {tenant.is_active ? 'Inactivar' : 'Activar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openTenantUsers(tenant)}
                                className="mt-2 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition"
                              >
                                Usuarios
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteTenant(tenant)}
                                className="mt-2 px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:text-red-700 hover:border-red-300 transition"
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredTenants.length === 0 && (
                          <tr>
                        <td colSpan={9} className="px-6 py-8 text-center text-sm text-slate-500">
                          No hay organizaciones registradas.
                        </td>
                      </tr>
                    )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {context.isPlatformAdmin && activeSection === 'plans' && (
              <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Planes</h2>
                    <p className="text-sm text-slate-500">Administra límites y MRR.</p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreatePlanModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
                    </svg>
                    Nuevo plan
                  </button>
                </div>

                {plansLoading ? (
                  <div className="py-10 text-center text-sm text-slate-500">Cargando planes...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                          <th className="px-6 py-4 text-left font-semibold">Plan</th>
                          <th className="px-6 py-4 text-left font-semibold">Docs/mes</th>
                          <th className="px-6 py-4 text-left font-semibold">MRR</th>
                          <th className="px-6 py-4 text-left font-semibold">Creado</th>
                          <th className="px-6 py-4 text-left font-semibold">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {plans.map((plan) => (
                          <tr key={plan.id} className="hover:bg-slate-50/70 transition">
                            <td className="px-6 py-4">
                              <p className="font-semibold text-slate-800">{plan.name}</p>
                            </td>
                            <td className="px-6 py-4 text-slate-700">{plan.docs_limit_month}</td>
                            <td className="px-6 py-4 text-slate-700">{formatCurrency(plan.mrr_cents)}</td>
                            <td className="px-6 py-4 text-slate-700">{formatDate(plan.created_at)}</td>
                            <td className="px-6 py-4">
                              <button
                                type="button"
                                onClick={() => openEditPlanModal(plan)}
                                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition"
                              >
                                Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                        {plans.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                              No hay planes creados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {showTenantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowTenantModal(false)}
          />
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Nueva organización</h3>
                <p className="text-sm text-slate-500 mt-1">Crea una organización y define su admin si aplica.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowTenantModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-3 mb-6">
              <button
                type="button"
                onClick={() => setCreateMode('tenant')}
                className={`px-4 py-2 rounded-full text-xs font-semibold border transition ${
                  createMode === 'tenant'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Solo organización
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('tenant_admin')}
                className={`px-4 py-2 rounded-full text-xs font-semibold border transition ${
                  createMode === 'tenant_admin'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Organización con admin
              </button>
            </div>

            {createMode === 'tenant' ? (
              <form onSubmit={handleCreateTenant} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre de la organización</label>
                  <input
                    type="text"
                    required
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                    placeholder="Nombre de la organización"
                    className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTenantModal(false)}
                    className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={tenantCreating}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                  >
                    {tenantCreating ? 'Creando...' : 'Crear organización'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreateTenantAdmin} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre de la organización</label>
                    <input
                      type="text"
                      required
                      value={tenantName}
                      onChange={(event) => setTenantName(event.target.value)}
                      placeholder="Nombre de la organización"
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email admin</label>
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(event) => setAdminEmail(event.target.value)}
                      placeholder="admin@empresa.com"
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      El admin recibirá un correo para crear su contraseña y acceder a la organización.
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTenantModal(false)}
                    className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={tenantCreating}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                  >
                    {tenantCreating ? 'Creando...' : 'Crear con admin'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showTenantStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowTenantStatusModal(false)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {pendingTenantStatus?.nextActive ? 'Activar organización' : 'Inactivar organización'}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {pendingTenantStatus?.nextActive
                    ? 'La organización recuperará el acceso a la plataforma.'
                    : 'Los usuarios no podrán acceder mientras esté inactiva.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTenantStatusModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
              Organización: <span className="font-semibold text-slate-800">{pendingTenantStatus?.tenant?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowTenantStatusModal(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmToggleTenant}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition ${
                  pendingTenantStatus?.nextActive ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {pendingTenantStatus?.nextActive ? 'Activar' : 'Inactivar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTenantUsersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={closeTenantUsersModal}
          />
          <div className="relative w-full max-w-5xl bg-white rounded-3xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Usuarios de la organización</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {activeTenant?.name ? `Organización: ${activeTenant.name}` : 'Selecciona una organización.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTenantUsersModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="bg-slate-50 rounded-2xl border border-slate-200/70 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200/70">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Usuarios asociados</p>
                      <p className="text-xs text-slate-500">Lista completa de miembros en este tenant.</p>
                    </div>
                    <div className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700">
                      Total: {tenantUsers.length}
                    </div>
                  </div>
                </div>

                {tenantUsersLoading ? (
                  <div className="py-8 text-center text-sm text-slate-500">Cargando usuarios...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-200/70">
                          <th className="px-5 py-3 text-left font-semibold">Nombre</th>
                          <th className="px-5 py-3 text-left font-semibold">Email</th>
                          <th className="px-5 py-3 text-left font-semibold">Rol</th>
                          <th className="px-5 py-3 text-left font-semibold">Estado</th>
                          <th className="px-5 py-3 text-left font-semibold">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70">
                        {tenantUsers.map((user) => {
                          const status = getUserStatusPill(user)
                          return (
                            <tr key={user.id} className="hover:bg-white/60 transition">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white text-slate-600 border border-slate-200 flex items-center justify-center text-xs font-semibold">
                                    {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                                  </div>
                                  <span className="font-medium text-slate-800">{user.full_name || '—'}</span>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-slate-600">{user.email}</td>
                              <td className="px-5 py-3 text-slate-600">
                                {user.role === 'tenant_admin' ? 'Admin' : 'Member'}
                              </td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${status.classes}`}>
                                  {status.label}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTenantUser(user)}
                                  disabled={removingTenantUserId === user.id}
                                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:text-red-700 hover:border-red-300 transition disabled:opacity-60"
                                >
                                  {removingTenantUserId === user.id ? 'Liberando...' : 'Liberar'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                        {tenantUsers.length === 0 && !tenantUsersLoading && (
                          <tr>
                            <td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-500">
                              Este tenant no tiene usuarios asociados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h4 className="text-base font-semibold text-slate-900">Agregar usuario</h4>
                <p className="text-xs text-slate-500 mt-1">Invita al primer admin si el tenant quedó vacío.</p>
                <form onSubmit={handleInviteTenantUser} className="mt-4 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre completo</label>
                    <input
                      type="text"
                      value={inviteFullName}
                      onChange={(event) => setInviteFullName(event.target.value)}
                      placeholder="Nombre y apellido"
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Correo corporativo</label>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="email@empresa.com"
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rol</label>
                    <select
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    >
                      <option value="tenant_admin">Admin</option>
                      <option value="tenant_member">Member</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={closeTenantUsersModal}
                      className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                    >
                      Cerrar
                    </button>
                    <button
                      type="submit"
                      disabled={invitingUser}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                    >
                      {invitingUser ? 'Enviando...' : 'Enviar invitación'}
                    </button>
                  </div>
                </form>

                <div className="my-5 border-t border-slate-200" />

                <h4 className="text-base font-semibold text-slate-900">Asignar usuario libre</h4>
                <p className="text-xs text-slate-500 mt-1">Usuarios existentes sin tenant asignado.</p>
                <form onSubmit={handleAssignUnassignedUser} className="mt-4 space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Usuario</label>
                    <select
                      value={selectedUnassignedUserId}
                      onChange={(event) => setSelectedUnassignedUserId(event.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      disabled={unassignedUsersLoading}
                    >
                      <option value="">{unassignedUsersLoading ? 'Cargando...' : 'Selecciona un usuario libre'}</option>
                      {unassignedUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.full_name ? `${user.full_name} · ${user.email}` : user.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rol</label>
                    <select
                      value={assignRole}
                      onChange={(event) => setAssignRole(event.target.value)}
                      className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                    >
                      <option value="tenant_admin">Admin</option>
                      <option value="tenant_member">Member</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={assigningUser || !selectedUnassignedUserId}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                    >
                      {assigningUser ? 'Asignando...' : 'Asignar usuario'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={closePlanModal}
          />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{editingPlan ? 'Editar plan' : 'Crear plan'}</h3>
                <p className="text-sm text-slate-500 mt-1">Define límites y MRR mensual.</p>
              </div>
              <button
                type="button"
                onClick={closePlanModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreatePlan} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre del plan</label>
                <input
                  type="text"
                  value={planName}
                  onChange={(event) => setPlanName(event.target.value)}
                  placeholder="starter, pro, enterprise"
                  className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                  required
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Docs/mes</label>
                  <input
                    type="number"
                    min="0"
                    value={planDocsLimit}
                    onChange={(event) => setPlanDocsLimit(event.target.value)}
                    placeholder="1000"
                    className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">MRR (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={planMrr}
                    onChange={(event) => setPlanMrr(event.target.value)}
                    placeholder="499"
                    className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closePlanModal}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={planCreating}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                >
                  {planCreating ? (editingPlan ? 'Guardando...' : 'Creando...') : (editingPlan ? 'Guardar cambios' : 'Crear plan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteTenantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={closeDeleteTenant}
          />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Eliminar organización</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Esta acción es irreversible y elimina todos los datos asociados.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDeleteTenant}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
              Organización: <span className="font-semibold">{pendingTenantDelete?.name || '—'}</span>
            </div>
            <form onSubmit={handleDeleteTenant} className="mt-4 space-y-4">
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <input
                    id="delete-users"
                    type="checkbox"
                    checked={deleteUsers}
                    onChange={(event) => setDeleteUsers(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                  />
                  <label htmlFor="delete-users" className="text-sm text-slate-700">
                    Eliminar usuarios asociados que queden sin organización
                  </label>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reasignar usuarios huérfanos a</label>
                  <select
                    value={reassignTenantId}
                    onChange={(event) => setReassignTenantId(event.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                  >
                    <option value="">No reasignar</option>
                    {tenants
                      .filter((tenant) => tenant.id !== pendingTenantDelete?.id)
                      .map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                      ))}
                  </select>
                  {reassignTenantId && (
                    <div className="mt-3">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rol al reasignar</label>
                      <select
                        value={reassignRole}
                        onChange={(event) => setReassignRole(event.target.value)}
                        className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                      >
                        <option value="tenant_admin">Admin</option>
                        <option value="tenant_member">Member</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Contraseña</label>
                <input
                  type="password"
                  required
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  placeholder="Tu contraseña"
                  className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent transition"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDeleteTenant}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deletingTenant}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                >
                  {deletingTenant ? 'Eliminando...' : 'Eliminar definitivamente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminUsers
