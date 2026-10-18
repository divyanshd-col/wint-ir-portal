-- Migration 031: Add platform domain bifurcation and super admin flag to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS platform_domain VARCHAR(20) NOT NULL DEFAULT 'cx',
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Create an index on platform_domain
CREATE INDEX IF NOT EXISTS idx_users_platform_domain ON users(platform_domain);

-- Assign Super Admin access to Apoorv, Sivaranjini, Suraj, and Divyansh
UPDATE users 
SET is_super_admin = true, 
    platform_domain = 'both'
WHERE email IN (
  'apoorv@wintwealth.com',
  'sivaranjini@wintwealth.com',
  'suraj.sudhakar@wintwealth.com',
  'kekansuraj8@wintwealth.com',
  'divyansh.d@wintwealth.com'
);
