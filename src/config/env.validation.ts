import * as Joi from 'joi';

/**
 * Env var schema for the whole backend (API + worker + migrate/seed all read a
 * subset of these). Validated once at bootstrap via ConfigModule.forRoot({ validationSchema }).
 * See EMS-BACKEND-PLAN.md §10 and .env.example for the meaning of each var.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Postgres / Prisma
  DATABASE_URL: Joi.string()
    .uri({ scheme: [/postgres(ql)?/] })
    .required(),

  // Redis / BullMQ
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // Auth
  JWT_SECRET: Joi.string().min(8).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),

  // Seeded admin (read by prisma/seed.ts directly via process.env, but validated
  // here too so a misconfigured .env fails fast when the API/worker boot).
  // `tlds: { allow: false }` because this is an internal admin address, not a
  // public-facing one — Joi's default TLD allowlist rejects reserved/internal
  // domains like the `.test` TLD (RFC 2606) used in the default value below.
  ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .default('admin@nusantaradigital.test'),
  ADMIN_PASSWORD: Joi.string().min(6).default('ChangeMe123!'),

  // API process
  PORT: Joi.number().port().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
});
