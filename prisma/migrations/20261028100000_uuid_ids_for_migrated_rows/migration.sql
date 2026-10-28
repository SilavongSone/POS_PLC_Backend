-- The SaaS migration gave the rows it created readable ids (tenant_plc, branch_plc_main,
-- plan_*, sub_plc). The API validates ids as UUIDs, so those rows could not be addressed
-- (e.g. ?branchId= of the MAIN branch). Give them UUIDs; every foreign key is
-- ON UPDATE CASCADE. Tokens issued before carry the old company id: users sign in again.
UPDATE "Tenant" SET "id" = gen_random_uuid()::text WHERE "id" = 'tenant_plc';
UPDATE "Branch" SET "id" = gen_random_uuid()::text WHERE "id" = 'branch_plc_main';
UPDATE "Plan" SET "id" = gen_random_uuid()::text
  WHERE "id" IN ('plan_free', 'plan_starter', 'plan_business', 'plan_enterprise');
UPDATE "Subscription" SET "id" = gen_random_uuid()::text WHERE "id" = 'sub_plc';
