-- ============================================================================
-- Aurora MySQL Database Setup for E-DNA Quiz
-- ============================================================================
-- This script creates the database and tables needed for the E-DNA quiz system
-- Run this script manually or use the initializeDatabase() function in aurora-db.js
-- ============================================================================

-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS edna_quiz;

-- Use the database
USE edna_quiz;

-- ============================================================================
-- Table 1: quiz_results
-- Stores all quiz results from users
-- ============================================================================
CREATE TABLE IF NOT EXISTS quiz_results (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  core_type VARCHAR(50) NOT NULL,
  subtype VARCHAR(100) NOT NULL,
  decision_mastery INT,
  core_level INT,
  mirror_awareness INT,
  integration_level INT,
  pdf_url TEXT,
  s3_key VARCHAR(500),
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_date TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_created_at (created_at DESC),
  INDEX idx_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Table 2: pdf_download_tokens
-- Stores time-limited download tokens for PDF access via GHL webhook
-- ============================================================================
CREATE TABLE IF NOT EXISTS pdf_download_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_email (email),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Verify tables were created
-- ============================================================================
SHOW TABLES;

-- ============================================================================
-- View table structures
-- ============================================================================
DESCRIBE quiz_results;
DESCRIBE pdf_download_tokens;
