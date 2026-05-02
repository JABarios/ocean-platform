import { useCallback } from 'react'
import forge from 'node-forge'

export interface EncryptionResult {
  encryptedWithIv: Blob
  keyBase64: string
  ivBase64: string
  originalSize: number
}

export function isCryptoAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.crypto?.subtle
}

// ─── Helpers comunes ───
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// ─── Cifrado con Web Crypto API (preferido, más rápido) ───
async function encryptWithSubtle(fileBuffer: ArrayBuffer): Promise<EncryptionResult> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    fileBuffer
  )

  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.byteLength)

  const rawKey = await crypto.subtle.exportKey('raw', key)
  const keyBase64 = arrayBufferToBase64(rawKey)

  return {
    encryptedWithIv: new Blob([combined]),
    keyBase64,
    ivBase64: arrayBufferToBase64(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
    originalSize: fileBuffer.byteLength,
  }
}

async function decryptWithSubtle(encryptedWithIv: ArrayBuffer, keyBase64: string): Promise<ArrayBuffer> {
  const full = new Uint8Array(encryptedWithIv)
  const iv = full.slice(0, 12)
  const ciphertext = full.slice(12)

  const rawKey = base64ToArrayBuffer(keyBase64)

  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
}

// ─── Fallback con forge (funciona en cualquier contexto HTTP) ───
function encryptWithForge(fileBuffer: ArrayBuffer): Promise<EncryptionResult> {
  return new Promise((resolve, reject) => {
    try {
      const keyBytes = forge.random.getBytesSync(32)
      const keyBase64 = forge.util.encode64(keyBytes)

      const iv = forge.random.getBytesSync(12)

      const cipher = forge.cipher.createCipher('AES-GCM', keyBytes)
      cipher.start({ iv: forge.util.createBuffer(iv) })
      cipher.update(forge.util.createBuffer(new Uint8Array(fileBuffer)))
      cipher.finish()

      const encrypted = cipher.output.getBytes()
      const tag = cipher.mode.tag.getBytes()

      // IV (12) + ciphertext + tag (16)
      const combined = new Uint8Array(12 + encrypted.length + 16)
      combined.set(forge.util.binary.raw.decode(iv), 0)
      combined.set(forge.util.binary.raw.decode(encrypted), 12)
      combined.set(forge.util.binary.raw.decode(tag), 12 + encrypted.length)

      resolve({
        encryptedWithIv: new Blob([combined]),
        keyBase64,
        ivBase64: forge.util.encode64(iv),
        originalSize: fileBuffer.byteLength,
      })
    } catch (err) {
      reject(err)
    }
  })
}

function decryptWithForge(encryptedBuffer: ArrayBuffer, keyBase64: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const full = new Uint8Array(encryptedBuffer)
      const iv = forge.util.createBuffer(full.slice(0, 12))
      const tag = forge.util.createBuffer(full.slice(-16))
      const ciphertext = forge.util.createBuffer(full.slice(12, -16))

      const keyBytes = forge.util.decode64(keyBase64)

      const decipher = forge.cipher.createDecipher('AES-GCM', keyBytes)
      decipher.start({ iv, tag })
      decipher.update(ciphertext)
      const success = decipher.finish()

      if (!success) {
        reject(new Error('Fallo de autenticación: clave incorrecta o archivo alterado'))
        return
      }

      const decrypted = decipher.output.getBytes()
      resolve(new Uint8Array(forge.util.binary.raw.decode(decrypted)).buffer)
    } catch (err) {
      reject(err)
    }
  })
}

// ─── Hook público ───
export function useCrypto() {
  const encryptFile = useCallback(async (file: Blob): Promise<EncryptionResult> => {
    const fileBuffer = await file.arrayBuffer()

    if (isCryptoAvailable()) {
      return encryptWithSubtle(fileBuffer)
    } else {
      return encryptWithForge(fileBuffer)
    }
  }, [])

  const decryptFile = useCallback(async (
    encryptedWithIv: ArrayBuffer,
    keyBase64: string
  ): Promise<ArrayBuffer> => {
    if (isCryptoAvailable()) {
      return decryptWithSubtle(encryptedWithIv, keyBase64)
    } else {
      return decryptWithForge(encryptedWithIv, keyBase64)
    }
  }, [])

  return { encryptFile, decryptFile }
}
