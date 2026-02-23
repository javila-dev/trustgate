import { useState, useEffect } from 'react'
import { useToast } from './ToastProvider'

const FOLDER_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#ec4899', label: 'Rosa' },
  { value: '#f59e0b', label: 'Amarillo' },
  { value: '#10b981', label: 'Esmeralda' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#ef4444', label: 'Rojo' },
  { value: '#6b7280', label: 'Gris' },
]

const FolderModal = ({ isOpen, onClose, onSave, folder = null, loading = false }) => {
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState(FOLDER_COLORS[0].value)

  const isEditMode = !!folder

  useEffect(() => {
    if (isOpen) {
      if (folder) {
        setName(folder.name || '')
        setColor(folder.color || FOLDER_COLORS[0].value)
      } else {
        setName('')
        setColor(FOLDER_COLORS[0].value)
      }
    }
  }, [isOpen, folder])

  const handleSubmit = (e) => {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      addToast('El nombre de la carpeta es requerido', { type: 'error' })
      return
    }

    if (trimmedName.length > 100) {
      addToast('El nombre no puede exceder 100 caracteres', { type: 'error' })
      return
    }

    onSave({ name: trimmedName, color })
  }

  const handleClose = () => {
    setName('')
    setColor(FOLDER_COLORS[0].value)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        {/* Overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-black/50"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className="relative inline-block w-full max-w-md px-5 pt-6 pb-5 overflow-visible text-left align-bottom transition-all transform bg-white rounded-xl shadow-xl sm:my-8 sm:align-middle sm:p-7">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${color}20` }}
              >
                <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {isEditMode ? 'Editar carpeta' : 'Nueva carpeta'}
                </h3>
                <p className="text-sm text-slate-500">
                  {isEditMode ? 'Modifica los datos de la carpeta' : 'Crea una carpeta para organizar tus documentos'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Name input */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Nombre de la carpeta
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Contratos 2024"
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                autoFocus
                maxLength={100}
              />
            </div>

            {/* Color selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Color
              </label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`w-9 h-9 rounded-lg transition-all ${
                      color === c.value
                        ? 'ring-2 ring-offset-2 ring-slate-400 scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                  </>
                ) : (
                  isEditMode ? 'Guardar cambios' : 'Crear carpeta'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default FolderModal
