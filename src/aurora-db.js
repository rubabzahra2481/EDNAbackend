import mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Aurora MySQL Configuration
const config = {
  host: process.env.AURORA_HOST || 'brandscaling-aurora.cluster-cc1k8qu4cwi2.us-east-1.rds.amazonaws.com',
  port: parseInt(process.env.AURORA_PORT || '3306'),
  user: process.env.AURORA_USER || 'admin_bs',
  password: process.env.AURORA_PASSWORD,
  database: process.env.AURORA_DATABASE || 'edna_quiz',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

let pool = null;

/**
 * Get MySQL connection pool
 * Creates a new pool if it doesn't exist
 */
export function getPool() {
  if (!pool) {
    pool = mysql.createPool(config);
    console.log('✅ MySQL connection pool created');
  }
  return pool;
}

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const pool = getPool();
    const connection = await pool.getConnection();
    console.log('✅ Aurora MySQL connection successful');
    console.log(`   Host: ${config.host}`);
    console.log(`   Database: ${config.database}`);
    connection.release();
    return { success: true };
  } catch (error) {
    console.error('❌ Aurora MySQL connection failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize database and create tables if they don't exist
 */
export async function initializeDatabase() {
  try {
    const pool = getPool();

    console.log('📝 Initializing Aurora MySQL database...');

    // Create database if it doesn't exist
    const dbName = config.database;
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ Database '${dbName}' ready`);

    // Use the database
    await pool.query(`USE \`${dbName}\``);

    // Create quiz_results table
    await pool.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Table quiz_results ready');

    // Create pdf_download_tokens table
    await pool.query(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Table pdf_download_tokens ready');

    console.log('✅ Database initialization complete\n');
    return { success: true };
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Save quiz result to database
 */
export async function saveQuizResult(id, email, name, results, pdfUrl = null, s3Key = null) {
  try {
    const pool = getPool();

    await pool.query(`
      INSERT INTO quiz_results (
        id, email, name, core_type, subtype,
        decision_mastery, core_level, mirror_awareness, integration_level,
        pdf_url, s3_key, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      id,
      email.toLowerCase(),
      name,
      results.core_type,
      results.subtype,
      results.decision_mastery,
      results.core_level,
      results.mirror_awareness,
      results.integration_level,
      pdfUrl,
      s3Key
    ]);

    console.log(`✅ Quiz result saved to Aurora: ${id}`);
    return { success: true, id };
  } catch (error) {
    console.error('❌ Error saving quiz result to Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get quiz result by email
 */
export async function getQuizResultByEmail(email) {
  try {
    const pool = getPool();

    const [rows] = await pool.query(
      'SELECT * FROM quiz_results WHERE email = ? ORDER BY created_at DESC LIMIT 1',
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return { success: false, error: 'No quiz result found for this email' };
    }

    console.log(`✅ Quiz result retrieved for: ${email}`);
    return { success: true, data: rows[0] };
  } catch (error) {
    console.error('❌ Error retrieving quiz result from Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update quiz result with PDF URL and S3 key
 */
export async function updateQuizResultPDF(resultId, pdfUrl, s3Key) {
  try {
    const pool = getPool();

    await pool.query(
      'UPDATE quiz_results SET pdf_url = ?, s3_key = ? WHERE id = ?',
      [pdfUrl, s3Key, resultId]
    );

    console.log(`✅ PDF URL updated in Aurora for result: ${resultId}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error updating quiz result PDF in Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(email, status = 'completed') {
  try {
    const pool = getPool();

    await pool.query(
      'UPDATE quiz_results SET payment_status = ?, payment_date = NOW() WHERE email = ?',
      [status, email.toLowerCase()]
    );

    console.log(`✅ Payment status updated for: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error updating payment status in Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new PDF download token
 */
export async function createPdfDownloadToken({ email, s3Key, expiresInHours = 7 }) {
  try {
    const pool = getPool();

    // Generate a secure random token
    const token = randomBytes(32).toString('hex');

    // Calculate expiration time (7 days from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    await pool.query(
      'INSERT INTO pdf_download_tokens (email, token, s3_key, expires_at) VALUES (?, ?, ?, ?)',
      [email.toLowerCase(), token, s3Key, expiresAt]
    );

    console.log(`✅ PDF download token created for ${email} (expires in ${expiresInHours}h)`);

    return {
      success: true,
      token: token,
      expiresAt: expiresAt.toISOString()
    };
  } catch (error) {
    console.error('❌ Error creating PDF download token in Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get PDF link record by token
 */
export async function getPdfLinkByToken(token) {
  try {
    const pool = getPool();

    const [rows] = await pool.query(
      'SELECT * FROM pdf_download_tokens WHERE token = ? LIMIT 1',
      [token]
    );

    if (rows.length === 0) {
      console.log(`⚠️  Token not found: ${token.substring(0, 8)}...`);
      return { success: false, error: 'Token not found' };
    }

    const record = rows[0];
    console.log(`✅ PDF link retrieved for token: ${token.substring(0, 8)}... (email: ${record.email})`);

    return {
      success: true,
      record: {
        email: record.email,
        s3_key: record.s3_key,
        expires_at: record.expires_at,
        created_at: record.created_at
      }
    };
  } catch (error) {
    console.error('❌ Error retrieving PDF link by token from Aurora:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  getPool,
  testConnection,
  initializeDatabase,
  saveQuizResult,
  getQuizResultByEmail,
  updateQuizResultPDF,
  updatePaymentStatus,
  createPdfDownloadToken,
  getPdfLinkByToken
};
