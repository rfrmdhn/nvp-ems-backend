/**
 * Idempotent seed — safe to run every time the `migrate` compose service
 * runs (see EMS-BACKEND-PLAN.md §10). Upserts exactly one Admin keyed on the
 * unique `email` column, so re-running never creates a duplicate row; it
 * simply refreshes the password hash from the current env vars. Also seeds a
 * handful of sample Employee rows (once — see `seedSampleEmployees` below)
 * so a fresh setup isn't a blank, hard-to-demo table.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;

const SAMPLE_EMPLOYEES = [
  { name: 'John Doe', age: 30, position: 'Software Engineer', salary: 12000000 },
  { name: 'Maria Tan', age: 28, position: 'QA Engineer', salary: 9000000 },
  { name: 'Budi Santoso', age: 35, position: 'Product Manager', salary: 22000000 },
  { name: 'Siti Aminah', age: 26, position: 'HR Staff', salary: 8000000 },
  { name: 'Andi Wijaya', age: 41, position: 'Operations Manager', salary: 25000000 },
  { name: 'Dewi Lestari', age: 24, position: 'Marketing Specialist', salary: 7500000 },
  { name: 'Eka Kusuma', age: 33, position: 'Data Analyst', salary: 14000000 },
  { name: 'Fitri Rahayu', age: 29, position: 'Sales Executive', salary: 10500000 },
  { name: 'Gita Pratama', age: 38, position: 'Accountant', salary: 13500000 },
  { name: 'Hadi Nugroho', age: 27, position: 'Software Engineer', salary: 11800000 },
];

/**
 * Employee has no natural unique key to upsert on (unlike Admin's email), so
 * idempotency here is "only seed if the table is still empty" rather than a
 * per-row upsert — re-running `migrate` after employees already exist (real
 * ones, or from a previous seed) must never re-insert/duplicate this sample
 * set.
 */
async function seedSampleEmployees() {
  const existing = await prisma.employee.count();
  if (existing > 0) {
    console.log(`Employees table already has ${existing} row(s) — skipping sample seed.`);
    return;
  }

  await prisma.employee.createMany({ data: SAMPLE_EMPLOYEES });
  console.log(`Seeded ${SAMPLE_EMPLOYEES.length} sample employees.`);
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@nusantaradigital.test';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  console.log(`Seeded admin "${admin.email}" (id: ${admin.id})`);

  await seedSampleEmployees();
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
