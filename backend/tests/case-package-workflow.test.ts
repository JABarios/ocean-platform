import {
  canDownloadCasePackage,
  canRecoverCasePackageSecret,
  canStoreCasePackageSecret,
  canUploadCasePackage,
} from '../src/domain/workflows/casePackageWorkflow'

describe('casePackageWorkflow', () => {
  it('owner puede subir paquete y custodiar clave', () => {
    const input = {
      ownerId: 'owner-1',
      statusTeaching: 'None',
      reviewRequests: [],
      hasPackage: true,
      viewerId: 'owner-1',
      viewerRole: 'Clinician',
    }

    expect(canUploadCasePackage(input)).toBe(true)
    expect(canStoreCasePackageSecret(input)).toBe(true)
  })

  it('revisor aceptado puede descargar y recuperar clave custodiada', () => {
    const input = {
      ownerId: 'owner-1',
      statusTeaching: 'None',
      reviewRequests: [{ requestedBy: 'owner-1', targetUserId: 'reviewer-1', status: 'Accepted' }],
      hasPackage: true,
      hasStoredSecret: true,
      viewerId: 'reviewer-1',
      viewerRole: 'Reviewer',
    }

    expect(canDownloadCasePackage(input)).toBe(true)
    expect(canRecoverCasePackageSecret(input)).toBe(true)
  })

  it('usuario autenticado puede descargar un paquete de caso propuesto aunque no recupere la clave', () => {
    const input = {
      ownerId: 'owner-1',
      statusTeaching: 'Proposed',
      reviewRequests: [],
      hasPackage: true,
      hasStoredSecret: true,
      viewerId: 'outsider-1',
      viewerRole: 'Clinician',
    }

    expect(canDownloadCasePackage(input)).toBe(true)
    expect(canRecoverCasePackageSecret(input)).toBe(false)
  })
})
