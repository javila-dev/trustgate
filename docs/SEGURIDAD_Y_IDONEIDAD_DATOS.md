# Documento de soporte: integridad documental, validez de firma y evidencia

**Propósito**  
Este documento describe los controles técnicos que respaldan la **integridad de los documentos**, la **validez de la firma** y la **trazabilidad de la evidencia**. Está orientado a demostrar que el PDF firmado es el mismo que el cliente autorizó, que la firma es válida y que el proceso es auditable. Se cubren: cadena de custodia, sellado, verificación de identidad, auditoría, uso de servicios externos y gestión de riesgos.

---

## 1) Arquitectura general

**Componentes principales**
- **Frontend web** (React + Vite): interfaz para crear y gestionar documentos, firmantes, verificación de identidad y revisión manual.
- **Backend serverless** (Supabase Edge Functions): lógica de negocio y webhooks.
- **Base de datos** (PostgreSQL gestionado por Supabase): persistencia de documentos, firmantes, auditoría, verificaciones e integraciones.
- **Servicios externos**:
  - **Documenso**: orquestación de firma electrónica y emisión de URLs de firma.
  - **Didit**: verificación de identidad (KYC), con webhooks para actualizaciones de estado.
  - **Resend**: envío de correos transaccionales (ej. continuidad de firma tras revisión).

**Flujo general**
1) El administrador crea un documento, define firmantes y campos.  
2) Se genera el “sobre” en Documenso y se almacenan tokens/IDs de firma.  
3) Para firmantes con verificación, se inicia sesión en Didit.  
4) Webhooks de Didit actualizan el estado de verificación.  
5) La firma se completa en Documenso, y el sistema actualiza estados internos y registra auditoría.

---

## 2) Integridad documental y validez de la firma

**Garantía de que el PDF firmado es el correcto**
- El documento se **sella en Documenso** para firma; el sobre resultante mantiene la integridad del archivo.  
- El identificador del sobre (`documenso_envelope_id`) se almacena y **vincula** al documento interno.  
- El PDF final firmado se obtiene directamente desde Documenso, preservando el **mismo contenido** que fue presentado para firma.

**Evidencia de firma válida**
- Se conserva la relación entre documento, firmantes y estados (`document_signers`).  
- La firma se marca como completada sólo cuando Documenso confirma la firma (`SIGNED`).  
- Se registran tiempos críticos (`signed_at`, `verified_at`) y el estado del documento (`COMPLETED`) una vez que todos los firmantes concluyen.

**Cadena de custodia**
- Cada acción relevante genera un evento en `audit_log` (creación, envío, verificación, revisión manual, firma, cancelación).  
- Esto permite reconstruir **quién**, **cuándo** y **qué** ocurrió en el ciclo de vida del documento.

**Trazabilidad (auditoría)**
- La tabla `audit_log` registra eventos críticos con actor, descripción y timestamp.  
- El registro incluye correlación con `verification_attempts` y firmantes, lo que permite **evidencia verificable**.

**No repudio y evidencia**
- Evidencia técnica combinada:
  - Estados y timestamps de firma (Documenso).  
  - Estados y datos de verificación de identidad (Didit).  
  - Auditoría interna con eventos y contexto.  
- Esta combinación permite demostrar que **el firmante completó la firma** del PDF específico.

---

## 3) Seguridad y consistencia en base de datos

**Control de acceso**
- **Row-Level Security (RLS)** habilitado en tablas críticas para aislamiento por tenant.
- Políticas por `tenant_id` restringen el acceso a datos de una organización.

**Separación por inquilino (multi-tenant)**
- Las tablas usan `tenant_id` y políticas que evitan acceso cruzado.

**Integridad**
- Claves foráneas entre documentos, firmantes y verificaciones garantizan consistencia.  
- Restricciones CHECK impiden estados inválidos, reforzando la coherencia del proceso.

**Disponibilidad y backups**
- La base de datos gestionada por Supabase mantiene backups automáticos y monitoreo (de acuerdo al plan contratado).

---

