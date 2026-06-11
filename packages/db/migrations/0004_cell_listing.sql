-- Secondary market for cells (spec §4.4): an owner can list a cell for sale at a
-- price. NULL = not listed. Buying transfers ownership through the ledger.
ALTER TABLE cells ADD COLUMN list_price BIGINT;
