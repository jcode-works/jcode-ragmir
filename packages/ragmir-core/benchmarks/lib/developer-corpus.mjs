import { zipSync, strToU8 } from "fflate"

export const documents = {
  'auth-redirect.md': '# Browser authentication\n\nAUTH_REDIRECT_ORIGIN_X17 is the exact allowlist of redirect origins. A callback URL must match its scheme, host and port. Reject wildcard hosts. Never accept a request-provided return URL without validating this allowlist.\n',
  'token-renewal.md': '# Session renewal\n\nWhen an access credential expires, the client exchanges its renewable credential at /session/renew. Store the renewable credential in an HttpOnly cookie. A rejected renewal terminates the session and redirects to sign-in.\n',
  'offline-buffer.md': '# Network loss\n\nWhen connectivity disappears, pending mutations remain in a durable outbox. Replay the outbox when connectivity returns. Preserve the original idempotency key during replay.\n',
  'payments.md': '# Payment retries\n\nA duplicate charge is prevented by an idempotency key. Persist it before submitting the payment and reuse it for all retries. Requests with the same key return the original result. This document does not define refunds.\n',
  'permissions.md': '# Invoice permissions\n\nOnly a billing administrator may approve an invoice. An auditor has read-only access. An invoice author must not approve their own invoice even if they also hold the billing administrator role.\n',
  'current-storage.md': '# Storage decision\n\nStatus: accepted. Date: 2026-09-01. Supersedes ADR-001.\n\nInvoice attachments are stored in object storage. The relational database stores an object key and checksum. Do not store attachment bytes in database rows.\n',
  'archive-storage.md': '# ADR-001 attachment storage\n\nStatus: superseded by the storage decision dated 2026-09-01.\n\nStore invoice attachments as binary data in database rows. The initial release uses the relational database for invoice attachments.\n',
  'retention.md': '# Retention\n\nInvoice attachments must be retained for 90 days after cancellation. Delete them only when the retention period has elapsed and no legal hold exists.\n',
  'worker.md': '# Deletion worker\n\nThe cleanup worker runs at 02:00 UTC. It receives eligible attachment keys from the retention service and deletes their object-storage payloads. Do not compute eligibility in the worker.\n',
  'pagination.md': '# Pagination\n\nThe list endpoint uses opaque cursors. A client must preserve the sort order when requesting the next page. A deleted row does not invalidate the cursor.\n',
  'api-signature.md': '# Identifier catalogue\n\nUse invoices.validateDraft before submitting a draft invoice. validateDraft returns validation errors. ERR_INVOICE_409 means the invoice version has changed; reload the record before retrying.\n',
  'french-exports.md': '# Exports volumineux\n\nLa génération des exports se fait dans une tâche asynchrone. Au-delà de mille lignes, créer un job et retourner son identifiant. Le navigateur interroge son statut, puis télécharge le fichier terminé.\n',
  'deployment.md': '# Deployment\n\nApply the schema migration before enabling the invoice feature flag. The old application remains compatible with the expanded schema during rollout. Roll back the flag before rolling back the application.\n',
  'webhooks.md': '# Webhook delivery\n\nVerify the signature over the raw request body before parsing JSON. A timestamp older than five minutes is rejected. Retry transient delivery failures with exponential backoff.\n',
  'logging.md': '# Logging\n\nRecord request IDs and operation names. The cancellation reason is recorded by the domain event. Do not infer a successful operation from an HTTP request log alone.\n',
  'cache.md': '# Cache\n\nInvalidate the invoice cache after a successful transaction commit. Cache entries include the tenant ID. A failed transaction must leave the existing cache entry intact.\n',
}
const longQuery = 'AUTH_REDIRECT_ORIGIN_X17. ' +
  'Je prépare une modification de cette application et je souhaite comprendre les contraintes documentées avant de changer le comportement existant. ' +
  'Il faut garder la compatibilité des consommateurs actuels et vérifier précisément les règles applicables au scénario décrit en début de demande. ' +
  'Quelle règle dois-je appliquer ?'
export const cases = [
  { id: 'exact-anchor', query: 'AUTH_REDIRECT_ORIGIN_X17', expected: ['auth-redirect.md'] },
  { id: 'long-query-anchor', query: longQuery, expected: ['auth-redirect.md'] },
  { id: 'english-paraphrase', query: 'How should the browser recover from an expired login token?', expected: ['token-renewal.md'] },
  { id: 'french-to-english', query: 'Comment reprendre les modifications après une coupure réseau ?', expected: ['offline-buffer.md'] },
  { id: 'english-to-french', query: 'How should a large report download be generated without blocking the browser?', expected: ['french-exports.md'] },
  { id: 'retry-synonyms', query: 'How do we avoid charging a customer twice after a timeout?', expected: ['payments.md'] },
  { id: 'permission-exception', query: 'Can a billing administrator approve an invoice they created?', expected: ['permissions.md'] },
  { id: 'current-versus-old', query: 'Where should invoice attachment bytes be stored under the current accepted decision?', expected: ['current-storage.md'] },
  { id: 'multi-document', query: 'When are cancelled invoice attachments eligible for deletion and which component removes them?', expected: ['retention.md', 'worker.md'] },
  { id: 'exact-error', query: 'ERR_INVOICE_409', expected: ['api-signature.md'] },
  { id: 'dot-identifier', query: 'invoices.validateDraft', expected: ['api-signature.md'] },
  { id: 'cursor-behavior', query: 'Can deleting a row break the next pagination cursor?', expected: ['pagination.md'] },
  { id: 'deployment-order', query: 'What must happen before the invoice feature flag is enabled?', expected: ['deployment.md'] },
  { id: 'webhook-order', query: 'Must webhook JSON be parsed before signature verification?', expected: ['webhooks.md'] },
  { id: 'cache-failure', query: 'Should a failed invoice transaction invalidate cache entries?', expected: ['cache.md'] },
  { id: 'no-answer-near-domain', query: 'What is the documented automatic refund policy for card payments?', expected: [] },
  { id: 'no-answer-generic', query: 'What is the maximum number of invoice approvers in an organization?', expected: [] },
  { id: 'no-answer-unrelated', query: 'How do penguins navigate Antarctic ocean currents?', expected: [] },
  { id: 'filename', query: 'current-storage.md', expected: ['current-storage.md'] },
  { id: 'table-header-and-row', query: 'What is the refund approval limit for an auditor?', expected: ['limits.xlsx'], required: ['Auditor', '0', 'Refund approval limit EUR'] },
]

export function spreadsheet() {
  const values = [['Role', 'Refund approval limit EUR', 'Export limit rows'], ['Viewer', '0', '100'], ['Operator', '500', '1000'], ['Manager', '5000', '10000'], ['Auditor', '0', '50000']]
  const escape = (x) => x.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const rows = values.map((row, i) => `<row r="${i+1}">${row.map((v,j) => `<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Limits" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  }
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k,v]) => [k,strToU8(v)])), {mtime: new Date('1980-01-01T00:00:00Z')})
}