## 4) Seguridad en frontend

**Minimización de exposición**
- El frontend no contiene secretos de servicios externos.
- El acceso a funciones sensibles se realiza vía Edge Functions con validación en servidor.

**Validaciones de entrada**
- Validaciones de formato (ej. email de firmantes) antes de enviar datos.

---

## 5) Seguridad en backend (Edge Functions)

**Principio de menor privilegio**
- Las funciones usan **service role** solo en entornos controlados (servidor), nunca expuesto al cliente.

**Validación de webhooks**
- Webhooks de Didit se validan con **HMAC** (`x-signature-v2`) usando un secreto por tenant.
- Esto evita que actores externos inyecten eventos fraudulentos.

**Control de estados**
- El backend actualiza estados internos sólo si el `session_id` existe y corresponde a un intento registrado.  
- Esto evita alteraciones no autorizadas sobre el estado de verificación.

---

## 6) Verificación de identidad (Didit) y su impacto en la firma

**Flujo normal**
- Se crea un intento (`verification_attempts`) con `session_id` de Didit.
- Webhook `status.updated` actualiza estados a `IN_REVIEW`, `SUCCESS`, `FAILED`, etc.

**Revisión manual**
- Cuando Didit devuelve **aprobación manual**, el sistema marca `REVIEW_APPROVED` y habilita el **token de continuidad**.  
- El TTL de firma **solo inicia al redimir el token**, garantizando que la firma ocurra *después* de la aprobación humana.

---

## 7) Firma electrónica (Documenso)

- Documenso gestiona el proceso de firma y emite URLs seguras.  
- El sistema almacena tokens necesarios para firma embebida y mantiene vínculo con el documento interno.  
- Los estados de Documenso actualizan los estados internos, asegurando consistencia entre “documento firmado” y evidencia externa.

---

## 8) Correos y notificaciones

- Correos se envían a través de Resend o Supabase Auth (según el flujo). 
- El contenido se unifica con branding corporativo. 
- El correo de aprobación manual incluye el enlace de continuidad con expiración.

---

## 9) Gestión de secretos y configuración

- Secrets (API keys, webhook secrets) se guardan en `tenant_integrations.config`.
- Las funciones leen secretos desde variables de entorno o configuración por tenant.
- No se exponen secretos al frontend.

---

## 10) Riesgos y mitigaciones (integridad documental)

**Riesgo: webhooks falsificados**  
- Mitigado con HMAC y secrets por tenant.

**Riesgo: acceso entre tenants**  
- Mitigado con RLS y políticas en BD.

**Riesgo: alteración del PDF firmado**  
- Mitigado por el sellado de Documenso y el uso del PDF descargado desde el proveedor como fuente de verdad.

**Riesgo: pérdida de evidencia**  
- Mitigado con auditoría centralizada y backups.

---

## 11) Buenas prácticas recomendadas (operación)

- Rotación periódica de API keys y webhook secrets.
- Monitoreo de webhooks fallidos y alertas.
- Políticas de retención de logs de auditoría.
- Revisión periódica de roles/usuarios.

---

## 12) Declaración de idoneidad (integridad y validez)

La plataforma implementa controles técnicos orientados a:
- garantizar la **integridad del PDF firmado**,
- asegurar que el firmante autenticado es quien aprobó la firma,
- mantener trazabilidad completa del proceso,
- y soportar evidencia verificable ante auditorías o requerimientos regulatorios.

La combinación de registros internos (`audit_log`), estados de firma de Documenso y verificaciones de identidad de Didit, junto con RLS y controles de acceso, constituye una base sólida de **integridad y validez documental**.

---

## 13) Anexos sugeridos (evidencia)

Para respaldar ante autoridad competente, se recomienda adjuntar:
- Extractos de `audit_log` del documento en cuestión.  
- Registro de verificación (Didit) y su `session_id`.  
- Certificado de firma emitido por Documenso y/o PDF firmado descargado del proveedor.  
- Evidencia de configuración de RLS y policies en BD.  
- Configuración de webhooks firmados.  
