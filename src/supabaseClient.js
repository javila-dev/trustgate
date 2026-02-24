import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from './utils/env'

// Obtener variables de entorno
const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabaseEnv()

// Validar que las variables existan
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno: VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY'
  )
}

// Crear y exportar el cliente de Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
