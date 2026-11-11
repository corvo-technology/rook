-- Additive: the previous release neither reads nor writes this table.
CREATE TABLE "mission_states" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seenParts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shownAllAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mission_states_spaceId_userId_key" ON "mission_states"("spaceId", "userId");

ALTER TABLE "mission_states" ADD CONSTRAINT "mission_states_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same policies as provider_quotas.
ALTER TABLE "mission_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mission_states_tenant ON "mission_states"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY mission_states_system ON "mission_states"
  USING (current_setting('app.rls_bypass', true) = 'on');
