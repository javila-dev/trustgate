import { useState } from 'react'

const FolderCard = ({
  folder,
  isSelected = false,
  onSelect,
  onEdit,
  onDelete,
  onDrop,
}) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const documentId = e.dataTransfer.getData('documentId')
    if (documentId && onDrop) {
      onDrop(documentId, folder.id)
    }
  }

  const handleClick = (e) => {
    if (e.target.closest('[data-menu]')) return
    onSelect(folder.id)
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        group relative px-4 py-3 rounded-xl border-2 cursor-pointer
        transition-all duration-200 min-w-[140px]
        ${isSelected
          ? 'border-emerald-500 bg-emerald-50'
          : 'border-slate-200 hover:border-slate-300 bg-white'
        }
        ${isDragOver
          ? 'border-dashed border-emerald-400 bg-emerald-50/50 scale-105'
          : ''
        }
      `}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: folder.color || '#6366f1'
      }}
    >
      {/* Folder icon and info */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${folder.color || '#6366f1'}20` }}
        >
          <svg
            className="w-5 h-5"
            style={{ color: folder.color || '#6366f1' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">
            {folder.name}
          </p>
          <p className="text-xs text-slate-500">
            {folder.documentCount || 0} {folder.documentCount === 1 ? 'documento' : 'documentos'}
          </p>
        </div>
      </div>

      {/* Menu button - visible on hover */}
      <div
        data-menu="true"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                }}
              />
              <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                    onEdit(folder)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Editar
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                    onDelete(folder.id)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Drop indicator */}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-emerald-50/80 rounded-xl border-2 border-dashed border-emerald-400 pointer-events-none">
          <span className="text-xs font-medium text-emerald-600">Soltar aquí</span>
        </div>
      )}
    </div>
  )
}

export default FolderCard
