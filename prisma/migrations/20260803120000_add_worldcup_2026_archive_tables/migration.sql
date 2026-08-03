-- CreateTable
CREATE TABLE "WorldCup2026ImportBatch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "sourceCommitSha" TEXT,
    "status" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "filesImported" JSONB,
    "recordsPlanned" JSONB,
    "recordsCreated" JSONB,
    "recordsUpdated" JSONB,
    "recordsSkipped" JSONB,
    "warnings" JSONB,
    "errors" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Team" (
    "id" TEXT NOT NULL,
    "sourceTeamId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fifaCode" TEXT,
    "flagCode" TEXT,
    "groupLetter" TEXT,
    "confederation" TEXT,
    "fifaRanking" INTEGER,
    "eloRating" INTEGER,
    "managerName" TEXT,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Venue" (
    "id" TEXT NOT NULL,
    "sourceVenueId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stadiumName" TEXT,
    "city" TEXT,
    "country" TEXT,
    "capacity" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "elevationMeters" INTEGER,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Stage" (
    "id" TEXT NOT NULL,
    "sourceStageId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isKnockout" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Referee" (
    "id" TEXT NOT NULL,
    "sourceRefereeId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT,
    "avgCardsPerGame" DOUBLE PRECISION,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Referee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Match" (
    "id" TEXT NOT NULL,
    "sourceMatchId" INTEGER NOT NULL,
    "matchNumber" INTEGER,
    "date" TIMESTAMP(3),
    "kickoffTimeUtc" TEXT,
    "stageId" TEXT,
    "stageName" TEXT,
    "groupLetter" TEXT,
    "venueId" TEXT,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "homeTeamName" TEXT,
    "awayTeamName" TEXT,
    "homeTeamCode" TEXT,
    "awayTeamCode" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "homePenaltyScore" INTEGER,
    "awayPenaltyScore" INTEGER,
    "resultType" TEXT,
    "status" TEXT NOT NULL,
    "winnerTeamName" TEXT,
    "winnerTeamCode" TEXT,
    "homeXg" DOUBLE PRECISION,
    "awayXg" DOUBLE PRECISION,
    "goalkeeperHome" TEXT,
    "goalkeeperAway" TEXT,
    "playerOfTheMatch" TEXT,
    "refereeId" TEXT,
    "refereeName" TEXT,
    "sourceId" TEXT NOT NULL,
    "dataSource" TEXT,
    "lastVerified" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Player" (
    "id" TEXT NOT NULL,
    "sourcePlayerId" INTEGER NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT,
    "teamCode" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" TEXT,
    "club" TEXT,
    "marketValueEur" INTEGER,
    "caps" INTEGER,
    "dateOfBirth" TIMESTAMP(3),
    "heightCm" INTEGER,
    "internationalGoals" INTEGER,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026MatchEvent" (
    "id" TEXT NOT NULL,
    "sourceEventId" INTEGER,
    "importKey" TEXT,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT,
    "teamId" TEXT,
    "teamCode" TEXT,
    "teamName" TEXT,
    "minute" INTEGER,
    "stoppageMinute" INTEGER,
    "eventType" TEXT NOT NULL,
    "playerName" TEXT,
    "assistPlayerName" TEXT,
    "cardType" TEXT,
    "varOutcome" TEXT,
    "description" TEXT,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026Lineup" (
    "id" TEXT NOT NULL,
    "sourceLineupId" INTEGER,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT,
    "teamId" TEXT,
    "teamCode" TEXT,
    "teamName" TEXT,
    "playerName" TEXT,
    "isStarting" BOOLEAN,
    "position" TEXT,
    "tacticalPosition" TEXT,
    "minutesPlayed" INTEGER,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026Lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026PlayerStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT,
    "playerName" TEXT,
    "teamCode" TEXT,
    "matchesPlayed" INTEGER,
    "matchesStarted" INTEGER,
    "minutesPlayed" INTEGER,
    "goals" INTEGER,
    "assists" INTEGER,
    "yellowCards" INTEGER,
    "redCards" INTEGER,
    "penaltiesScored" INTEGER,
    "ownGoals" INTEGER,
    "saves" INTEGER,
    "goalsConceded" INTEGER,
    "cleanSheets" INTEGER,
    "averageRating" DOUBLE PRECISION,
    "dataSource" TEXT,
    "lastVerified" TEXT,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026PlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldCup2026TeamMatchStat" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT,
    "teamCode" TEXT,
    "teamName" TEXT,
    "possessionPct" DOUBLE PRECISION,
    "totalShots" INTEGER,
    "shotsOnTarget" INTEGER,
    "corners" INTEGER,
    "fouls" INTEGER,
    "offsides" INTEGER,
    "saves" INTEGER,
    "xg" DOUBLE PRECISION,
    "dataSource" TEXT,
    "lastUpdated" TEXT,
    "sourceId" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldCup2026TeamMatchStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorldCup2026ImportBatch_sourceId_idx" ON "WorldCup2026ImportBatch"("sourceId");

