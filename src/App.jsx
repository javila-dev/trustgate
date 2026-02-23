import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Home from './pages/Home'
import SigningRoom from './pages/SigningRoom'
import Integrations from './pages/Integrations'
import DocumentDetail from './pages/DocumentDetail'
import Login from './pages/Login'
import AdminUsers from './pages/AdminUsers'
import OrganizationAccount from './pages/OrganizationAccount'
import { ToastProvider } from './components/ToastProvider'
import { supabase } from './supabaseClient'

const ProtectedRoute = ({ children }) => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="relative w-10 h-10 mx-auto mb-3">
            <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm text-slate-500">Validando sesión...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return children
}

function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={(
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/integrations"
          element={(
            <ProtectedRoute>
              <Integrations />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/document/:documentId"
          element={(
            <ProtectedRoute>
              <DocumentDetail />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin"
          element={(
            <ProtectedRoute>
              <AdminUsers />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/organization"
          element={(
            <ProtectedRoute>
              <OrganizationAccount />
            </ProtectedRoute>
          )}
        />
        <Route path="/sign/:transactionId" element={<SigningRoom />} />
      </Routes>
    </ToastProvider>
  )
}

export default App
