-- CreateTable
CREATE TABLE "users" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wallet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "founderName" TEXT NOT NULL DEFAULT '',
    "founderRole" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "ticker" TEXT NOT NULL DEFAULT '',
    "tagline" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "github" TEXT NOT NULL DEFAULT '',
    "social" TEXT NOT NULL DEFAULT '',
    "raiseTarget" INTEGER NOT NULL DEFAULT 0,
    "monthlyBudget" INTEGER NOT NULL DEFAULT 0,
    "feeCap" INTEGER NOT NULL DEFAULT 0,
    "verifyCode" TEXT NOT NULL,
    "feeSignature" TEXT,
    "submittedAt" DATETIME,
    "scheduledFor" DATETIME,
    "decidedAt" DATETIME,
    "rejectionReason" TEXT,
    "startupTicker" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "checks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "applicationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "checkedAt" DATETIME,
    CONSTRAINT "checks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "startups" (
    "ticker" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "github" TEXT NOT NULL DEFAULT '',
    "social" TEXT NOT NULL DEFAULT '',
    "founders" TEXT NOT NULL DEFAULT '[]',
    "founderWallet" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL DEFAULT '',
    "listedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failingRuns" INTEGER NOT NULL DEFAULT 0,
    "runsSinceAi" INTEGER NOT NULL DEFAULT 0,
    "override" TEXT,
    "overrideReason" TEXT
);

-- CreateTable
CREATE TABLE "updates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "heartbeat_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "results" TEXT NOT NULL,
    "failing" BOOLEAN NOT NULL,
    "verdict" TEXT NOT NULL,
    "signature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ai_reviews" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "flags" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "ruleVerdict" TEXT NOT NULL,
    "aiVerdict" TEXT NOT NULL,
    "aiReviewId" INTEGER NOT NULL,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "trades" (
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "usdc" BIGINT NOT NULL,
    "tokens" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "price" REAL NOT NULL,
    "ts" DATETIME NOT NULL,

    PRIMARY KEY ("signature", "eventIndex")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "volume" BIGINT NOT NULL DEFAULT 0,
    "trading" BIGINT NOT NULL DEFAULT 0,
    "verification" BIGINT NOT NULL DEFAULT 0,
    "graduation" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "indexed_signatures" (
    "signature" TEXT NOT NULL PRIMARY KEY,
    "ts" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "signature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_feeSignature_key" ON "applications"("feeSignature");

-- CreateIndex
CREATE INDEX "applications_wallet_idx" ON "applications"("wallet");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "checks_applicationId_key_key" ON "checks"("applicationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "startups_applicationId_key" ON "startups"("applicationId");

-- CreateIndex
CREATE INDEX "updates_ticker_idx" ON "updates"("ticker");

-- CreateIndex
CREATE INDEX "heartbeat_runs_ticker_createdAt_idx" ON "heartbeat_runs"("ticker", "createdAt");

-- CreateIndex
CREATE INDEX "ai_reviews_ticker_createdAt_idx" ON "ai_reviews"("ticker", "createdAt");

-- CreateIndex
CREATE INDEX "flags_resolvedAt_idx" ON "flags"("resolvedAt");

-- CreateIndex
CREATE INDEX "trades_ticker_ts_idx" ON "trades"("ticker", "ts");

-- CreateIndex
CREATE INDEX "trades_wallet_idx" ON "trades"("wallet");
