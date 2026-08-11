-- Migration 014: allow profile-edit actions in the identity audit log.
--
-- Admins can now correct a user's Name (the Robylon attribution key) and email
-- after creation; those edits are audited as 'name_change' / 'email_change'.
-- Widen the identity_audit.action CHECK to accept them. Additive + idempotent.

ALTER TABLE identity_audit DROP CONSTRAINT IF EXISTS identity_audit_action_check;

ALTER TABLE identity_audit ADD CONSTRAINT identity_audit_action_check
  CHECK (action IN (
    'invite', 'resend_invite', 'signup_completed',
    'login_success', 'login_fail',
    'role_change', 'status_change',
    'signup_link_expired',
    'name_change', 'email_change'
  ));
