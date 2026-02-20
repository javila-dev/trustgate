import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useToast } from '../components/ToastProvider'

const Login = () => {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingToken, setCheckingToken] = useState(true)

  useEffect(() => {
    let isMounted = true

    // Verificar hash ACTUAL (no uno guardado)
    const currentHash = window.location.hash
    const hashParams = new URLSearchParams(currentHash.substring(1))
    const type = hashParams.get('type')

    console.log('Login mount - hash:', currentHash, 'type:', type)

    // Si hay un token de invitación/recuperación en la URL actual
    if (type === 'invite' || type === 'recovery' || type === 'signup') {
      setMode('set-password')
      setCheckingToken(false)
      return
    }

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession()
      if (!isMounted) return

      if (data.session) {
        navigate('/')
      }
      setCheckingToken(false)
    }

    // Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return

      console.log('Auth event:', event)

      if (event === 'PASSWORD_RECOVERY') {
        setMode('set-password')
        setCheckingToken(false)
      } else if (event === 'SIGNED_IN' && mode !== 'set-password') {
        navigate('/')
      }
    })

    checkSession()

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [navigate, mode])

  const handleLogin = async (event) => {
    event.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) throw error
      navigate('/')
    } catch (error) {
      addToast(error.message || 'Error al iniciar sesión', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleRecovery = async (event) => {
    event.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`
      })
      if (error) throw error
      addToast('Te enviamos un correo para recuperar tu contraseña', { type: 'success' })
    } catch (error) {
      addToast(error.message || 'Error al enviar recuperación', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleSetPassword = async (event) => {
    event.preventDefault()

    if (password !== confirmPassword) {
      addToast('Las contraseñas no coinciden', { type: 'error' })
      return
    }

    if (password.length < 6) {
      addToast('La contraseña debe tener al menos 6 caracteres', { type: 'error' })
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      // Limpiar el hash de la URL
      window.history.replaceState(null, '', window.location.pathname)

      addToast('Contraseña establecida correctamente', { type: 'success' })
      navigate('/')
    } catch (error) {
      addToast(error.message || 'Error al establecer contraseña', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'set-password': return 'Establece tu contraseña'
      case 'recovery': return 'Recuperar acceso'
      default: return 'Bienvenido'
    }
  }

  const getSubtitle = () => {
    switch (mode) {
      case 'set-password': return 'Crea una contraseña para tu cuenta'
      case 'recovery': return 'Te enviaremos un enlace de recuperación'
      default: return 'Inicia sesión para continuar'
    }
  }

  const getSubmitHandler = () => {
    switch (mode) {
      case 'set-password': return handleSetPassword
      case 'recovery': return handleRecovery
      default: return handleLogin
    }
  }

  const getButtonText = () => {
    switch (mode) {
      case 'set-password': return 'Establecer contraseña'
      case 'recovery': return 'Enviar enlace'
      default: return 'Iniciar sesión'
    }
  }

  if (checkingToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center p-4">
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-200/30 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white/80 backdrop-blur-sm border border-emerald-100 rounded-3xl shadow-xl shadow-emerald-900/5 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl shadow-lg shadow-emerald-500/30 overflow-hidden">
                <img src="/logo.png" alt="TrustGate" className="w-full h-full object-contain" />
              </div>
              <div className="text-left">
                <div className="brand-wordmark text-slate-800">TrustGate</div>
                <p className="text-xs text-slate-400">Firma digital segura</p>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-slate-800">
              {getTitle()}
            </h1>
            <p className="text-slate-500 mt-1">
              {getSubtitle()}
            </p>
          </div>

          {/* Mode Toggle - Solo mostrar si no estamos en set-password */}
          {mode !== 'set-password' && (
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'login'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Iniciar sesión
              </button>
              <button
                onClick={() => setMode('recovery')}
                className={`flex-1 py-2 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'recovery'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Recuperar
              </button>
            </div>
          )}

          {/* Form */}
          <form onSubmit={getSubmitHandler()} className="space-y-5">
            {/* Email - solo para login y recovery */}
            {mode !== 'set-password' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 transition-all duration-200 focus:outline-none focus:bg-white focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                  placeholder="tu@empresa.com"
                />
              </div>
            )}

            {/* Password - para login y set-password */}
            {(mode === 'login' || mode === 'set-password') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {mode === 'set-password' ? 'Nueva contraseña' : 'Contraseña'}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 transition-all duration-200 focus:outline-none focus:bg-white focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
            )}

            {/* Confirm Password - solo para set-password */}
            {mode === 'set-password' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmar contraseña</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 transition-all duration-200 focus:outline-none focus:bg-white focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                  placeholder="••••••••"
                  minLength={6}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Procesando...
                </span>
              ) : getButtonText()}
            </button>
          </form>
        </div>

        {/* Footer text */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="font-medium">Firma segura con verificación de identidad</span>
        </div>
      </div>
    </div>
  )
}

export default Login
