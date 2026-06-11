-- Investment (spec §4.4): a per-player extraction level. Higher level multiplies
-- mined yield (and depletion). Nullable; NULL is treated as level 0 in app logic
-- so existing rows need no backfill (DSQL-friendly).
ALTER TABLE players ADD COLUMN extract_level INT;
