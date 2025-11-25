-- ================================================
-- E-DNA Quiz - PostgreSQL Database Schema
-- For Aurora PostgreSQL
-- ================================================

-- Create database (run this separately if needed)
-- CREATE DATABASE edna_quiz;

-- Connect to the database
\c edna_quiz;

-- ================================================
-- Table 1: quiz_results
-- Stores all quiz submissions and results
-- ================================================

CREATE TABLE IF NOT EXISTS quiz_results (
    id UUID PRIMARY KEY,
    user_id UUID,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    quiz_data JSONB NOT NULL,
    edna_type VARCHAR(100),
    core_type VARCHAR(50),
    subtype VARCHAR(50),
    core_mastery INTEGER,
    subtype_mastery INTEGER,
    pdf_url TEXT,
    s3_key TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for quiz_results
CREATE INDEX IF NOT EXISTS idx_quiz_email ON quiz_results(email);
CREATE INDEX IF NOT EXISTS idx_quiz_created_at ON quiz_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_user_id ON quiz_results(user_id);

-- ================================================
-- Table 2: pdf_download_tokens
-- Stores time-limited download tokens for PDF access
-- ================================================

CREATE TABLE IF NOT EXISTS pdf_download_tokens (
    token VARCHAR(255) PRIMARY KEY,
    quiz_result_id UUID NOT NULL REFERENCES quiz_results(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for token expiration
CREATE INDEX IF NOT EXISTS idx_token_expires ON pdf_download_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_token_quiz_id ON pdf_download_tokens(quiz_result_id);

-- ================================================
-- Cleanup Function: Remove expired tokens
-- ================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM pdf_download_tokens WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- Verification Queries
-- ================================================

-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('quiz_results', 'pdf_download_tokens');

-- Check table structures
\d quiz_results
\d pdf_download_tokens

-- ================================================
-- Sample Queries (for testing)
-- ================================================

-- Count total quiz results
-- SELECT COUNT(*) as total_quizzes FROM quiz_results;

-- Get recent quiz results
-- SELECT id, email, name, edna_type, created_at 
-- FROM quiz_results 
-- ORDER BY created_at DESC 
-- LIMIT 10;

-- Clean up expired tokens
-- SELECT cleanup_expired_tokens();

-- Check active tokens
-- SELECT COUNT(*) as active_tokens 
-- FROM pdf_download_tokens 
-- WHERE expires_at > CURRENT_TIMESTAMP;
