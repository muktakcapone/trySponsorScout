import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(),
  email: text('email').notNull().unique(), name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(), salt: text('salt').notNull(),
  recoveryHash: text('recovery_hash').notNull(), profile: text('profile').notNull().default('{}'),
  decisions: text('decisions').notNull().default('{}'), createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('account_sessions', {
  tokenHash: text('token_hash').primaryKey(), accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }), expiresAt: integer('expires_at').notNull(),
});
export const limits = sqliteTable('account_limits', { key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull() });
