import { useState, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

const PDFFieldPositioner = ({ file, signers, onFieldsChange, initialFields = [], readOnly = false }) => {
  const [numPages, setNumPages] = useState(null)
  const [fields, setFields] = useState(initialFields)
  const [selectedSignerId, setSelectedSignerId] = useState(signers[0]?.id || null)
  const [draggedFieldId, setDraggedFieldId] = useState(null)
  const [resizeDirection, setResizeDirection] = useState(null)
  const [dragStartPos, setDragStartPos] = useState(null)
  const [scale, setScale] = useState(1)

  // Refs for smooth dragging without re-renders
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const fieldStartPosRef = useRef({ x: 0, y: 0 })
  const fieldRefsMap = useRef({})
  const pageRefsMap = useRef({})
  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(false)
  const currentDragPageRef = useRef(null)

  useEffect(() => {
    if (signers.length > 0 && !selectedSignerId) {
      setSelectedSignerId(signers[0].id)
    }
  }, [signers, selectedSignerId])

  // Update fields when initialFields change (for edit mode)
  useEffect(() => {
    setFields(initialFields)
  }, [initialFields])

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages)
  }

  const getSignerColor = (signerId) => {
    const colors = [
      'bg-emerald-500',
      'bg-blue-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-orange-500',
      'bg-cyan-500'
    ]
    const index = signers.findIndex(s => s.id === signerId)
    return colors[index % colors.length]
  }

  const addField = (pageNumber, e) => {
    if (readOnly) return
    if (!selectedSignerId || isDraggingRef.current || isResizingRef.current) return

    const pageRef = pageRefsMap.current[pageNumber]
    if (!pageRef) return

    // Check if we actually moved (to distinguish from drag that ended on container)
    if (dragStartPos) {
      const moved = Math.abs(e.clientX - dragStartPos.x) > 5 || Math.abs(e.clientY - dragStartPos.y) > 5
      if (moved) {
        setDragStartPos(null)
        return
      }
    }

    const rect = pageRef.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Convert to percentage (0-100)
    const positionX = (x / rect.width) * 100
    const positionY = (y / rect.height) * 100

    const newField = {
      id: `field-${Date.now()}`,
      signerId: selectedSignerId,
      type: 'SIGNATURE',
      page: pageNumber,
      positionX: Math.max(0, Math.min(85, positionX)),
      positionY: Math.max(0, Math.min(92, positionY)),
      width: 15,
      height: 6
    }

    const updatedFields = [...fields, newField]
    setFields(updatedFields)
    onFieldsChange(updatedFields)
  }

  const moveFieldVisual = (fieldId, e) => {
    const field = fields.find(f => f.id === fieldId)
    if (!field) return

    const pageRef = pageRefsMap.current[currentDragPageRef.current || field.page]
    if (!pageRef) return

    const rect = pageRef.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100

    const positionX = mouseX - dragOffsetRef.current.x
    const positionY = mouseY - dragOffsetRef.current.y

    const clampedX = Math.max(0, Math.min(100 - field.width, positionX))
    const clampedY = Math.max(0, Math.min(100 - field.height, positionY))

    // Update DOM directly for smooth movement
    const fieldEl = fieldRefsMap.current[fieldId]
    if (fieldEl) {
      fieldEl.style.left = `${clampedX}%`
      fieldEl.style.top = `${clampedY}%`
    }

    // Store current position for final update
    fieldStartPosRef.current = { x: clampedX, y: clampedY }
  }

  const commitFieldPosition = (fieldId) => {
    const { x, y } = fieldStartPosRef.current
    const updatedFields = fields.map(f =>
      f.id === fieldId ? { ...f, positionX: x, positionY: y } : f
    )
    setFields(updatedFields)
    onFieldsChange(updatedFields)
  }

  const resizeFieldVisual = (fieldId, e) => {
    if (!resizeDirection) return

    const field = fields.find(f => f.id === fieldId)
    if (!field) return

    const pageRef = pageRefsMap.current[field.page]
    if (!pageRef) return

    const rect = pageRef.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100

    let newX = field.positionX
    let newY = field.positionY
    let newWidth = field.width
    let newHeight = field.height

    if (resizeDirection.includes('e')) {
      newWidth = Math.max(5, Math.min(mouseX - field.positionX, 100 - field.positionX))
    }
    if (resizeDirection.includes('s')) {
      newHeight = Math.max(3, Math.min(mouseY - field.positionY, 100 - field.positionY))
    }
    if (resizeDirection.includes('w')) {
      const proposedX = Math.max(0, mouseX)
      const widthDiff = field.positionX - proposedX
      if (widthDiff + field.width >= 5) {
        newX = proposedX
        newWidth = field.width + widthDiff
      }
    }
    if (resizeDirection.includes('n')) {
      const proposedY = Math.max(0, mouseY)
      const heightDiff = field.positionY - proposedY
      if (heightDiff + field.height >= 3) {
        newY = proposedY
        newHeight = field.height + heightDiff
      }
    }

    // Update DOM directly
    const fieldEl = fieldRefsMap.current[fieldId]
    if (fieldEl) {
      fieldEl.style.left = `${newX}%`
      fieldEl.style.top = `${newY}%`
      fieldEl.style.width = `${newWidth}%`
      fieldEl.style.height = `${newHeight}%`
    }

    // Store for final commit
    fieldStartPosRef.current = { x: newX, y: newY, width: newWidth, height: newHeight }
  }

  const commitFieldResize = (fieldId) => {
    const { x, y, width, height } = fieldStartPosRef.current
    const updatedFields = fields.map(f =>
      f.id === fieldId ? { ...f, positionX: x, positionY: y, width, height } : f
    )
    setFields(updatedFields)
    onFieldsChange(updatedFields)
  }

  const removeField = (fieldId) => {
    const updatedFields = fields.filter(f => f.id !== fieldId)
    setFields(updatedFields)
    onFieldsChange(updatedFields)
  }

  const handleMouseDown = (fieldId, pageNumber, e) => {
    e.stopPropagation()
    const field = fields.find(f => f.id === fieldId)
    if (!field) return

    const pageRef = pageRefsMap.current[pageNumber]
    if (!pageRef) return

    const rect = pageRef.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 100
    const mouseY = ((e.clientY - rect.top) / rect.height) * 100

    dragOffsetRef.current = {
      x: mouseX - field.positionX,
      y: mouseY - field.positionY
    }
    fieldStartPosRef.current = { x: field.positionX, y: field.positionY }
    currentDragPageRef.current = pageNumber

    setDragStartPos({ x: e.clientX, y: e.clientY })
    isDraggingRef.current = true
    setDraggedFieldId(fieldId)
  }

  const handleResizeStart = (fieldId, direction, e) => {
    e.stopPropagation()
    const field = fields.find(f => f.id === fieldId)
    if (field) {
      fieldStartPosRef.current = {
        x: field.positionX,
        y: field.positionY,
        width: field.width,
        height: field.height
      }
    }
    isResizingRef.current = true
    setDraggedFieldId(fieldId)
    setResizeDirection(direction)
  }

  const handleMouseMove = (e) => {
    if (readOnly) return
    if (isResizingRef.current && draggedFieldId) {
      resizeFieldVisual(draggedFieldId, e)
    } else if (isDraggingRef.current && draggedFieldId) {
      moveFieldVisual(draggedFieldId, e)
    }
  }

  const handleMouseUp = () => {
    if (readOnly) return
    if (isDraggingRef.current && draggedFieldId) {
      commitFieldPosition(draggedFieldId)
    }
    if (isResizingRef.current && draggedFieldId) {
      commitFieldResize(draggedFieldId)
    }

    isDraggingRef.current = false
    isResizingRef.current = false
    currentDragPageRef.current = null
    setDraggedFieldId(null)
    setResizeDirection(null)
    setTimeout(() => setDragStartPos(null), 10)
  }

  const getSignerName = (signerId) => {
    return signers.find(s => s.id === signerId)?.name || 'Firmante'
  }

  const getSignerInitials = (signerId) => {
    const name = signers.find(s => s.id === signerId)?.name || ''
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getFieldsForPage = (pageNumber) => fields.filter(f => f.page === pageNumber)

  const renderField = (field, pageNumber) => (
    <div
      key={field.id}
      ref={(el) => { fieldRefsMap.current[field.id] = el }}
      style={{
        position: 'absolute',
        left: `${field.positionX}%`,
        top: `${field.positionY}%`,
        width: `${field.width}%`,
        height: `${field.height}%`,
        cursor: readOnly ? 'default' : (draggedFieldId === field.id ? 'grabbing' : 'grab'),
        willChange: draggedFieldId === field.id ? 'left, top, width, height' : 'auto'
      }}
      className={`${getSignerColor(field.signerId)} bg-opacity-50 border-2 border-current rounded flex items-center justify-center group`}
      onMouseDown={readOnly ? undefined : (e) => handleMouseDown(field.id, pageNumber, e)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-sm font-bold text-white pointer-events-none select-none drop-shadow-sm">
        {getSignerInitials(field.signerId)}
      </span>

      {!readOnly && (
        <>
          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeField(field.id)
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-20 shadow-md"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Resize handles */}
          <div
            onMouseDown={(e) => handleResizeStart(field.id, 'nw', e)}
            className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-slate-400 rounded-full opacity-0 group-hover:opacity-100 cursor-nw-resize z-10"
          />
          <div
            onMouseDown={(e) => handleResizeStart(field.id, 'sw', e)}
            className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-slate-400 rounded-full opacity-0 group-hover:opacity-100 cursor-sw-resize z-10"
          />
          <div
            onMouseDown={(e) => handleResizeStart(field.id, 'se', e)}
            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-slate-400 rounded-full opacity-0 group-hover:opacity-100 cursor-se-resize z-10"
          />
        </>
      )}
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row-reverse gap-6 h-full min-h-0">
      {/* Left Panel - Controls */}
      <div className="w-full lg:w-64 space-y-3 flex-shrink-0 h-full min-h-0 overflow-y-auto pr-2 pb-6">
        {!readOnly && (
          <>
            {/* Signer Selection */}
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <h4 className="font-medium text-slate-900 mb-2 text-sm">Firmante Actual</h4>
              <select
                value={selectedSignerId || ''}
                onChange={(e) => setSelectedSignerId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {signers.map((signer) => (
                  <option key={signer.id} value={signer.id}>
                    {signer.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-2">
                Haz click en el PDF para agregar campos de firma
              </p>
            </div>

            {/* Field List */}
            <div className="bg-white p-3 rounded-lg border border-slate-200">
              <h4 className="font-medium text-slate-900 mb-2 text-sm">
                Campos ({fields.length})
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {fields.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No hay campos agregados
                  </p>
                ) : (
                  fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className={`w-3 h-3 rounded-full ${getSignerColor(field.signerId)} flex-shrink-0`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-900 truncate">
                            {getSignerName(field.signerId)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Página {field.page}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeField(field.id)}
                        className="p-1 hover:bg-slate-200 rounded transition-colors flex-shrink-0"
                      >
                        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Legend */}
        <div className="bg-white p-3 rounded-lg border border-slate-200">
          <h4 className="font-medium text-slate-900 mb-2 text-sm">Leyenda</h4>
          <div className="space-y-2">
            {signers.map((signer) => (
              <div key={signer.id} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getSignerColor(signer.id)}`} />
                <span className="text-xs text-slate-700 truncate">{signer.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - PDF Viewer */}
      <div className="flex-1 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 flex flex-col min-w-0 min-h-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white flex-shrink-0">
          <span className="text-xs text-slate-500">
            {numPages ? `${numPages} página${numPages > 1 ? 's' : ''}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScale((current) => Math.max(0.5, Number((current - 0.1).toFixed(2))))}
              className="btn btn-ghost btn-xs"
            >
              -
            </button>
            <span className="text-xs text-slate-500 min-w-[48px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((current) => Math.min(2, Number((current + 0.1).toFixed(2))))}
              className="btn btn-ghost btn-xs"
            >
              +
            </button>
          </div>
        </div>
        <div
          className="flex-1 overflow-auto min-h-0"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="flex flex-col items-center gap-4 p-4">
            <Document
              file={file}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center p-12">
                  <div className="w-8 h-8 border-4 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
                </div>
              }
              error={
                <div className="p-12 text-center text-red-600">
                  Error al cargar el PDF
                </div>
              }
            >
              {numPages && Array.from({ length: numPages }, (_, index) => {
                const pageNumber = index + 1
                const pageFields = getFieldsForPage(pageNumber)

                return (
                  <div
                    key={pageNumber}
                    className="relative mb-4 last:mb-0 shadow-lg"
                    ref={(el) => { pageRefsMap.current[pageNumber] = el }}
                    onClick={readOnly ? undefined : (e) => addField(pageNumber, e)}
                    style={{ cursor: readOnly ? 'default' : (draggedFieldId ? 'grabbing' : 'crosshair') }}
                  >
                    {/* Page number indicator */}
                    <div className="absolute -top-6 left-0 text-xs text-slate-400">
                      Página {pageNumber}
                    </div>

                    <Page
                      pageNumber={pageNumber}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      scale={scale}
                    />

                    {/* Render fields for this page */}
                    {pageFields.map((field) => renderField(field, pageNumber))}
                  </div>
                )
              })}
            </Document>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PDFFieldPositioner
