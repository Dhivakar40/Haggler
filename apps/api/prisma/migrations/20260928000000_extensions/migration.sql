-- Extensions must exist before any table that uses their types.
-- PostGIS: geography type + GIST spatial indexes. gen_random_uuid() is built into PG 13+.
CREATE EXTENSION IF NOT EXISTS postgis;
