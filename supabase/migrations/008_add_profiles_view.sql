-- Create profiles view for backward compatibility with existing code
-- This maps the 'profiles' reference to the actual 'users' table

CREATE OR REPLACE VIEW profiles AS
SELECT
  id,
  name as full_name,
  email,
  role,
  status,
  avatar as avatar_url,
  profile_json,
  created_at,
  last_login_at
FROM users;

-- Add comment for documentation
COMMENT ON VIEW profiles IS 'Backward compatibility view - maps profiles table reference to users table';

-- ── INSTEAD OF triggers to make the view fully writable ───────
-- Required for upsert (ON CONFLICT) support which auto-updatable views
-- do not handle. The service role key bypasses RLS on the underlying
-- users table, so these triggers can freely perform DML.

CREATE OR REPLACE FUNCTION profiles_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO users(id, name, email, role, status, avatar, profile_json)
  VALUES (
    NEW.id,
    NEW.full_name,
    NEW.email,
    NEW.role,
    COALESCE(NEW.status, 'active'),
    NEW.avatar_url,
    COALESCE(NEW.profile_json, '{}'::jsonb)
  )
  ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    email       = EXCLUDED.email,
    role        = EXCLUDED.role,
    status      = EXCLUDED.status,
    avatar      = EXCLUDED.avatar,
    profile_json = EXCLUDED.profile_json;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION profiles_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET
    name         = NEW.full_name,
    email        = NEW.email,
    role         = NEW.role,
    status       = NEW.status,
    avatar       = NEW.avatar_url,
    profile_json = NEW.profile_json
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION profiles_delete_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

-- Drop existing triggers if they exist, then recreate
DROP TRIGGER IF EXISTS profiles_insert ON profiles;
DROP TRIGGER IF EXISTS profiles_update ON profiles;
DROP TRIGGER IF EXISTS profiles_delete ON profiles;

CREATE TRIGGER profiles_insert
  INSTEAD OF INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_insert_fn();

CREATE TRIGGER profiles_update
  INSTEAD OF UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_update_fn();

CREATE TRIGGER profiles_delete
  INSTEAD OF DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_delete_fn();