-- CreateIndex
CREATE INDEX "WorldCup2026ImportBatch_status_idx" ON "WorldCup2026ImportBatch"("status");

-- CreateIndex
CREATE INDEX "WorldCup2026ImportBatch_createdAt_idx" ON "WorldCup2026ImportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Team_sourceTeamId_key" ON "WorldCup2026Team"("sourceTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Team_slug_key" ON "WorldCup2026Team"("slug");

-- CreateIndex
CREATE INDEX "WorldCup2026Team_fifaCode_idx" ON "WorldCup2026Team"("fifaCode");

-- CreateIndex
CREATE INDEX "WorldCup2026Team_groupLetter_idx" ON "WorldCup2026Team"("groupLetter");

-- CreateIndex
CREATE INDEX "WorldCup2026Team_confederation_idx" ON "WorldCup2026Team"("confederation");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Venue_sourceVenueId_key" ON "WorldCup2026Venue"("sourceVenueId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Venue_slug_key" ON "WorldCup2026Venue"("slug");

-- CreateIndex
CREATE INDEX "WorldCup2026Venue_country_idx" ON "WorldCup2026Venue"("country");

-- CreateIndex
CREATE INDEX "WorldCup2026Venue_city_idx" ON "WorldCup2026Venue"("city");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Stage_sourceStageId_key" ON "WorldCup2026Stage"("sourceStageId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Stage_slug_key" ON "WorldCup2026Stage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Referee_sourceRefereeId_key" ON "WorldCup2026Referee"("sourceRefereeId");

-- CreateIndex
CREATE INDEX "WorldCup2026Referee_slug_idx" ON "WorldCup2026Referee"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Match_sourceMatchId_key" ON "WorldCup2026Match"("sourceMatchId");

-- CreateIndex
CREATE INDEX "WorldCup2026Match_date_idx" ON "WorldCup2026Match"("date");

-- CreateIndex
CREATE INDEX "WorldCup2026Match_stageName_idx" ON "WorldCup2026Match"("stageName");

-- CreateIndex
CREATE INDEX "WorldCup2026Match_groupLetter_idx" ON "WorldCup2026Match"("groupLetter");

-- CreateIndex
CREATE INDEX "WorldCup2026Match_status_idx" ON "WorldCup2026Match"("status");

-- CreateIndex
CREATE INDEX "WorldCup2026Match_winnerTeamCode_idx" ON "WorldCup2026Match"("winnerTeamCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Player_sourcePlayerId_key" ON "WorldCup2026Player"("sourcePlayerId");

-- CreateIndex
CREATE INDEX "WorldCup2026Player_slug_idx" ON "WorldCup2026Player"("slug");

-- CreateIndex
CREATE INDEX "WorldCup2026Player_teamCode_idx" ON "WorldCup2026Player"("teamCode");

-- CreateIndex
CREATE INDEX "WorldCup2026Player_position_idx" ON "WorldCup2026Player"("position");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026MatchEvent_sourceEventId_key" ON "WorldCup2026MatchEvent"("sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026MatchEvent_importKey_key" ON "WorldCup2026MatchEvent"("importKey");

-- CreateIndex
CREATE INDEX "WorldCup2026MatchEvent_matchId_idx" ON "WorldCup2026MatchEvent"("matchId");

-- CreateIndex
CREATE INDEX "WorldCup2026MatchEvent_playerId_idx" ON "WorldCup2026MatchEvent"("playerId");

-- CreateIndex
CREATE INDEX "WorldCup2026MatchEvent_teamCode_idx" ON "WorldCup2026MatchEvent"("teamCode");

-- CreateIndex
CREATE INDEX "WorldCup2026MatchEvent_eventType_idx" ON "WorldCup2026MatchEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026Lineup_sourceLineupId_key" ON "WorldCup2026Lineup"("sourceLineupId");

-- CreateIndex
CREATE INDEX "WorldCup2026Lineup_matchId_idx" ON "WorldCup2026Lineup"("matchId");

-- CreateIndex
CREATE INDEX "WorldCup2026Lineup_playerId_idx" ON "WorldCup2026Lineup"("playerId");

-- CreateIndex
CREATE INDEX "WorldCup2026Lineup_teamCode_idx" ON "WorldCup2026Lineup"("teamCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026PlayerStat_playerId_key" ON "WorldCup2026PlayerStat"("playerId");

-- CreateIndex
CREATE INDEX "WorldCup2026PlayerStat_teamCode_idx" ON "WorldCup2026PlayerStat"("teamCode");

-- CreateIndex
CREATE INDEX "WorldCup2026PlayerStat_goals_idx" ON "WorldCup2026PlayerStat"("goals");

-- CreateIndex
CREATE INDEX "WorldCup2026PlayerStat_assists_idx" ON "WorldCup2026PlayerStat"("assists");

-- CreateIndex
CREATE INDEX "WorldCup2026TeamMatchStat_teamCode_idx" ON "WorldCup2026TeamMatchStat"("teamCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCup2026TeamMatchStat_matchId_teamCode_key" ON "WorldCup2026TeamMatchStat"("matchId", "teamCode");

-- AddForeignKey
ALTER TABLE "WorldCup2026Match" ADD CONSTRAINT "WorldCup2026Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorldCup2026Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Match" ADD CONSTRAINT "WorldCup2026Match_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "WorldCup2026Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Match" ADD CONSTRAINT "WorldCup2026Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "WorldCup2026Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Match" ADD CONSTRAINT "WorldCup2026Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "WorldCup2026Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Match" ADD CONSTRAINT "WorldCup2026Match_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "WorldCup2026Referee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Player" ADD CONSTRAINT "WorldCup2026Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "WorldCup2026Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026MatchEvent" ADD CONSTRAINT "WorldCup2026MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "WorldCup2026Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026MatchEvent" ADD CONSTRAINT "WorldCup2026MatchEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "WorldCup2026Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Lineup" ADD CONSTRAINT "WorldCup2026Lineup_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "WorldCup2026Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026Lineup" ADD CONSTRAINT "WorldCup2026Lineup_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "WorldCup2026Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026PlayerStat" ADD CONSTRAINT "WorldCup2026PlayerStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "WorldCup2026Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026PlayerStat" ADD CONSTRAINT "WorldCup2026PlayerStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "WorldCup2026Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026TeamMatchStat" ADD CONSTRAINT "WorldCup2026TeamMatchStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "WorldCup2026Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldCup2026TeamMatchStat" ADD CONSTRAINT "WorldCup2026TeamMatchStat_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "WorldCup2026Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
