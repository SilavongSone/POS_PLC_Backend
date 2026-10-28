-- New permission "exchangeRate.manage": managers update the daily THB/USD rate.
-- Groups still empty are filled by the seed instead.
UPDATE "UserGroup"
SET "permissions" = array_append("permissions", 'exchangeRate.manage')
WHERE "name" = 'Manager'
  AND "isSystem"
  AND cardinality("permissions") > 0
  AND NOT ('exchangeRate.manage' = ANY ("permissions"));
