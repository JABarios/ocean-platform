import crypto from 'crypto'

const KEY_CUSTODY_SECRET = process.env.KEY_CUSTODY_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me'

function getKeyMaterial() {
  return crypto.createHash('sha256').update(KEY_CUSTODY_SECRET).digest()
}

export function wrapCaseKey(keyBase64: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKeyMaterial(), iv)
  const ciphertext = Buffer.concat([cipher.update(keyBase64, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`
}

export function unwrapCaseKey(wrappedKey: string): string {
  const [ivB64, tagB64, cipherB64] = wrappedKey.split('.')
  if (!ivB64 || !tagB64 || !cipherB64) throw new Error('Formato de clave custodiada inválido')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKeyMaterial(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
