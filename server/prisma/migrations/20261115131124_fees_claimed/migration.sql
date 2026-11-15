-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_startups" (
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
    "overrideReason" TEXT,
    "feesClaimed" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "new_startups" ("about", "address", "applicationId", "category", "country", "failingRuns", "founderWallet", "founders", "github", "listedAt", "mint", "name", "override", "overrideReason", "runsSinceAi", "social", "tagline", "ticker", "verifyCode", "website") SELECT "about", "address", "applicationId", "category", "country", "failingRuns", "founderWallet", "founders", "github", "listedAt", "mint", "name", "override", "overrideReason", "runsSinceAi", "social", "tagline", "ticker", "verifyCode", "website" FROM "startups";
DROP TABLE "startups";
ALTER TABLE "new_startups" RENAME TO "startups";
CREATE UNIQUE INDEX "startups_applicationId_key" ON "startups"("applicationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
