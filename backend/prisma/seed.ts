import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('ocean123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@ocean.local' },
    update: {},
    create: {
      email: 'admin@ocean.local',
      displayName: 'Admin OCEAN',
      role: 'Admin',
      status: 'Active',
      passwordHash,
    },
  })

  const curator = await prisma.user.upsert({
    where: { email: 'curator@ocean.local' },
    update: {},
    create: {
      email: 'curator@ocean.local',
      displayName: 'Dr. Curador',
      role: 'Curator',
      status: 'Active',
      institution: 'Hospital Central',
      specialty: 'Neurofisiología',
      passwordHash,
    },
  })

  const clinician = await prisma.user.upsert({
    where: { email: 'clinician@ocean.local' },
    update: {},
    create: {
      email: 'clinician@ocean.local',
      displayName: 'Dr. Clínico',
      role: 'Clinician',
      status: 'Active',
      institution: 'Hospital Norte',
      specialty: 'Neurología',
      passwordHash,
    },
  })

  const reviewer = await prisma.user.upsert({
    where: { email: 'reviewer@ocean.local' },
    update: {},
    create: {
      email: 'reviewer@ocean.local',
      displayName: 'Dra. Revisora',
      role: 'Reviewer',
      status: 'Active',
      institution: 'Hospital Sur',
      specialty: 'Neurofisiología',
      passwordHash,
    },
  })

  console.log({ admin, curator, clinician, reviewer })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
