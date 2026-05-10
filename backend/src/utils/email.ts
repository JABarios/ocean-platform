type VerificationEmailInput = {
  to: string
  displayName: string
  verifyUrl: string
}

function getAppOrigin() {
  return process.env.APP_ORIGIN || 'http://localhost:5173'
}

export function buildVerificationUrl(token: string) {
  return `${getAppOrigin()}/verify-email/${token}`
}

export async function sendVerificationEmail(input: VerificationEmailInput) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'OCEAN <noreply@ocean.local>'

  if (!apiKey) {
    return { delivered: false, mode: 'fallback' as const }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: 'Confirma tu correo en OCEAN',
      html: `
        <div style="font-family: Arial, sans-serif; color: #17212f; line-height: 1.5;">
          <h2 style="margin-bottom: 0.5rem;">Confirma tu cuenta en OCEAN</h2>
          <p>Hola ${input.displayName},</p>
          <p>Antes de usar OCEAN, necesitamos confirmar tu correo electrónico.</p>
          <p>
            <a href="${input.verifyUrl}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 16px; border-radius: 8px; text-decoration: none;">
              Confirmar correo
            </a>
          </p>
          <p style="font-size: 0.95rem; color: #52606d;">
            Si el botón no te funciona, copia este enlace en el navegador:
          </p>
          <p style="font-size: 0.95rem; word-break: break-all;">${input.verifyUrl}</p>
        </div>
      `,
      text: `Hola ${input.displayName}, confirma tu cuenta en OCEAN usando este enlace: ${input.verifyUrl}`,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`No se pudo enviar el correo de verificación: ${text || response.status}`)
  }

  return { delivered: true, mode: 'email' as const }
}
