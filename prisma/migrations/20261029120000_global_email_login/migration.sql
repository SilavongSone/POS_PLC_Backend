-- Email-based sign-in searches users across companies before resolving the tenant.
CREATE INDEX "User_email_idx" ON "User"("email");
