import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'
import { useNavigate } from 'react-router-dom'

const TenantUsers = () => {
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [context, setContext] = useState({
    tenantId: null,
    tenantName: '',
    isPlatformAdmin: false,
    isTenantAdmin: false
  })
  const [email, setEmail] = useState('')
  const [savingName, setSavingName] = useState({})
  const [resendingInvite, setResendingInvite] = useState({})
  const [removingUser, setRemovingUser] = useState({})
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('tenant_member')

  const invokeAdmin = async (body) => {
    const refresh = await supabase.auth.refreshSession()
    const token = refresh.data?.session?.access_token
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

  const loadUsers = async () => {
    try {
      setLoading(true)
      const { data, error } = await invokeAdmin({ action: 'list-users' })
      if (error) throw error
      setUsers(data?.users || [])
    } catch (err) {
      addToast(err?.context?.status ? `Error ${err.context.status}: ${err.message}` : (err.message || 'Error al cargar usuarios'), { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      if (!isMounted) return
      if (data?.session) {
        loadContext()
      } else {
        setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return
      if (session) {
        loadContext()
      } else {
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const loadContext = async () => {
    try {
      const { data, error } = await invokeAdmin({ action: 'get-context' })
      if (error) throw error
      setContext({
        tenantId: data?.tenantId || null,
        tenantName: data?.tenantName || '',
        isPlatformAdmin: !!data?.isPlatformAdmin,
        isTenantAdmin: !!data?.isTenantAdmin
      })
      if (data?.tenantId) {
        await loadUsers()
      } else {
        setLoading(false)
      }
    } catch (err) {
      if (err.message?.includes('Sesión expirada')) {
        addToast(err.message, { type: 'error' })
        navigate('/login')
        return
      }
      addToast(err?.context?.status ? `Error ${err.context.status}: ${err.message}` : (err.message || 'Error al cargar contexto'), { type: 'error' })
      setLoading(false)
    }
  }

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

  const handleToggleStatus = async (user) => {
    try {
      const { error } = await invokeAdmin({
        action: 'set-user-status',
        userId: user.id,
        disabled: !user.disabled
      })
      if (error) throw error
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, disabled: !u.disabled } : u)))
    } catch (err) {
      addToast(err.message || 'Error al actualizar estado', { type: 'error' })
    }
  }

  const handleRemoveUser = async (user) => {
    if (!confirm(`¿Estás seguro de que quieres eliminar a ${user.full_name || user.email} del tenant?\n\nEsto liberará al usuario para que pueda ser asignado a otro tenant.`)) {
      return
    }

    try {
      setRemovingUser((prev) => ({ ...prev, [user.id]: true }))
      const { error } = await invokeAdmin({
        action: 'remove-user-from-tenant',
        userId: user.id
      })
      if (error) throw error
      addToast('Usuario eliminado del tenant', { type: 'success' })
      // Remove user from local state
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
    } catch (err) {
      addToast(err.message || 'Error al eliminar usuario', { type: 'error' })
    } finally {
      setRemovingUser((prev) => ({ ...prev, [user.id]: false }))
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Usuarios de la organización</h1>
          <p className="text-sm text-slate-500">
            {context.tenantName ? `Organización: ${context.tenantName}` : 'Crea una organización para continuar.'}
          </p>
        </div>

        {context.tenantId && (
          <div className="card bg-base-100 shadow-sm border border-slate-200/60">
            <div className="card-body">
              <h2 className="card-title text-base">Invitar usuario</h2>
              <form onSubmit={handleInvite} className="grid gap-3 md:grid-cols-4">
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Nombre completo"
                  className="input input-bordered w-full"
                />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="email@empresa.com"
                  className="input input-bordered w-full"
                />
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="select select-bordered w-full"
                >
                  <option value="tenant_admin">Admin</option>
                  <option value="tenant_member">Member</option>
                </select>
                <button type="submit" disabled={inviting} className="btn btn-primary">
                  {inviting ? 'Enviando...' : 'Invitar'}
                </button>
              </form>
            </div>
          </div>
        )}

        {context.tenantId && (
          <div className="card bg-base-100 shadow-sm border border-slate-200/60">
            <div className="card-body">
              <h2 className="card-title text-base">Usuarios</h2>
              {loading ? (
                <div className="py-6 text-sm text-slate-500">Cargando usuarios...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td className="text-sm text-slate-700">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={user.full_name || ''}
                                onChange={(event) => handleNameChange(user.id, event.target.value)}
                                placeholder="Nombre completo"
                                className="input input-bordered input-sm w-48"
                              />
                              <button
                                type="button"
                                onClick={() => handleNameSave(user.id, user.full_name || '')}
                                className="btn btn-ghost btn-xs"
                                disabled={savingName[user.id]}
                              >
                                {savingName[user.id] ? '...' : 'Guardar'}
                              </button>
                            </div>
                          </td>
                          <td className="text-sm text-slate-700">{user.email}</td>
                          <td>
                            <select
                              value={user.role}
                              onChange={(event) => handleRoleChange(user.id, event.target.value)}
                              className="select select-bordered select-sm"
                            >
                              <option value="tenant_admin">Admin</option>
                              <option value="tenant_member">Member</option>
                            </select>
                          </td>
                          <td className="text-xs text-slate-500">
                            {user.disabled
                              ? 'Inactivo'
                              : user.email_confirmed
                                ? 'Activo'
                                : 'Esperando verificación'}
                          </td>
                          <td>
                            <div className="flex gap-1">
                              {!user.email_confirmed && !user.disabled && (
                                <button
                                  type="button"
                                  onClick={() => handleResendInvite(user)}
                                  className="btn btn-ghost btn-xs"
                                  disabled={resendingInvite[user.id]}
                                >
                                  {resendingInvite[user.id] ? 'Enviando...' : 'Reenviar'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(user)}
                                className="btn btn-ghost btn-xs"
                              >
                                {user.disabled ? 'Activar' : 'Inactivar'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveUser(user)}
                                className="btn btn-ghost btn-xs text-error hover:bg-error hover:text-white"
                                disabled={removingUser[user.id]}
                                title="Eliminar del tenant (libera al usuario)"
                              >
                                {removingUser[user.id] ? '...' : 'Eliminar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TenantUsers
