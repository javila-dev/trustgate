import jsPDF from 'jspdf'
import JSZip from 'jszip'
import DiditService from './didit.service'
import DocumensoService from './documenso.service'

/**
 * Audit Package Service
 * Generates audit report PDF and creates ZIP package with all verification documents
 */

const AuditPackageService = {
  /**
   * Format date for display
   */
  formatDate(dateString) {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  },

  /**
   * Generate SHA-256 hash of content
   */
  async generateHash(content) {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  },

  /**
   * Load logo as base64
   */
  async loadLogoBase64() {
    try {
      const response = await fetch('/logo.png')
      const blob = await response.blob()
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  },

  /**
   * Generate the audit report PDF with TrustGate branding
   */
  async generateAuditPdf({ document, signers, auditEvents, tenantName }) {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 15
    let y = 0

    // TrustGate Colors (matching SigningRoom style)
    const slateHeader = [51, 65, 85] // slate-700
    const slateHeaderDark = [30, 41, 59] // slate-800
    const slate600 = [71, 85, 105]
    const slate500 = [100, 116, 139]
    const slate400 = [148, 163, 184]
    const slate200 = [226, 232, 240]
    const slate50 = [248, 250, 252]
    const slate900 = [15, 23, 42]
    const emerald500 = [16, 185, 129]
    const emerald600 = [5, 150, 105]
    const emerald50 = [236, 253, 245]
    const white = [255, 255, 255]

    // Load logo
    const logoBase64 = await this.loadLogoBase64()
    const generatedAt = new Date().toISOString()

    // ============ HEADER SECTION ============
    // Dark header background (gradient simulation)
    doc.setFillColor(...slateHeader)
    doc.rect(0, 0, pageWidth, 45, 'F')
    doc.setFillColor(...slateHeaderDark)
    doc.rect(0, 35, pageWidth, 10, 'F')

    y = 12
    // Logo
    if (logoBase64) {
      doc.addImage(logoBase64, 'PNG', margin, y, 12, 12)
    }

    // TRUSTGATE text (uppercase, tracking)
    doc.setFontSize(11)
    doc.setTextColor(...slate200)
    doc.setFont(undefined, 'bold')
    doc.text('TRUSTGATE', margin + 16, y + 8)

    // Tenant name
    doc.setFontSize(8)
    doc.setTextColor(...slate400)
    doc.setFont(undefined, 'normal')
    doc.text(tenantName || 'Firma digital segura', margin + 16, y + 13)

    // Title on header
    y = 30
    doc.setFontSize(14)
    doc.setTextColor(...white)
    doc.setFont(undefined, 'bold')
    doc.text('Certificado de Auditoria de Firma Digital', margin, y)

    // Generated date on header right
    doc.setFontSize(8)
    doc.setTextColor(...slate400)
    doc.setFont(undefined, 'normal')
    doc.text(`Generado: ${this.formatDate(generatedAt)}`, pageWidth - margin - 55, y)

    y = 55

    // ============ DOCUMENT INFO SECTION ============
    doc.setFontSize(11)
    doc.setTextColor(...slate600)
    doc.setFont(undefined, 'bold')
    doc.text('Informacion del Documento', margin, y)
    y += 8

    // Document info box
    doc.setFillColor(...slate50)
    doc.setDrawColor(...slate200)
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 38, 2, 2, 'FD')

    y += 7
    doc.setFontSize(9)
    const docInfo = [
      ['Nombre:', document.file_name || 'N/A'],
      ['ID:', document.id || 'N/A'],
      ['Estado:', document.status || 'N/A'],
      ['Creado:', this.formatDate(document.created_at)],
      ['Completado:', this.formatDate(document.completed_at)],
      ['Documenso ID:', document.documenso_envelope_id || 'N/A']
    ]

    // Two columns
    const col1X = margin + 5
    const col2X = pageWidth / 2 + 5
    let row = 0
    docInfo.forEach(([label, value], index) => {
      const colX = index % 2 === 0 ? col1X : col2X
      if (index % 2 === 0 && index > 0) row++

      doc.setTextColor(...slate500)
      doc.setFont(undefined, 'normal')
      doc.text(label, colX, y + row * 6)
      doc.setTextColor(...slate900)
      doc.setFont(undefined, 'bold')
      const maxWidth = (pageWidth / 2) - 50
      const truncatedValue = value.length > 35 ? value.substring(0, 32) + '...' : value
      doc.text(truncatedValue, colX + 30, y + row * 6)
    })

    y += 45

    // ============ SIGNERS SECTION ============
    doc.setFontSize(11)
    doc.setTextColor(...slate600)
    doc.setFont(undefined, 'bold')
    doc.text('Cadena de Custodia de Identidad', margin, y)
    y += 8

    for (const signer of signers || []) {
      if (y > 220) {
        doc.addPage()
        y = 20
      }

      // Find verification events for this signer
      const signerEvents = (auditEvents || []).filter(e => e.signer_id === signer.id)
      const verificationStarted = signerEvents.find(e => e.event_type === 'identity_verification_started')
      const verificationCompleted = signerEvents.find(e => e.event_type === 'identity_verified')
      const signedEvent = signerEvents.find(e => e.event_type === 'recipient_signed')
      const hasSignature = signedEvent || signer.signed_at
      const signedTimestamp = signedEvent?.created_at || signer.signed_at

      // Calculate box height based on content
      const boxHeight = verificationCompleted && hasSignature ? 58 : 48

      // Signer box
      doc.setFillColor(...slate50)
      doc.setDrawColor(...slate200)
      doc.roundedRect(margin, y, pageWidth - 2 * margin, boxHeight, 2, 2, 'FD')

      // Signer header
      y += 7
      doc.setFontSize(10)
      doc.setTextColor(...slate900)
      doc.setFont(undefined, 'bold')
      doc.text(signer.name || 'Sin nombre', margin + 5, y)

      // Status badge
      if (signer.status === 'SIGNED') {
        doc.setFillColor(...emerald50)
        doc.roundedRect(pageWidth - margin - 25, y - 4, 20, 6, 1, 1, 'F')
        doc.setFontSize(7)
        doc.setTextColor(...emerald600)
        doc.text('FIRMADO', pageWidth - margin - 23, y)
      }

      doc.setFontSize(8)
      doc.setTextColor(...slate500)
      doc.setFont(undefined, 'normal')
      doc.text(`${signer.email || 'Sin email'}  |  Rol: ${signer.role || 'SIGNER'}`, margin + 5, y + 5)

      y += 12

      // Verification row
      doc.setFontSize(8)
      doc.setTextColor(...slate600)
      doc.setFont(undefined, 'bold')
      doc.text('Verificacion de Identidad:', margin + 5, y)
      doc.setFont(undefined, 'normal')

      if (verificationStarted || verificationCompleted || signer.verified_at) {
        const startTime = verificationStarted ? this.formatDate(verificationStarted.created_at) : 'N/A'
        const endTime = verificationCompleted ? this.formatDate(verificationCompleted.created_at) : (signer.verified_at ? this.formatDate(signer.verified_at) : 'N/A')
        doc.setTextColor(...slate900)
        doc.text(`Inicio: ${startTime}  |  Fin: ${endTime}`, margin + 48, y)
        doc.setTextColor(...emerald500)
        doc.text('VERIFICADO', pageWidth - margin - 25, y)
      } else {
        doc.setTextColor(...slate400)
        doc.text('No requerida', margin + 48, y)
      }

      y += 7

      // Signature row
      doc.setTextColor(...slate600)
      doc.setFont(undefined, 'bold')
      doc.text('Firma Digital:', margin + 5, y)
      doc.setFont(undefined, 'normal')

      if (hasSignature) {
        doc.setTextColor(...slate900)
        doc.text(`Firmado: ${this.formatDate(signedTimestamp)}`, margin + 48, y)
        doc.setTextColor(...emerald500)
        doc.text('COMPLETADO', pageWidth - margin - 28, y)
      } else {
        doc.setTextColor(...slate400)
        doc.text('Pendiente', margin + 48, y)
      }

      y += 8

      // Verification link badge
      if (verificationCompleted && hasSignature) {
        const verifiedAt = new Date(verificationCompleted.created_at)
        const signedAt = new Date(signedTimestamp)
        const diffMs = signedAt - verifiedAt
        const diffMins = Math.floor(diffMs / 60000)
        const diffSecs = Math.floor((diffMs % 60000) / 1000)

        doc.setFillColor(...emerald50)
        doc.roundedRect(margin + 3, y - 2, pageWidth - 2 * margin - 6, 8, 1, 1, 'F')
        doc.setFontSize(7)
        doc.setTextColor(...emerald600)
        doc.text(
          `VINCULACION VERIFICADA: Identidad verificada ${diffMins}m ${diffSecs}s antes de firmar`,
          margin + 6,
          y + 3
        )
        y += 10
      }

      y += boxHeight - (verificationCompleted && hasSignature ? 50 : 40)
    }

    // ============ TIMELINE SECTION ============
    if (y > 180) {
      doc.addPage()
      y = 20
    }

    y += 5
    doc.setFontSize(11)
    doc.setTextColor(...slate600)
    doc.setFont(undefined, 'bold')
    doc.text('Timeline de Eventos', margin, y)
    y += 8

    // Table header
    doc.setFillColor(...slateHeader)
    doc.rect(margin, y, pageWidth - 2 * margin, 7, 'F')
    doc.setFontSize(8)
    doc.setTextColor(...white)
    doc.setFont(undefined, 'bold')
    doc.text('Fecha/Hora', margin + 3, y + 5)
    doc.text('Evento', margin + 45, y + 5)
    doc.text('Descripcion', margin + 85, y + 5)
    y += 9

    doc.setFont(undefined, 'normal')
    doc.setFontSize(7)

    const descColumnStart = margin + 85
    const descColumnWidth = pageWidth - margin - descColumnStart - 3

    let rowBg = false
    for (const event of auditEvents || []) {
      const desc = event.description || ''
      const descLines = doc.splitTextToSize(desc, descColumnWidth)
      const rowHeight = Math.max(5, descLines.length * 3.5)

      if (y + rowHeight > 275) {
        doc.addPage()
        y = 20
      }

      // Alternating row background
      if (rowBg) {
        doc.setFillColor(...slate50)
        doc.rect(margin, y - 2, pageWidth - 2 * margin, rowHeight + 1, 'F')
      }
      rowBg = !rowBg

      doc.setTextColor(...slate500)
      doc.text(this.formatDate(event.created_at).substring(0, 17), margin + 3, y + 2)

      doc.setTextColor(...slate900)
      const eventType = (event.event_type || '').replace(/_/g, ' ')
      doc.text(eventType.substring(0, 22), margin + 45, y + 2)

      doc.setTextColor(...slate600)
      doc.text(descLines, descColumnStart, y + 2)

      y += rowHeight + 1
    }

    // ============ PACKAGE CONTENTS ============
    y += 8
    if (y > 250) {
      doc.addPage()
      y = 20
    }

    doc.setFontSize(9)
    doc.setTextColor(...slate600)
    doc.setFont(undefined, 'bold')
    doc.text('Contenido del Paquete:', margin, y)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(...slate500)
    doc.text('audit-report.pdf  |  didit-verification.pdf  |  signed-document.pdf', margin + 42, y)

    // ============ FOOTER ============
    const footerY = pageHeight - 12
    doc.setFillColor(...slate600)
    doc.rect(0, footerY - 5, pageWidth, 17, 'F')

    doc.setFontSize(7)
    doc.setTextColor(...slate400)
    doc.text('Firma segura con verificacion de identidad  |  Generado automaticamente por TrustGate', pageWidth / 2, footerY, { align: 'center' })
    doc.setFontSize(6)
    doc.text(`Timestamp: ${generatedAt}`, pageWidth / 2, footerY + 4, { align: 'center' })

    return doc.output('blob')
  },

  /**
   * Generate complete audit package (ZIP)
   */
  async generateAuditPackage({ document, signers, auditEvents, tenantName, diditSessionIds }) {
    const zip = new JSZip()
    const errors = []

    // 1. Generate audit report PDF
    try {
      const auditPdfBlob = await this.generateAuditPdf({
        document,
        signers,
        auditEvents,
        tenantName
      })
      zip.file('audit-report.pdf', auditPdfBlob)
    } catch (error) {
      console.error('Error generating audit PDF:', error)
      errors.push('No se pudo generar el reporte de auditoria')
    }

    // 2. Download Didit verification PDFs (one per signer with verification)
    if (diditSessionIds && diditSessionIds.length > 0) {
      for (let i = 0; i < diditSessionIds.length; i++) {
        const { sessionId, signerName } = diditSessionIds[i]
        try {
          const diditBlob = await DiditService.generatePdf(sessionId)
          const fileName = diditSessionIds.length > 1
            ? `didit-verification-${signerName.replace(/\s+/g, '-').toLowerCase()}.pdf`
            : 'didit-verification.pdf'
          zip.file(fileName, diditBlob)
        } catch (error) {
          console.error(`Error downloading Didit PDF for ${signerName}:`, error)
          errors.push(`No se pudo descargar verificacion de Didit para ${signerName}`)
        }
      }
    }

    // 3. Download Documenso signed document PDF
    if (document.documenso_envelope_id && document.status === 'COMPLETED') {
      try {
        const { blob } = await DocumensoService.downloadCompletedDocument(
          document.documenso_envelope_id
        )
        zip.file('signed-document.pdf', blob)
      } catch (error) {
        console.error('Error downloading Documenso PDF:', error)
        errors.push('No se pudo descargar el documento firmado de Documenso')
      }
    }

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' })

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const docName = (document.file_name || 'documento').replace(/\.[^/.]+$/, '').replace(/\s+/g, '-')
    const fileName = `audit-package-${docName}-${timestamp}.zip`

    return { zipBlob, fileName, errors }
  },

  /**
   * Download the audit package
   */
  async downloadAuditPackage(options) {
    const { zipBlob, fileName, errors } = await this.generateAuditPackage(options)

    // Trigger download
    const url = URL.createObjectURL(zipBlob)
    const a = window.document.createElement('a')
    a.href = url
    a.download = fileName
    window.document.body.appendChild(a)
    a.click()
    window.document.body.removeChild(a)
    URL.revokeObjectURL(url)

    return { fileName, errors }
  }
}

export default AuditPackageService
