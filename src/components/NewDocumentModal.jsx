import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import PDFFieldPositioner from './PDFFieldPositioner'
import DocumensoService from '../services/documenso.service'
import { useToast } from './ToastProvider'
import { PDFDocument } from 'pdf-lib'

const NewDocumentModal = ({ isOpen, onClose, onDocumentCreated, existingDocument = null }) => {
  const { addToast } = useToast()
  const [step, setStep] = useState(1) // 1: Upload, 2: Signers, 3: Position Fields
  const [loading, setLoading] = useState(false)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const isEditMode = !!existingDocument

  // Document data
  const [file, setFile] = useState(null)
  const [sourceFiles, setSourceFiles] = useState([])
  const [merging, setMerging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [documentId, setDocumentId] = useState(null)
  const [originalFileUrl, setOriginalFileUrl] = useState(null) // Track original file URL

  // Signers data (with temporary IDs for field positioning)
  const [signers, setSigners] = useState([
    { id: `temp-${Date.now()}`, name: '', email: '', role: 'SIGNER', order: 1, requiresVerification: true }
  ])
  const [enforceSigningOrder, setEnforceSigningOrder] = useState(true)

  // Fields data
  const [fields, setFields] = useState([])
  const [roleMenu, setRoleMenu] = useState(null)

  // Load existing document data when in edit mode
  useEffect(() => {
    if (isOpen && existingDocument) {
      loadDocumentData(existingDocument.id)
    }
  }, [isOpen, existingDocument])

  useEffect(() => {
    if (!roleMenu) return

    const handleClickOutside = (event) => {
      if (!event.target.closest('[data-role-menu]')) {
        setRoleMenu(null)
      }
    }

    const handleScroll = () => setRoleMenu(null)
    const handleResize = () => setRoleMenu(null)

    window.addEventListener('click', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('click', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [roleMenu])

  const loadDocumentData = async (docId) => {
    try {
      setLoadingDocument(true)

      // Fetch document with signers and fields
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .select(`
          *,
          signers:document_signers(
            *,
            fields:signer_fields(*)
          )
        `)
        .eq('id', docId)
        .single()

      if (docError) throw docError

      // Check if anyone has signed - if so, prevent editing
      const hasSigned = docData.signers?.some(s => s.status === 'SIGNED')
      if (hasSigned) {
        addToast('No se puede editar un documento que ya ha sido firmado por alguien', { type: 'error' })
        onClose()
        return
      }

      // Load document data
      setDocumentId(docData.id)
      setFileName(docData.file_name)
      setOriginalFileUrl(docData.file_url) // Store original URL

      // Load PDF from storage if available
      if (docData.file_url) {
        try {
          // Download the PDF from Supabase Storage
          const { data: pdfBlob, error: downloadError } = await supabase.storage
            .from('documents')
            .download(docData.file_url)

          if (downloadError) throw downloadError

          // Convert blob to File object and mark it as from storage
          const pdfFile = new File([pdfBlob], docData.file_name, { type: 'application/pdf' })
          pdfFile._fromStorage = true // Custom flag to identify storage files
          setFile(pdfFile)
        } catch (pdfError) {
          console.error('Error loading PDF:', pdfError)
          // Continue without PDF - user can re-upload if needed
        }
      }

      // Load signers
      if (docData.signers && docData.signers.length > 0) {
        const loadedSigners = docData.signers.map(s => ({
          id: s.id, // Use real IDs for existing signers
          dbId: s.id, // Keep reference to database ID
          name: s.name,
          email: s.email,
          role: s.role,
          order: s.signing_order,
          requiresVerification: s.requires_verification
        }))
        setSigners(loadedSigners)
        const uniqueOrders = new Set(loadedSigners.map(s => s.order))
        setEnforceSigningOrder(uniqueOrders.size > 1)

        // Load fields
        const loadedFields = []
        docData.signers.forEach(signer => {
          if (signer.fields && signer.fields.length > 0) {
            signer.fields.forEach(field => {
              loadedFields.push({
                id: field.id,
                signerId: signer.id,
                type: field.field_type,
                page: field.page,
                positionX: parseFloat(field.position_x),
                positionY: parseFloat(field.position_y),
                width: parseFloat(field.width),
                height: parseFloat(field.height)
              })
            })
          }
        })
        setFields(loadedFields)
      }
    } catch (error) {
      console.error('Error loading document:', error)
      addToast(`Error al cargar el documento: ${error.message}`, { type: 'error' })
      onClose()
    } finally {
      setLoadingDocument(false)
    }
  }

  const normalizePdfName = (name) => {
    if (!name) return 'documento-combinado.pdf'
    return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
  }

  const mergePdfFiles = async (filesToMerge, mergedName) => {
    const mergedPdf = await PDFDocument.create()
    for (const pdfFile of filesToMerge) {
      const bytes = await pdfFile.arrayBuffer()
      const pdf = await PDFDocument.load(bytes)
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
      pages.forEach((page) => mergedPdf.addPage(page))
    }
    const mergedBytes = await mergedPdf.save()
    return new File([mergedBytes], mergedName, { type: 'application/pdf' })
  }

  const handleCreateFilesChange = async (e) => {
    const selected = Array.from(e.target.files || []).filter((item) => item.type === 'application/pdf')
    if (selected.length === 0) {
      addToast('Por favor selecciona archivos PDF', { type: 'error' })
      return
    }

    const nextFiles = [...sourceFiles, ...selected]
    setSourceFiles(nextFiles)

    if (!fileName) {
      setFileName(selected[0]?.name || '')
    }

    try {
      setMerging(true)
      const mergedFile = await mergePdfFiles(nextFiles, normalizePdfName(fileName || selected[0]?.name))
      setFile(mergedFile)
    } catch (error) {
      console.error('Error merging PDFs:', error)
      addToast('No se pudo combinar los PDFs. Intenta nuevamente.', { type: 'error' })
    } finally {
      setMerging(false)
      e.target.value = ''
    }
  }

  const handleEditFileChange = (e) => {
    const selectedFile = e.target.files[0]
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile)
      setFileName(selectedFile.name)
    } else {
      addToast('Por favor selecciona un archivo PDF', { type: 'error' })
    }
  }

  const reorderFile = async (index, direction) => {
    const next = [...sourceFiles]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= next.length) return
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    setSourceFiles(next)

    try {
      setMerging(true)
      const mergedFile = await mergePdfFiles(next, normalizePdfName(fileName || next[0]?.name))
      setFile(mergedFile)
    } catch (error) {
      console.error('Error merging PDFs:', error)
      addToast('No se pudo combinar los PDFs. Intenta nuevamente.', { type: 'error' })
    } finally {
      setMerging(false)
    }
  }

  const removeSourceFile = async (index) => {
    const next = sourceFiles.filter((_, idx) => idx !== index)
    setSourceFiles(next)

    if (next.length === 0) {
      setFile(null)
      return
    }

    try {
      setMerging(true)
      const mergedFile = await mergePdfFiles(next, normalizePdfName(fileName || next[0]?.name))
      setFile(mergedFile)
    } catch (error) {
      console.error('Error merging PDFs:', error)
      addToast('No se pudo combinar los PDFs. Intenta nuevamente.', { type: 'error' })
    } finally {
      setMerging(false)
    }
  }

  const addSigner = () => {
    setSigners([
      ...signers,
      {
        id: `temp-${Date.now()}`,
        name: '',
        email: '',
        role: 'SIGNER',
        order: enforceSigningOrder ? Math.max(...signers.map(s => s.order)) + 1 : 1,
        requiresVerification: true
      }
    ])
  }

  const removeSigner = (index) => {
    if (signers.length > 1) {
      const next = signers.filter((_, i) => i !== index)
      setSigners(
        enforceSigningOrder
          ? next.map((signer, idx) => ({ ...signer, order: idx + 1 }))
          : next
      )
    }
  }

  const toggleSigningOrder = () => {
    const nextValue = !enforceSigningOrder
    setEnforceSigningOrder(nextValue)
    setSigners((prev) =>
      prev.map((signer, index) => ({
        ...signer,
        order: nextValue ? index + 1 : 1
      }))
    )
  }

  const updateSigner = (index, field, value) => {
    const updated = [...signers]
    updated[index][field] = value
    setSigners(updated)
  }

  const handleFileNameBlur = async (value) => {
    const normalized = normalizePdfName(value)
    setFileName(normalized)

    if (file && sourceFiles.length > 0) {
      try {
        const bytes = await file.arrayBuffer()
        setFile(new File([bytes], normalized, { type: 'application/pdf' }))
      } catch (error) {
        console.error('Error renaming merged PDF:', error)
      }
    }
  }

  const handleSubmit = async () => {
    // Validation
    if (!isEditMode && !file) {
      addToast('Debes seleccionar un archivo PDF', { type: 'error' })
      return
    }
    if (!isEditMode && merging) {
      addToast('Espera a que se combinen los PDFs antes de continuar', { type: 'error' })
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (signers.some(s => !s.name || !s.email)) {
      addToast('Todos los firmantes deben tener nombre y email', { type: 'error' })
      return
    }
    if (signers.some(s => !emailRegex.test(String(s.email).trim()))) {
      addToast('Revisa los correos: hay direcciones con formato inválido', { type: 'error' })
      return
    }

    if (fields.length === 0) {
      addToast('Debes agregar al menos un campo de firma', { type: 'error' })
      return
    }

    try {
      setLoading(true)

      if (isEditMode) {
        // EDIT MODE: Update existing document
        await handleUpdate()
      } else {
        // CREATE MODE: Create new document
        await handleCreate()
      }
    } catch (error) {
      console.error(`Error ${isEditMode ? 'updating' : 'creating'} document:`, error)
      addToast(`Error al ${isEditMode ? 'actualizar' : 'crear'} el documento: ${error.message}`, { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    const requiresVerification = signers.some(s => s.requiresVerification)

    // 0. Get tenant_id (from current user)
    const { data: sessionData } = await supabase.auth.getSession()
    const userId = sessionData?.session?.user?.id
    if (!userId) {
      throw new Error('No hay sesión activa.')
    }

    const { data: tenantUser, error: tenantError } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .eq('user_id', userId)
      .single()

    if (tenantError || !tenantUser?.tenant_id) {
      throw new Error('No se encontró una organización asociada a tu usuario.')
    }

    // 0.1. Verify that Documenso credentials are configured
    const { data: integrations, error: integrationsError } = await supabase
      .from('tenant_integrations')
      .select('*')
      .eq('tenant_id', tenantUser.tenant_id)
      .eq('integration_type', 'documenso')
      .eq('is_enabled', true)

    if (integrationsError || !integrations || integrations.length === 0) {
      throw new Error('Debes configurar tu API Token de Documenso en la página de Integraciones antes de crear documentos.')
    }

    const documenso = integrations[0]
    const hasValidConfig =
      documenso.config?.api_token &&
      documenso.config?.base_url

    if (!hasValidConfig) {
      throw new Error('La configuración de Documenso está incompleta. Asegúrate de haber configurado el API Token y Base URL en Integraciones.')
    }

    const actorId = userId || null

    // 1. Upload PDF to Supabase Storage
    const timestamp = Date.now()
    const fileExt = fileName.split('.').pop()
    const filePath = `${timestamp}-${Math.random().toString(36).substring(7)}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) throw uploadError

    // 2. Create document record with file URL and tenant_id
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        file_name: fileName,
        file_url: filePath,
        status: 'DRAFT',
        requires_identity_verification: requiresVerification,
        tenant_id: tenantUser.tenant_id,
        metadata: sourceFiles.length > 1
          ? {
            source_files: sourceFiles.map((item) => item.name),
            source_count: sourceFiles.length
          }
          : undefined,
        created_by: actorId,
        updated_by: actorId
      })
      .select()
      .single()

    if (docError) throw docError

    // 3. Create signers and map temp IDs to real IDs
    const signersData = signers.map(s => ({
      document_id: document.id,
      name: s.name,
      email: s.email,
      role: s.role,
      signing_order: s.order,
      requires_verification: s.requiresVerification,
      status: 'PENDING'
    }))

    const { data: createdSigners, error: signersError } = await supabase
      .from('document_signers')
      .insert(signersData)
      .select()

    if (signersError) throw signersError

    // 4. Create field mappings (temp ID -> real ID)
    const signerIdMap = {}
    signers.forEach((signer, index) => {
      signerIdMap[signer.id] = createdSigners[index].id
    })

    // 5. Create signature fields with real signer IDs
    const fieldsData = fields.map(f => ({
      signer_id: signerIdMap[f.signerId],
      field_type: f.type,
      page: f.page,
      position_x: f.positionX,
      position_y: f.positionY,
      width: f.width,
      height: f.height,
      is_required: true
    }))

    const { error: fieldsError } = await supabase
      .from('signer_fields')
      .insert(fieldsData)

    if (fieldsError) throw fieldsError

    // 6. Send document to Documenso
    let documensoResponse
    try {
      documensoResponse = await DocumensoService.createDocument(
        file,
        fileName,
        signers.map((s, idx) => ({
          id: createdSigners[idx].id,
          name: s.name,
          email: s.email,
          role: s.role,
          order: s.order
        })),
        fields.map(f => ({
          signerId: signerIdMap[f.signerId],
          type: f.type,
          page: f.page,
          positionX: f.positionX,
          positionY: f.positionY,
          width: f.width,
          height: f.height,
          isRequired: true
        })),
        tenantUser.tenant_id
      )
    } catch (documensoError) {
      // Rollback: delete document (cascade will delete signers and fields)
      await supabase
        .from('documents')
        .delete()
        .eq('id', document.id)

      throw new Error(`Error al enviar documento a Documenso: ${documensoError.message}`)
    }

    // 7. Update document with Documenso envelope_id and change status to PENDING
    const { error: updateDocError } = await supabase
      .from('documents')
      .update({
        documenso_envelope_id: documensoResponse.envelopeId,
        status: 'PENDING'
      })
      .eq('id', document.id)

    if (updateDocError) {
      console.error('Error updating document with envelope_id:', updateDocError)
      // If quota/db constraints block the local update, rollback remote envelope + local draft.
      try {
        await DocumensoService.deleteEnvelope(documensoResponse.envelopeId, tenantUser.tenant_id)
      } catch (rollbackError) {
        console.error('Error rolling back envelope after local update failure:', rollbackError)
      }

      await supabase
        .from('documents')
        .delete()
        .eq('id', document.id)

      throw updateDocError
    }

    // 8. Update signers with Documenso recipient data and internal signing tokens
    for (const signerData of documensoResponse.signersData) {
      const signingToken = crypto.randomUUID()

      const { error: updateSignerError } = await supabase
        .from('document_signers')
        .update({
          documenso_recipient_token: signerData.recipientToken,
          signing_token: signingToken,
          documenso_recipient_id: signerData.documensoRecipientId,
          status: 'READY'
        })
        .eq('id', signerData.signerId)

      if (updateSignerError) {
        console.error('Error updating signer:', updateSignerError)
        // Continue with other signers
      }
    }

    // 9. Create audit logs
    await supabase
      .from('audit_log')
      .insert([
        {
          document_id: document.id,
          event_type: 'document_created',
          description: `Documento "${fileName}" creado con ${signers.length} firmante(s) y ${fields.length} campo(s)`,
          actor_type: 'admin',
          actor_id: actorId,
          event_data: {
            signers_count: signers.length,
            fields_count: fields.length
          }
        },
        {
          document_id: document.id,
          event_type: 'document_sent_to_documenso',
          description: `Documento "${fileName}" sellado para firma en Documenso`,
          actor_type: 'admin',
          actor_id: actorId,
          event_data: {
            envelope_id: documensoResponse.envelopeId
          }
        }
      ])

    addToast('Documento creado y enviado a Documenso exitosamente', { type: 'success' })
    onDocumentCreated?.(document)
    handleClose()
  }

  const handleUpdate = async () => {
    const requiresVerification = signers.some(s => s.requiresVerification)

    const { data: sessionData } = await supabase.auth.getSession()
    const actorId = sessionData?.session?.user?.id || null

    if (!file) {
      throw new Error('No se encontró el archivo del documento para re-sellar en Documenso.')
    }

    const { data: documentMeta, error: documentMetaError } = await supabase
      .from('documents')
      .select('tenant_id, documenso_envelope_id')
      .eq('id', documentId)
      .single()

    if (documentMetaError) throw documentMetaError

    // 1. If user uploaded a new PDF (not the one from storage), upload it
    let newFilePath = null
    const isNewUpload = file && !file._fromStorage

    if (isNewUpload) {
      // User uploaded a new PDF
      const timestamp = Date.now()
      const fileExt = fileName.split('.').pop()
      newFilePath = `${timestamp}-${Math.random().toString(36).substring(7)}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(newFilePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw uploadError

      // Delete old PDF if exists
      if (originalFileUrl) {
        await supabase.storage
          .from('documents')
          .remove([originalFileUrl])
      }
    }

    // 2. Update document metadata
    const updateData = {
      file_name: fileName,
      requires_identity_verification: requiresVerification,
      updated_at: new Date().toISOString(),
      updated_by: actorId
    }

    // Add new file path if uploaded
    if (newFilePath) {
      updateData.file_url = newFilePath
    }

    const { error: docError } = await supabase
      .from('documents')
      .update(updateData)
      .eq('id', documentId)

    if (docError) throw docError

    // 3. Get existing signer IDs
    const { data: existingSigners } = await supabase
      .from('document_signers')
      .select('id, email')
      .eq('document_id', documentId)

    const existingSignerIds = existingSigners?.map(s => s.id) || []

    // 4. Delete all existing signers and their fields (cascade will handle fields)
    const { error: deleteError } = await supabase
      .from('document_signers')
      .delete()
      .eq('document_id', documentId)

    if (deleteError) throw deleteError

    // 5. Create updated signers
    const signersData = signers.map(s => ({
      document_id: documentId,
      name: s.name,
      email: s.email,
      role: s.role,
      signing_order: s.order,
      requires_verification: s.requiresVerification,
      status: 'PENDING'
    }))

    const { data: createdSigners, error: signersError } = await supabase
      .from('document_signers')
      .insert(signersData)
      .select()

    if (signersError) throw signersError

    // 6. Create field mappings (old ID -> new ID)
    const signerIdMap = {}
    signers.forEach((signer, index) => {
      signerIdMap[signer.id] = createdSigners[index].id
    })

    // 7. Create updated signature fields
    const fieldsData = fields.map(f => ({
      signer_id: signerIdMap[f.signerId],
      field_type: f.type,
      page: f.page,
      position_x: f.positionX,
      position_y: f.positionY,
      width: f.width,
      height: f.height,
      is_required: true
    }))

    const { error: fieldsError } = await supabase
      .from('signer_fields')
      .insert(fieldsData)

    if (fieldsError) throw fieldsError

    // 8. Remove previous Documenso envelope (if any)
    if (documentMeta?.documenso_envelope_id) {
      try {
        await DocumensoService.deleteEnvelope(documentMeta.documenso_envelope_id, documentMeta.tenant_id)
      } catch (deleteError) {
        throw new Error(`No se pudo eliminar el documento anterior en Documenso: ${deleteError.message}`)
      }
    }

    // 9. Create a new Documenso envelope with updated content
    let documensoResponse
    try {
      documensoResponse = await DocumensoService.createDocument(
        file,
        fileName,
        createdSigners.map((s, idx) => ({
          id: s.id,
          name: signers[idx]?.name,
          email: signers[idx]?.email,
          role: signers[idx]?.role,
          order: signers[idx]?.order
        })),
        fields.map(f => ({
          signerId: signerIdMap[f.signerId],
          type: f.type,
          page: f.page,
          positionX: f.positionX,
          positionY: f.positionY,
          width: f.width,
          height: f.height,
          isRequired: true
        })),
        documentMeta?.tenant_id
      )
    } catch (documensoError) {
      throw new Error(`Error al re-sellar documento en Documenso: ${documensoError.message}`)
    }

    // 10. Update document with new envelope and set status to PENDING
    const { error: documensoUpdateError } = await supabase
      .from('documents')
      .update({
        documenso_envelope_id: documensoResponse.envelopeId,
        status: 'PENDING'
      })
      .eq('id', documentId)

    if (documensoUpdateError) throw documensoUpdateError

    // 11. Update signers with Documenso recipient data and internal signing tokens
    for (const signerData of documensoResponse.signersData) {
      const signingToken = crypto.randomUUID()

      const { error: updateSignerError } = await supabase
        .from('document_signers')
        .update({
          documenso_recipient_token: signerData.recipientToken,
          signing_token: signingToken,
          documenso_recipient_id: signerData.documensoRecipientId,
          status: 'READY'
        })
        .eq('id', signerData.signerId)

      if (updateSignerError) {
        console.error('Error updating signer:', updateSignerError)
      }
    }

    // 12. Create audit log for the update
    await supabase
      .from('audit_log')
      .insert([
        {
          document_id: documentId,
          event_type: 'document_updated',
          description: `Documento "${fileName}" actualizado con ${signers.length} firmante(s) y ${fields.length} campo(s)`,
          actor_type: 'admin',
          actor_id: actorId,
          event_data: {
            signers_count: signers.length,
            fields_count: fields.length,
            previous_signers: existingSignerIds.length
          }
        },
        {
          document_id: documentId,
          event_type: 'document_documenso_replaced',
          description: `Documento "${fileName}" re-sellado para firma en Documenso`,
          actor_type: 'admin',
          actor_id: actorId,
          event_data: {
            previous_envelope_id: documentMeta?.documenso_envelope_id || null,
            new_envelope_id: documensoResponse.envelopeId
          }
        }
      ])

    addToast('Documento actualizado exitosamente', { type: 'success' })
      onDocumentCreated?.(document)
    handleClose()
  }

  const handleClose = () => {
    setStep(1)
    setFile(null)
    setSourceFiles([])
    setMerging(false)
    setDragIndex(null)
    setFileName('')
    setDocumentId(null)
    setOriginalFileUrl(null)
    setSigners([{ id: `temp-${Date.now()}`, name: '', email: '', role: 'SIGNER', order: 1, requiresVerification: true }])
    setFields([])
    onClose()
  }

  if (!isOpen) return null

  const renderRoleMenu = () => {
    if (!roleMenu) return null
    const { index, rect } = roleMenu
    const top = rect.bottom + 8
    const left = Math.min(rect.left, window.innerWidth - 240)

    return createPortal(
      <div
        data-role-menu="true"
        className="fixed z-[70] w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 space-y-1"
        style={{ top, left }}
      >
        <button
          type="button"
          onClick={() => {
            updateSigner(index, 'role', 'SIGNER')
            setRoleMenu(null)
          }}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-slate-100 ${signers[index]?.role === 'SIGNER' ? 'bg-slate-100' : ''}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12l-3 3m0 0l-3-3m3 3V4m6 8a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Necesita firmar
        </button>
        <button
          type="button"
          onClick={() => {
            updateSigner(index, 'role', 'APPROVER')
            setRoleMenu(null)
          }}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-slate-100 ${signers[index]?.role === 'APPROVER' ? 'bg-slate-100' : ''}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Necesita aprobar
        </button>
        <button
          type="button"
          onClick={() => {
            updateSigner(index, 'role', 'VIEWER')
            setRoleMenu(null)
          }}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-slate-100 ${signers[index]?.role === 'VIEWER' ? 'bg-slate-100' : ''}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Necesita ver
        </button>
        <button
          type="button"
          onClick={() => {
            updateSigner(index, 'role', 'CC')
            setRoleMenu(null)
          }}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-slate-100 ${signers[index]?.role === 'CC' ? 'bg-slate-100' : ''}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-8 4h5M6 21h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Recibe copia
        </button>
      </div>,
      document.body
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        {/* Overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-black/50"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className={`relative inline-block w-full ${step === 3 ? 'max-w-[96rem]' : 'max-w-5xl'} px-5 pt-6 pb-5 ${step === 3 ? 'overflow-hidden' : 'overflow-visible'} text-left align-bottom transition-all duration-300 transform bg-white rounded-xl shadow-xl sm:my-8 sm:align-middle sm:p-7 max-h-[96vh] flex flex-col`}>
          <div className="flex-1 min-h-0 flex gap-5">
            {/* Sidebar */}
            <aside className="hidden lg:block lg:w-44 flex-shrink-0">
              <div className="mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {isEditMode
                      ? (step === 1 ? 'Editar Documento' : step === 2 ? 'Editar Firmantes' : 'Reposicionar Campos')
                      : (step === 1 ? 'Nuevo Documento' : step === 2 ? 'Agregar Firmantes' : 'Posicionar Campos')
                    }
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {isEditMode
                      ? (step === 1 ? 'Modifica el nombre del documento' : step === 2 ? 'Modifica los firmantes' : 'Ajusta la posición de los campos')
                      : (step === 1 ? 'Sube el PDF que necesitas firmar' : step === 2 ? 'Configura quiénes deben firmar' : 'Arrastra los campos de firma en el documento')
                    }
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {[1, 2, 3].map((stepIndex) => (
                  <div key={stepIndex} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                      step >= stepIndex ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {stepIndex}
                    </div>
                    <span className={`text-sm ${
                      step === stepIndex ? 'text-slate-900 font-semibold' : 'text-slate-500'
                    }`}>
                      {stepIndex === 1 ? 'Documento' : stepIndex === 2 ? 'Firmantes' : 'Campos'}
                    </span>
                  </div>
                ))}
              </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-h-0 flex flex-col">
          {/* Step 1: Upload PDF */}
          {step === 1 && (
            <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
              {loadingDocument ? (
                <div className="py-12 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
                  <p className="mt-4 text-slate-600">Cargando documento...</p>
                </div>
              ) : (
                <>
                  {/* File upload - only show in create mode */}
                  {!isEditMode && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Archivo PDF
                      </label>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".pdf"
                          multiple
                          onChange={handleCreateFilesChange}
                          className="hidden"
                          id="file-upload"
                        />
                        <label
                          htmlFor="file-upload"
                          className="flex items-center justify-center w-full px-6 py-8 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-emerald-500 transition-colors"
                        >
                          {file ? (
                            <div className="text-center">
                              <svg className="w-12 h-12 mx-auto text-emerald-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <p className="font-medium text-slate-900">{fileName}</p>
                              <p className="text-sm text-slate-500 mt-1">
                                {sourceFiles.length > 1 ? `${sourceFiles.length} PDFs combinados` : 'Click para cambiar'}
                              </p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <svg className="w-12 h-12 mx-auto text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                              <p className="font-medium text-slate-900">Arrastra un PDF o haz click</p>
                              <p className="text-sm text-slate-500 mt-1">Puedes cargar varios PDFs</p>
                            </div>
                          )}
                        </label>
                      </div>
                      {sourceFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>Orden de combinación</span>
                            <span>{(sourceFiles.reduce((acc, item) => acc + item.size, 0) / (1024 * 1024)).toFixed(2)} MB</span>
                            {merging && <span>Combinando PDFs...</span>}
                          </div>
                          <p className="text-xs text-slate-500">
                            Puedes reordenar arrastrando cada archivo. El orden que ves aquí será el orden final en el PDF combinado.
                          </p>
                          <div className="space-y-2">
                            {sourceFiles.map((item, index) => (
                              <div
                                key={`${item.name}-${index}`}
                                className={`flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ${dragIndex === index ? 'ring-2 ring-emerald-200' : ''}`}
                                draggable={!merging}
                                onDragStart={() => setDragIndex(index)}
                                onDragOver={(event) => {
                                  event.preventDefault()
                                }}
                                onDrop={() => {
                                  if (dragIndex === null || dragIndex === index) return
                                  const next = [...sourceFiles]
                                  const [moved] = next.splice(dragIndex, 1)
                                  next.splice(index, 0, moved)
                                  setSourceFiles(next)
                                  setDragIndex(null)
                                  setMerging(true)
                                  mergePdfFiles(next, normalizePdfName(fileName || next[0]?.name))
                                    .then((mergedFile) => setFile(mergedFile))
                                    .catch((error) => {
                                      console.error('Error merging PDFs:', error)
                                      addToast('No se pudo combinar los PDFs. Intenta nuevamente.', { type: 'error' })
                                    })
                                    .finally(() => setMerging(false))
                                }}
                                onDragEnd={() => setDragIndex(null)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs text-slate-400">{index + 1}.</span>
                                  <span className="text-sm text-slate-700 truncate">{item.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => reorderFile(index, -1)}
                                    disabled={index === 0 || merging}
                                    className="btn btn-ghost btn-xs"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => reorderFile(index, 1)}
                                    disabled={index === sourceFiles.length - 1 || merging}
                                    className="btn btn-ghost btn-xs"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeSourceFile(index)}
                                    disabled={merging}
                                    className="btn btn-ghost btn-xs text-red-500"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Edit mode: show info about PDF */}
                  {isEditMode && (
                    <>
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-blue-900">Modo edición</p>
                            <p className="text-sm text-blue-700 mt-1">
                              {file && file._fromStorage
                                ? 'El PDF original ha sido cargado automáticamente. Puedes modificar firmantes y reposicionar campos.'
                                : 'Puedes modificar el nombre del documento y los firmantes. Si necesitas reposicionar campos, carga el PDF abajo.'
                              }
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Show PDF status or allow re-upload */}
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          {file && file._fromStorage ? 'PDF cargado desde storage' : 'Reemplazar PDF (opcional)'}
                        </label>
                        {file && file._fromStorage ? (
                          <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                            <div className="flex items-center gap-2">
                              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="text-sm font-medium text-emerald-900">{fileName}</span>
                            </div>
                            <label htmlFor="file-upload-edit" className="text-sm text-emerald-600 hover:text-emerald-700 cursor-pointer font-medium">
                              Cambiar
                            </label>
                          </div>
                        ) : (
                          <label
                            htmlFor="file-upload-edit"
                            className="flex items-center justify-center w-full px-4 py-4 border border-slate-300 rounded-lg cursor-pointer hover:border-emerald-500 hover:bg-slate-50 transition-colors"
                          >
                            {file && !file._fromStorage ? (
                              <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-sm font-medium text-slate-900">Nuevo PDF cargado</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <span className="text-sm text-slate-600">Click para cargar PDF</span>
                              </div>
                            )}
                          </label>
                        )}
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={handleEditFileChange}
                          className="hidden"
                          id="file-upload-edit"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {/* File name override */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nombre del documento
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  onBlur={(e) => handleFileNameBlur(e.target.value)}
                  placeholder="Ej: Contrato de servicios 2026.pdf"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                <p className="text-sm text-slate-500 mt-2">
                  La verificación de identidad se configura por cada firmante en el siguiente paso
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Add Signers */}
          {step === 2 && (
            <div className="space-y-4 max-h-[64vh] overflow-y-auto pr-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Firmantes</h3>
                  <p className="text-sm text-slate-500">Agrega los firmantes del documento</p>
                </div>
                <button
                  onClick={addSigner}
                  className="btn btn-outline btn-sm gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Agregar firmante
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={enforceSigningOrder}
                    onChange={toggleSigningOrder}
                    className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                  />
                  <span className="font-medium">Habilitar orden de firma</span>
                </div>
                <span className="text-xs text-slate-400">Define el orden de firma por destinatario</span>
              </div>

              <div className="grid gap-3">
                <div className={`grid gap-3 text-xs font-medium text-slate-500 px-1 ${enforceSigningOrder ? 'lg:grid-cols-[1.2fr_1fr_auto_auto_auto]' : 'lg:grid-cols-[1.2fr_1fr_auto_auto]'}`}>
                  <span>Correo electrónico</span>
                  <span>Nombre</span>
                  {enforceSigningOrder && <span>Orden</span>}
                  <span>Rol</span>
                  <span className="lg:text-right">Acciones</span>
                </div>

                {signers.map((signer, index) => (
                  <div key={index} className="p-3 border border-slate-200 rounded-xl bg-white">
                    <div className={`grid gap-3 items-center ${enforceSigningOrder ? 'lg:grid-cols-[1.2fr_1fr_auto_auto_auto]' : 'lg:grid-cols-[1.2fr_1fr_auto_auto]'}`}>
                      <input
                        type="email"
                        value={signer.email}
                        onChange={(e) => updateSigner(index, 'email', e.target.value)}
                        placeholder="correo@empresa.com"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        value={signer.name}
                        onChange={(e) => updateSigner(index, 'name', e.target.value)}
                        placeholder={`Firmante ${index + 1}`}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                      {enforceSigningOrder && (
                        <input
                          type="number"
                          min="1"
                          value={signer.order}
                          onChange={(e) => updateSigner(index, 'order', parseInt(e.target.value))}
                          className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      )}
                      <button
                        type="button"
                        data-role-menu="true"
                        onClick={(event) => {
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          setRoleMenu((prev) =>
                            prev?.index === index ? null : { index, rect }
                          )
                        }}
                        className="flex items-center gap-2 px-2.5 py-2 border border-slate-300 rounded-lg text-sm bg-white hover:bg-slate-50"
                      >
                        <span className="text-slate-700">
                          {signer.role === 'SIGNER'
                            ? 'Necesita firmar'
                            : signer.role === 'APPROVER'
                              ? 'Necesita aprobar'
                              : signer.role === 'VIEWER'
                                ? 'Necesita ver'
                                : 'Recibe copia'}
                        </span>
                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <div className="flex items-center justify-end gap-2">
                        {signers.length > 1 && (
                          <button
                            onClick={() => removeSigner(index)}
                            className="p-2 text-red-600 hover:text-red-700 rounded-lg hover:bg-red-50"
                            title="Eliminar"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={signer.requiresVerification}
                        onChange={(e) => updateSigner(index, 'requiresVerification', e.target.checked)}
                        className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                      />
                      <label className="text-xs text-slate-700">
                        Requiere verificación de identidad
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Position Fields */}
          {step === 3 && (
            <div className="flex-1 min-h-[420px]">
              <PDFFieldPositioner
                file={file}
                signers={signers}
                onFieldsChange={setFields}
                initialFields={fields}
              />
            </div>
          )}
          </div>
        </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            {step === 1 ? (
              <>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={(!file && !isEditMode) || merging}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                >
                  Siguiente →
                </button>
              </>
            ) : step === 2 ? (
              <>
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  ← Atrás
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={signers.some(s => !s.name || !s.email)}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                >
                  Siguiente →
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  ← Atrás
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || fields.length === 0}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {isEditMode ? 'Actualizando...' : 'Creando...'}
                    </>
                  ) : (
                    isEditMode ? 'Actualizar documento' : 'Crear documento'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    {renderRoleMenu()}
    </>
  )
}

export default NewDocumentModal
