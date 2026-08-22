/**
 * Typed accessor shape for `ConfigService.get<AppConfig>(...)`-style lookups
 * where convenient; most call sites just use `configService.get<string>('KEY')`
 * directly against process.env-backed keys, which ConfigModule.forRoot already
 * exposes without a custom loader. This file documents the config surface.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigin: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  redisHost: string;
  redisPort: number;
  redisPassword?: string;
}

export default (): Partial<AppConfig> => ({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
  corsOrigin: process.env.CORS_ORIGIN,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT
    ? parseInt(process.env.REDIS_PORT, 10)
    : undefined,
  redisPassword: process.env.REDIS_PASSWORD,
});
