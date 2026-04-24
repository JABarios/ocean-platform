import { useCallback } from 'react'

export interface EncryptionResult {
  encryptedWithIv: Blob
  keyBase64: string
  originalSize: number
}

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

export function isCryptoAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.crypto?.subtle
}

export function useCrypto() {
  const encryptFile = useCallback(async (file: File): Promise<EncryptionResult> => {
    if (!isCryptoAvailable()) {
      throw new Error(
        'El cifrado del navegador no está disponible. ' +
        'Accede a OCEAN mediante https:// o desde localhost (127.0.0.1). ' +
        'Las conexiones por IP de red local (http://192.168.x.x) no permiten cifrado.'
      )
    }

    const fileBuffer = await file.arrayBuffer()

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

    // Prepend IV (12 bytes) al ciphertext para que el revisor pueda descifrar
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(encrypted), iv.byteLength)

    const rawKey = await crypto.subtle.exportKey('raw', key)
    const keyBase64 = arrayBufferToBase64(rawKey)

    return {
      encryptedWithIv: new Blob([combined]),
      keyBase64,
      originalSize: file.size,
    }
  }, [])

  const decryptFile = useCallback(async (
    encryptedWithIv: ArrayBuffer,
    keyBase64: string
  ): Promise<ArrayBuffer> => {
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
  }, [])

  return { encryptFile, decryptFile }
}
