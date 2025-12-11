import { pgTable, serial, text, integer, timestamp, boolean, uuid, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ==================== AUTH ====================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  googleId: text('google_id').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== WORKSPACES ====================

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // owner, admin, member, viewer
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== API TOKENS ====================

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(), // SHA-256 hash of the token
  tokenPrefix: text('token_prefix').notNull(), // First 8 chars for identification (e.g., "cg_abc123")
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== REPOSITORIES ====================

// Analysis stage enum for detailed progress tracking
export type AnalysisStage =
  | 'queued'
  | 'cloning'
  | 'detecting'    // Detecting tech stack
  | 'analyzing'    // Running agents
  | 'processing'   // Post-processing reports
  | 'completed'
  | 'error';

// Agent progress tracking
export interface AgentProgress {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startedAt?: string;
  completedAt?: string;
}

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  githubUrl: text('github_url').notNull(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  defaultBranch: text('default_branch').default('main'),
  status: text('status').notNull().default('pending'), // pending, cloning, analyzing, completed, error
  analysisStage: text('analysis_stage').$type<AnalysisStage>(), // Detailed progress stage
  agentProgress: jsonb('agent_progress').$type<AgentProgress[]>(), // Which agents are running/done
  errorMessage: text('error_message'),
  localPath: text('local_path'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Trigger source for analysis runs
export type AnalysisTrigger = 'initial' | 'recheck' | 'api' | 'scheduled';

export const analysisRuns = pgTable('analysis_runs', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // security, reliability, full
  status: text('status').notNull().default('pending'), // pending, running, completed, error
  commitSha: text('commit_sha'), // Git commit SHA that was analyzed
  triggeredBy: text('triggered_by').$type<AnalysisTrigger>().default('initial'), // How the analysis was triggered
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  analysisRunId: integer('analysis_run_id')
    .references(() => analysisRuns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // security, reliability
  issueId: text('issue_id').notNull(), // e.g., SEC-001, REL-003
  severity: text('severity').notNull(), // critical, high, medium, low
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  filePath: text('file_path'),
  lineStart: integer('line_start'),
  lineEnd: integer('line_end'),
  codeSnippet: text('code_snippet'),
  remediation: text('remediation'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== REPOSITORY SHARES ====================

export const repositoryShares = pgTable('repository_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), // Random token for public URL
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at'), // Optional expiration
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== RELATIONS ====================

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  ownedWorkspaces: many(workspaces),
  workspaceMemberships: many(workspaceMembers),
  apiTokens: many(apiTokens),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// Workspace relations
export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  repositories: many(repositories),
  invites: many(workspaceInvites),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}));

export const workspaceInvitesRelations = relations(workspaceInvites, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceInvites.workspaceId],
    references: [workspaces.id],
  }),
  inviter: one(users, {
    fields: [workspaceInvites.invitedBy],
    references: [users.id],
  }),
}));

// Repository relations
export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [repositories.workspaceId],
    references: [workspaces.id],
  }),
  analysisRuns: many(analysisRuns),
  issues: many(issues),
  shares: many(repositoryShares),
}));

// Repository shares relations
export const repositorySharesRelations = relations(repositoryShares, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryShares.repositoryId],
    references: [repositories.id],
  }),
  creator: one(users, {
    fields: [repositoryShares.createdBy],
    references: [users.id],
  }),
}));

export const analysisRunsRelations = relations(analysisRuns, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [analysisRuns.repositoryId],
    references: [repositories.id],
  }),
  issues: many(issues),
}));

export const issuesRelations = relations(issues, ({ one }) => ({
  repository: one(repositories, {
    fields: [issues.repositoryId],
    references: [repositories.id],
  }),
  analysisRun: one(analysisRuns, {
    fields: [issues.analysisRunId],
    references: [analysisRuns.id],
  }),
}));

// API Token relations
export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, {
    fields: [apiTokens.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [apiTokens.workspaceId],
    references: [workspaces.id],
  }),
}));
