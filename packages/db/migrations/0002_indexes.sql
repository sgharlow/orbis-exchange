CREATE INDEX cells_by_region ON cells (region);
CREATE INDEX cells_by_owner ON cells (owner_id);
CREATE INDEX orders_book ON orders (commodity, side, price);
CREATE INDEX trades_by_commodity ON trades (commodity, executed_at);
