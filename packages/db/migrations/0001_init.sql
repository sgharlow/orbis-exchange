-- Participants, human and agent alike. Money is BIGINT credits, never float.
CREATE TABLE players (
    id           UUID PRIMARY KEY,
    handle       TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'human' | 'agent'
    credits      BIGINT NOT NULL,
    home_region  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);

-- World cells; demo grid plus region shard key. owner_id is app-enforced (no FK).
CREATE TABLE cells (
    id            BIGINT PRIMARY KEY,
    region        TEXT NOT NULL,
    x             INT NOT NULL,
    y             INT NOT NULL,
    resource_type TEXT NOT NULL,         -- 'ore'|'energy'|'biomass'|'rare'
    density       SMALLINT NOT NULL,     -- 0..100
    owner_id      UUID,
    updated_gen   BIGINT NOT NULL
);

CREATE TABLE inventory (
    player_id   UUID NOT NULL,
    commodity   TEXT NOT NULL,
    qty         BIGINT NOT NULL,
    PRIMARY KEY (player_id, commodity)
);

CREATE TABLE orders (
    id          UUID PRIMARY KEY,
    player_id   UUID NOT NULL,
    commodity   TEXT NOT NULL,
    side        TEXT NOT NULL,           -- 'buy' | 'sell'
    price       BIGINT NOT NULL,
    qty_open    BIGINT NOT NULL,
    status      TEXT NOT NULL,           -- 'open'|'filled'|'cancelled'
    created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE trades (
    id            UUID PRIMARY KEY,
    commodity     TEXT NOT NULL,
    buy_order_id  UUID NOT NULL,
    sell_order_id UUID NOT NULL,
    price         BIGINT NOT NULL,
    qty           BIGINT NOT NULL,
    generation    BIGINT NOT NULL,
    executed_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE market_state (
    commodity   TEXT PRIMARY KEY,
    last_price  BIGINT NOT NULL,
    best_bid    BIGINT,
    best_ask    BIGINT,
    generation  BIGINT NOT NULL
);

CREATE TABLE ticks (
    generation    BIGINT PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL,
    completed_at  TIMESTAMPTZ,
    cells_changed INT
);

CREATE TABLE agents (
    player_id  UUID PRIMARY KEY,
    strategy   TEXT NOT NULL,            -- 'maker'|'momentum'|'value'|'scout'|'arb'
    params     JSONB NOT NULL
);
