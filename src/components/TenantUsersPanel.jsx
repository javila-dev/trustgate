import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from './ToastProvider'

const TenantUsersPanel = () => {
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [context, setContext] = useState({
    tenantId: null,
    tenantName: ''
  })
  const [users, setUsers] = useState([])
  const [savingName, setSavingName] = useState({})
  const [resendingInvite, setResendingInvite] = useState({})
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('tenant_member')
  const [showInviteModal, setShowInviteModal] = useState(false)

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

  const loadContext = async () => {
    const { data, error } = await invokeAdmin({ action: 'get-context' })
    if (error) throw error
    setContext({
      tenantId: data?.tenantId || null,
      tenantName: data?.tenantName || ''
    })
  }

  const loadUsers = async () => {
    const { data, error } = await invokeAdmin({ action: 'list-users' })
    if (error) throw error
    setUsers(data?.users || [])
  }

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true)
        await loadContext()
        await loadUsers()
      } catch (err) {
        addToast(err?.context?.status ? `Error ${err.context.status}: ${err.message}` : (err.message || 'Error al cargar usuarios'), { type: 'error' })
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  const handleInvite = async (event) => {
    event.preventDefault()
    setInviting(true)
    try {
      const { error } = await invokeAdmin({
        action: 'invite-user',
        email,
        role,
        fullName
      })
      if (error) throw error
      addToast('Invitación enviada', { type: 'success' })
      setEmail('')
      setFullName('')
      setRole('tenant_member')
      setShowInviteModal(false)
      await loadUsers()
    } catch (err) {
      addToast(err.message || 'Error al invitar usuario', { type: 'error' })
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (userId, nextRole) => {
    try {
      const { error } = await invokeAdmin({
        action: 'update-role',
        userId,
        role: nextRole
      })
      if (error) throw error
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: nextRole } : u)))
    } catch (err) {
      addToast(err.message || 'Error al actualizar rol', { type: 'error' })
    }
  }

  const handleNameChange = (userId, value) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, full_name: value } : u)))
  }

  const handleNameSave = async (userId, value) => {
    try {
      setSavingName((prev) => ({ ...prev, [userId]: true }))
      const { error } = await invokeAdmin({
        action: 'update-profile',
        userId,
        fullName: value
      })
      if (error) throw error
    } catch (err) {
      addToast(err.message || 'Error al actualizar nombre', { type: 'error' })
    } finally {
      setSavingName((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handleResendInvite = async (user) => {
    try {
      setResendingInvite((prev) => ({ ...prev, [user.id]: true }))
      const { error } = await invokeAdmin({
        action: 'resend-invite',
        userId: user.id,
        email: user.email
      })
      if (error) throw error
      addToast('Invitación reenviada', { type: 'success' })
    } catch (err) {
      addToast(err.message || 'Error al reenviar invitación', { type: 'error' })
    } finally {
      setResendingInvite((prev) => ({ ...prev, [user.id]: false }))
    }
  }

  const getRoleLabel = (value) => (value === 'tenant_admin' ? 'Admin' : 'Member')

  const getStatusPill = (user) => {
    if (user.disabled) {
      return { label: 'Inactivo', classes: 'bg-slate-100 text-slate-600 border-slate-200' }
    }
    if (user.email_confirmed) {
      return { label: 'Activo', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    }
    return { label: 'Pendiente', classes: 'bg-amber-50 text-amber-700 border-amber-200' }
  }

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Gestion de equipo</p>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight mt-2">Usuarios</h2>
            <p className="text-sm text-slate-500 mt-2">
              {context.tenantName ? `Organizacion: ${context.tenantName}` : 'Gestiona tu equipo.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Total</p>
              <p className="text-lg font-semibold text-slate-800">{users.length}</p>
            </div>
            <div className="px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500">Activos</p>
              <p className="text-lg font-semibold text-slate-800">
                {users.filter((u) => !u.disabled && u.email_confirmed).length}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Invitar usuario
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Usuarios de la organizacion</h3>
              <p className="text-sm text-slate-500">Administra roles, estados e invitaciones.</p>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando usuarios...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="px-6 py-4 text-left font-semibold">Nombre</th>
                    <th className="px-6 py-4 text-left font-semibold">Email</th>
                    <th className="px-6 py-4 text-left font-semibold">Rol</th>
                    <th className="px-6 py-4 text-left font-semibold">Estado</th>
                    <th className="px-6 py-4 text-left font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const status = getStatusPill(user)
                    return (
                      <tr key={user.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-semibold">
                              {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <input
                                type="text"
                                value={user.full_name || ''}
                                onChange={(event) => handleNameChange(user.id, event.target.value)}
                                placeholder="Nombre completo"
                                className="w-52 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                              />
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => handleNameSave(user.id, user.full_name || '')}
                                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                                  disabled={savingName[user.id]}
                                >
                                  {savingName[user.id] ? 'Guardando...' : 'Guardar cambios'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-700">{user.email}</td>
                        <td className="px-6 py-4">
                          <select
                            value={user.role}
                            onChange={(event) => handleRoleChange(user.id, event.target.value)}
                            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                          >
                            <option value="tenant_admin">Admin</option>
                            <option value="tenant_member">Member</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${status.classes}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {!user.email_confirmed && !user.disabled && (
                              <button
                                type="button"
                                onClick={() => handleResendInvite(user)}
                                className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition"
                                disabled={resendingInvite[user.id]}
                              >
                                {resendingInvite[user.id] ? 'Enviando...' : 'Reenviar'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => invokeAdmin({
                                action: 'set-user-status',
                                userId: user.id,
                                disabled: !user.disabled
                              }).then(() => {
                                setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, disabled: !u.disabled } : u))
                              }).catch((err) => addToast(err.message || 'Error al actualizar estado', { type: 'error' }))}
                              className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-600 hover:text-slate-800 hover:border-slate-300 transition"
                            >
                              {user.disabled ? 'Activar' : 'Inactivar'}
                            </button>
                            <span className="text-xs text-slate-400">{getRoleLabel(user.role)}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowInviteModal(false)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Invitar usuario</h3>
                <p className="text-sm text-slate-500 mt-1">Incorpora miembros con acceso inmediato.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre completo</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Nombre y apellido"
                  className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Correo corporativo</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="email@empresa.com"
                  className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rol</label>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="mt-2 w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                >
                  <option value="tenant_admin">Admin</option>
                  <option value="tenant_member">Member</option>
                </select>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition disabled:bg-slate-300"
                >
                  {inviting ? 'Enviando invitacion...' : 'Enviar invitacion'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default TenantUsersPanel
