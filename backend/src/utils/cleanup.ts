import cron from 'node-cron'
import { prisma } from './prisma'
import { deleteBlob } from './storage'

export function startCleanupJob() {
  // Cada hora: eliminar paquetes expirados
  cron.schedule('0 * * * *', async () => {
    console.log('[cleanup] Ejecutando limpieza de paquetes expirados…')

    const expired = await prisma.casePackage.findMany({
      where: {
        expiresAt: { lt: new Date() },
        retentionPolicy: { not: 'Teaching' },
      },
      include: { case: true },
    })

    for (const pkg of expired) {
      try {
        await deleteBlob(pkg.blobLocation)
        await prisma.casePackage.delete({ where: { id: pkg.id } })
        console.log(`[cleanup] Eliminado paquete ${pkg.id} (caso ${pkg.caseId})`)
      } catch (err) {
        console.error(`[cleanup] Error eliminando paquete ${pkg.id}:`, err)
      }
    }

    console.log(`[cleanup] ${expired.length} paquetes eliminados`)
  })

  // Diario: eliminar paquetes de casos archivados sin propuesta docente (7 días tras cierre)
  cron.schedule('0 3 * * *', async () => {
    console.log('[cleanup] Ejecutando limpieza de casos archivados…')

    const oldPackages = await prisma.casePackage.findMany({
      where: {
        retentionPolicy: 'UntilReviewClose',
        case: {
          statusClinical: 'Archived',
          statusTeaching: 'None',
          resolvedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      },
    })

    for (const pkg of oldPackages) {
      try {
        await deleteBlob(pkg.blobLocation)
        await prisma.casePackage.delete({ where: { id: pkg.id } })
        console.log(`[cleanup] Eliminado paquete archivado ${pkg.id}`)
      } catch (err) {
        console.error(`[cleanup] Error eliminando paquete archivado ${pkg.id}:`, err)
      }
    }

    console.log(`[cleanup] ${oldPackages.length} paquetes archivados eliminados`)
  })
}
