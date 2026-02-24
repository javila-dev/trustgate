const getRuntimeEnv = () => {
  if (typeof window === 'undefined') return {}
  return window.__ENV__ || {}
}

export const getEnv = (key) => {
  const runtime = getRuntimeEnv()
  const runtimeValue = runtime[key]
  if (runtimeValue !== undefined && runtimeValue !== null && runtimeValue !== '') {
    return runtimeValue
  }
  return import.meta.env?.[key]
}

export const getSupabaseEnv = () => ({
  url: getEnv('VITE_SUPABASE_URL'),
  anonKey: getEnv('VITE_SUPABASE_ANON_KEY')
})
