#!/usr/bin/env node
/**
 * Generates a CSV file of plausible employee data for exercising the CSV
 * bulk-import feature (EMS-BACKEND-PLAN.md §8) at scale (20,000+ rows).
 *
 * Deliberately dependency-free and streaming: uses fs.createWriteStream and
 * writes row-by-row rather than building one giant string in memory, so this
 * script itself models the same "never buffer the whole thing" constraint
 * the CSV-import worker has to honor.
 *
 * Usage:
 *   node scripts/generate-large-csv.mjs [rowCount] [outputPath]
 *
 * Examples:
 *   node scripts/generate-large-csv.mjs                # 25000 rows -> scripts/generated-employees.csv
 *   node scripts/generate-large-csv.mjs 50000
 *   node scripts/generate-large-csv.mjs 100000 /tmp/big.csv
 */

import { createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const rowCount = Number.parseInt(process.argv[2] ?? '25000', 10);
const outputPath = resolve(
  process.argv[3] ?? resolve(__dirname, 'generated-employees.csv'),
);

if (!Number.isInteger(rowCount) || rowCount <= 0) {
  console.error(`Invalid row count: ${process.argv[2]}`);
  process.exit(1);
}

const FIRST_NAMES = [
  'Andi', 'Budi', 'Citra', 'Dewi', 'Eka', 'Fitri', 'Gita', 'Hadi', 'Indra',
  'Joko', 'Kiki', 'Lestari', 'Mega', 'Nur', 'Oki', 'Putri', 'Qori', 'Rina',
  'Siti', 'Tono', 'Umar', 'Vina', 'Wati', 'Yanto', 'Zaki',
];

const LAST_NAMES = [
  'Saputra', 'Wijaya', 'Kusuma', 'Pratama', 'Santoso', 'Hidayat', 'Nugroho',
  'Setiawan', 'Wibowo', 'Halim', 'Gunawan', 'Suryani', 'Rahayu', 'Firmansyah',
];

const POSITIONS = [
  'Software Engineer', 'Product Manager', 'HR Staff', 'Accountant',
  'Sales Executive', 'Marketing Specialist', 'Data Analyst', 'QA Engineer',
  'Office Administrator', 'Customer Support', 'Operations Manager',
  'UI/UX Designer',
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function csvEscape(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function randomRow() {
  const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const age = randomInt(18, 60);
  const position = pick(POSITIONS);
  const salary = randomInt(4_000_000, 45_000_000); // plausible monthly IDR salary
  return [name, age, position, salary].map(csvEscape).join(',');
}

async function main() {
  const stream = createWriteStream(outputPath, { encoding: 'utf8' });

  const writeAsync = (chunk) =>
    new Promise((resolvePromise, reject) => {
      if (!stream.write(chunk)) {
        stream.once('drain', resolvePromise);
      } else {
        resolvePromise();
      }
      stream.once('error', reject);
    });

  await writeAsync('name,age,position,salary\n');

  const FLUSH_EVERY = 1000;
  let buffer = '';

  for (let i = 0; i < rowCount; i += 1) {
    buffer += randomRow() + '\n';
    if ((i + 1) % FLUSH_EVERY === 0) {
      await writeAsync(buffer);
      buffer = '';
    }
  }
  if (buffer.length > 0) {
    await writeAsync(buffer);
  }

  await new Promise((resolvePromise, reject) => {
    stream.end((err) => (err ? reject(err) : resolvePromise()));
  });

  console.log(`Wrote ${rowCount} rows to ${outputPath}`);
}

main().catch((err) => {
  console.error('Failed to generate CSV:', err);
  process.exit(1);
});
