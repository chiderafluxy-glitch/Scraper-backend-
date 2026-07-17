-- Final Expense Agent Lead Pipeline - Supabase Schema
-- Run this in the Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- STAGING TABLES
-- =============================================================================

-- Queue for tracking scrape jobs
CREATE TABLE scrape_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    city_or_zip VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
    attempts INT DEFAULT 0,
    last_attempted_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scrape_queue_status ON scrape_queue(status);
CREATE INDEX idx_scrape_queue_source ON scrape_queue(source);
CREATE INDEX idx_scrape_queue_state ON scrape_queue(state);

-- Raw agent records from scraping
CREATE TABLE raw_agent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(100) NOT NULL,
    source_agent_id VARCHAR(255),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(2),
    zip VARCHAR(10),
    license_lines TEXT,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_source_agent_id UNIQUE (source, source_agent_id)
);

CREATE INDEX idx_raw_agent_records_source ON raw_agent_records(source);
CREATE INDEX idx_raw_agent_records_phone ON raw_agent_records(phone);
CREATE INDEX idx_raw_agent_records_state ON raw_agent_records(state);

-- =============================================================================
-- MAIN TABLES
-- =============================================================================

-- Delivery batches for tracking exports
CREATE TABLE delivery_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    description TEXT,
    count INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Normalized agent records
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    phone_e164 VARCHAR(20),
    phone_confidence VARCHAR(50) DEFAULT 'carrier_direct',
    email VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(2),
    zip VARCHAR(10),
    sources TEXT[] DEFAULT '{}',
    source_agent_ids JSONB DEFAULT '{}',
    license_lines TEXT,
    delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ,
    delivered_batch_id UUID REFERENCES delivery_batches(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_phone ON agents(phone_e164);
CREATE INDEX idx_agents_state ON agents(state);
CREATE INDEX idx_agents_delivered ON agents(delivered);
CREATE INDEX idx_agents_phone_confidence ON agents(phone_confidence);

-- =============================================================================
-- CONFIGURATION
-- =============================================================================

-- Global configuration table
CREATE TABLE config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config
INSERT INTO config (key, value) VALUES 
    ('global_cap', '{"limit": 20000, "enabled": true}'),
    ('sources', '{"enabled": ["mutual_of_omaha"]}')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to normalize phone to E.164 format
CREATE OR REPLACE FUNCTION normalize_phone_e164(phone_raw TEXT)
RETURNS TEXT AS $$
DECLARE
    normalized TEXT;
BEGIN
    IF phone_raw IS NULL OR phone_raw = '' THEN
        RETURN NULL;
    END IF;
    
    -- Remove all non-digit characters except leading +
    normalized := regexp_replace(phone_raw, '[^\d+]', '', 'g');
    
    -- Handle US numbers (10 digits)
    IF length(normalized) = 10 THEN
        normalized := '+1' || normalized;
    ELSIF length(normalized) = 11 AND left(normalized, 1) = '1' THEN
        normalized := '+' || normalized;
    END IF;
    
    -- Ensure it starts with +
    IF left(normalized, 1) != '+' THEN
        normalized := '+' || normalized;
    END IF;
    
    RETURN normalized;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if under global cap
CREATE OR REPLACE FUNCTION check_under_global_cap()
RETURNS BOOLEAN AS $$
DECLARE
    cap INT;
    current_count INT;
    enabled BOOLEAN;
BEGIN
    SELECT (value->>'limit')::INT, (value->>'enabled')::BOOLEAN 
    INTO cap, enabled 
    FROM config WHERE key = 'global_cap';
    
    IF NOT enabled OR cap IS NULL THEN
        RETURN TRUE;
    END IF;
    
    SELECT COUNT(*) INTO current_count FROM agents;
    
    RETURN current_count < cap;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_scrape_queue_updated_at
    BEFORE UPDATE ON scrape_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Function to get agent stats
CREATE OR REPLACE FUNCTION get_agent_stats()
RETURNS TABLE(
    total_agents BIGINT,
    total_delivered BIGINT,
    remaining BIGINT,
    by_state JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE delivered)::BIGINT,
        COUNT(*) FILTER (WHERE NOT delivered)::BIGINT,
        jsonb_object_agg(state, count)::JSONB
    FROM agents;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ROW LEVEL SECURITY (optional, enable if needed)
-- =============================================================================

-- Enable RLS if you want to restrict access
-- ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE raw_agent_records ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scrape_queue ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SAMPLE DATA FOR TESTING (optional)
-- =============================================================================

-- Insert sample scrape queue entries for TX, FL, GA
-- This will be populated by the scraper initialization
