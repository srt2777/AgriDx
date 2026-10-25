import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const visitors = sqliteTable('preview_visitors', {
  id: text('id').primaryKey(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  browser: text('browser').notNull(),
  os: text('os').notNull(),
  device: text('device').notNull(),
  country: text('country').notNull(),
}, t => [index('preview_visitors_last_seen').on(t.lastSeen)]);

export const visits = sqliteTable('preview_visits', {
  id: text('id').primaryKey(),
  visitorId: text('visitor_id').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  occurredAt: integer('occurred_at').notNull(),
  path: text('path').notNull(),
  referrer: text('referrer').notNull(),
}, t => [index('preview_visits_time').on(t.occurredAt), index('preview_visits_visitor').on(t.visitorId)]);

export const questions = sqliteTable('preview_questions', {
  id: text('id').primaryKey(),
  visitorId: text('visitor_id').notNull().references(() => visitors.id, { onDelete: 'cascade' }),
  occurredAt: integer('occurred_at').notNull(),
  question: text('question').notNull(),
  machineType: text('machine_type').notNull(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  outcome: text('outcome').notNull(),
  knowledgeChunks: integer('knowledge_chunks').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  release: text('release').notNull(),
}, t => [index('preview_questions_time').on(t.occurredAt), index('preview_questions_visitor').on(t.visitorId)]);

export const sessions = sqliteTable('preview_admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  githubLogin: text('github_login').notNull(),
  githubId: integer('github_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('preview_admin_sessions_expiry').on(t.expiresAt)]);

export const rateLimits = sqliteTable('preview_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('preview_rate_limits_expiry').on(t.expiresAt)]);

/** API keys are AES-GCM ciphertext; the wrapping key is a deployment secret. */
export const aiProviders = sqliteTable('preview_ai_providers', {
  provider: text('provider').primaryKey(),
  model: text('model').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export const aiSettings = sqliteTable('preview_ai_settings', {
  id: integer('id').primaryKey(),
  publicEnabled: integer('public_enabled', { mode: 'boolean' }).notNull().default(false),
  defaultProvider: text('default_provider').notNull().default('deepseek'),
  dailyLimit: integer('daily_limit').notNull().default(100),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});
