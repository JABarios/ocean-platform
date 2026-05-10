type VerificationEmailInput = {
  to: string
  displayName: string
  verifyUrl: string
}

type GroupInvitationEmailInput = {
  to: string
  displayName: string
  inviterName: string
  groupName: string
  groupsUrl: string
}

type ReviewRequestEmailInput = {
  to: string
  displayName: string
  requesterName: string
  caseTitle: string
  caseUrl: string
  message?: string
  groupName?: string
}

function getAppOrigin() {
  return process.env.APP_ORIGIN || 'http://localhost:5173'
}

export function buildVerificationUrl(token: string) {
  return `${getAppOrigin()}/verify-email/${token}`
}

export function buildCaseUrl(caseId: string) {
  return `${getAppOrigin()}/cases/${caseId}`
}

export function buildGroupsUrl() {
  return `${getAppOrigin()}/groups`
}

async function sendTransactionalEmail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
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
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || String(response.status))
  }

  return { delivered: true, mode: 'email' as const }
}

export async function sendVerificationEmail(input: VerificationEmailInput) {
  return sendTransactionalEmail({
    to: input.to,
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
  })
}

export async function sendGroupInvitationEmail(input: GroupInvitationEmailInput) {
  return sendTransactionalEmail({
    to: input.to,
    subject: `Invitación al grupo ${input.groupName} en OCEAN`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #17212f; line-height: 1.5;">
        <h2 style="margin-bottom: 0.5rem;">Nueva invitación de grupo</h2>
        <p>Hola ${input.displayName},</p>
        <p>${input.inviterName} te ha invitado al grupo <strong>${input.groupName}</strong> en OCEAN.</p>
        <p>Puedes aceptar o rechazar la invitación desde tu panel de grupos.</p>
        <p>
          <a href="${input.groupsUrl}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 16px; border-radius: 8px; text-decoration: none;">
            Abrir grupos en OCEAN
          </a>
        </p>
        <p style="font-size: 0.95rem; color: #52606d;">Si el botón no te funciona, copia este enlace: ${input.groupsUrl}</p>
      </div>
    `,
    text: `Hola ${input.displayName}, ${input.inviterName} te ha invitado al grupo ${input.groupName} en OCEAN. Gestiona la invitación aquí: ${input.groupsUrl}`,
  })
}

export async function sendReviewRequestEmail(input: ReviewRequestEmailInput) {
  const intro = input.groupName
    ? `${input.requesterName} ha enviado un caso al grupo ${input.groupName} en OCEAN.`
    : `${input.requesterName} te ha enviado un caso para revisar en OCEAN.`

  return sendTransactionalEmail({
    to: input.to,
    subject: input.groupName
      ? `Nuevo caso para revisar en ${input.groupName}`
      : 'Nuevo caso para revisar en OCEAN',
    html: `
      <div style="font-family: Arial, sans-serif; color: #17212f; line-height: 1.5;">
        <h2 style="margin-bottom: 0.5rem;">Nueva solicitud de revisión</h2>
        <p>Hola ${input.displayName},</p>
        <p>${intro}</p>
        <p><strong>Caso:</strong> ${input.caseTitle}</p>
        ${input.message ? `<p><strong>Mensaje:</strong> ${input.message}</p>` : ''}
        <p>
          <a href="${input.caseUrl}" style="display: inline-block; background: #0f766e; color: white; padding: 10px 16px; border-radius: 8px; text-decoration: none;">
            Abrir caso en OCEAN
          </a>
        </p>
        <p style="font-size: 0.95rem; color: #52606d;">Si el botón no te funciona, copia este enlace: ${input.caseUrl}</p>
      </div>
    `,
    text: `Hola ${input.displayName}. ${intro} Caso: ${input.caseTitle}.${input.message ? ` Mensaje: ${input.message}.` : ''} Ábrelo aquí: ${input.caseUrl}`,
  })
}
