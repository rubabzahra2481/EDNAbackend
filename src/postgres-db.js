/**
 * PostgreSQL Database Module for E-DNA Quiz
 * Uses pg (node-postgres) for Aurora PostgreSQL connection
 */
import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

// Database configuration from environment variables
const DB_CONFIG = {
  host: process.env.AURORA_HOST || process.env.DATABASE_URL?.split('@')[1]?.split(':')[0],
  port: parseInt(process.env.AURORA_PORT || '5432'),
  user: process.env.AURORA_USER || 'postgres',
  password: process.env.AURORA_PASSWORD,
  database: process.env.AURORA_DATABASE || 'edna_quiz',
  ssl: {
    rejectUnauthorized: false // Required for AWS RDS
  },
  // Connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000, // Increased timeout for Aurora (was 10000)
};

let pool = null;

/**
 * Get or create PostgreSQL connection pool
 */
export function getPool() {
  if (!pool) {
    console.log('\n🔗 Creating PostgreSQL connection pool...');
    console.log(`   Host: ${DB_CONFIG.host}`);
    console.log(`   Port: ${DB_CONFIG.port}`);
    console.log(`   Database: ${DB_CONFIG.database}`);
    console.log(`   User: ${DB_CONFIG.user}`);
    
    pool = new Pool(DB_CONFIG);
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('❌ Unexpected PostgreSQL pool error:', err);
    });
    
    console.log('✅ PostgreSQL connection pool created');
  }
  
  return pool;
}

/**
 * Initialize database - create tables if they don't exist
 */
export async function initializeDatabase() {
  const client = await getPool().connect();
  
  try {
    console.log('\n📊 Initializing PostgreSQL database...');
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Users table ready');
    
    // Create quiz_results table
    console.log('Creating quiz_results table...');
    await client.query(`
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
      )
    `);
    
    console.log('✅ Quiz results table ready');
    
    // Create indexes
    console.log('Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quiz_email ON quiz_results(email)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_quiz_created_at ON quiz_results(created_at DESC)
    `);
    
    console.log('✅ Indexes created');
    
    // Create pdf_download_tokens table
    console.log('Creating pdf_download_tokens table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS pdf_download_tokens (
        token VARCHAR(255) PRIMARY KEY,
        quiz_result_id UUID NOT NULL REFERENCES quiz_results(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index on expiration
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_token_expires ON pdf_download_tokens(expires_at)
    `);
    
    console.log('✅ PDF download tokens table ready');
    
    // Create quiz_progress table for saving in-progress quizzes
    console.log('Creating quiz_progress table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_progress (
        email VARCHAR(255) PRIMARY KEY,
        progress_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Quiz progress table ready');
    console.log('✅ Database tables initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize database:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Save quiz result to PostgreSQL
 */
export async function saveQuizResult(id, email, name, results, pdfUrl, s3Key) {
  const client = await getPool().connect();
  
  try {
    // Normalize email to lowercase for consistent storage and retrieval
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log(`💾 Saving quiz result for email: "${email}" (normalized: "${normalizedEmail}")`);
    
    const query = `
      INSERT INTO quiz_results (
        id, email, name, quiz_data, edna_type, core_type, subtype,
        core_mastery, subtype_mastery, pdf_url, s3_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        quiz_data = EXCLUDED.quiz_data,
        edna_type = EXCLUDED.edna_type,
        core_type = EXCLUDED.core_type,
        subtype = EXCLUDED.subtype,
        core_mastery = EXCLUDED.core_mastery,
        subtype_mastery = EXCLUDED.subtype_mastery,
        pdf_url = EXCLUDED.pdf_url,
        s3_key = EXCLUDED.s3_key,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      id,
      normalizedEmail, // Use normalized email
      name,
      JSON.stringify(results),
      results.ednaType || null,
      results.coreType || null,
      results.subtype || null,
      results.coreTypeMastery || null,
      results.subtypeMastery || null,
      pdfUrl,
      s3Key
    ];
    
    const result = await client.query(query, values);
    
    console.log(`✅ Quiz result saved to PostgreSQL for ${normalizedEmail}`);
    
    return { success: true, data: result.rows[0] };
    
  } catch (error) {
    console.error('❌ Failed to save quiz result:', error.message);
    console.error('❌ Error stack:', error.stack);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Get quiz result by ID
 */
export async function getQuizResultById(id) {
  const client = await getPool().connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM quiz_results WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Quiz result not found' };
    }
    
    return { success: true, data: result.rows[0] };
    
  } catch (error) {
    console.error('❌ Failed to get quiz result:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Get quiz result by email (for dashboard)
 */
export async function getQuizResultByEmail(email) {
  const client = await getPool().connect();
  
  try {
    // Normalize email to lowercase for consistent queries
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log(`🔍 Database query: Looking for email: "${normalizedEmail}"`);
    
    const result = await client.query(
      'SELECT * FROM quiz_results WHERE LOWER(TRIM(email)) = $1 ORDER BY created_at DESC LIMIT 1',
      [normalizedEmail]
    );
    
    console.log(`📊 Database query result: Found ${result.rows.length} row(s)`);
    
    if (result.rows.length === 0) {
      // Try case-insensitive search as fallback
      const fallbackResult = await client.query(
        'SELECT * FROM quiz_results WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT 1',
        [`%${normalizedEmail}%`]
      );
      
      if (fallbackResult.rows.length > 0) {
        console.log(`✅ Found result with case-insensitive search`);
        return { success: true, data: fallbackResult.rows[0] };
      }
      
      console.log(`❌ No quiz result found for email: "${normalizedEmail}"`);
      return { success: false, error: 'Quiz result not found' };
    }
    
    console.log(`✅ Quiz result found for: "${normalizedEmail}"`);
    return { success: true, data: result.rows[0] };
    
  } catch (error) {
    console.error('❌ Failed to get quiz result by email:', error.message);
    console.error('❌ Error stack:', error.stack);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Create download token
 */
export async function createDownloadToken(token, quizResultId, expiresAt) {
  const client = await getPool().connect();
  
  try {
    await client.query(
      'INSERT INTO pdf_download_tokens (token, quiz_result_id, expires_at) VALUES ($1, $2, $3)',
      [token, quizResultId, expiresAt]
    );
    
    console.log(`✅ Download token created (expires: ${expiresAt})`);
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Failed to create download token:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Verify download token
 */
export async function verifyDownloadToken(token) {
  const client = await getPool().connect();
  
  try {
    const result = await client.query(
      `SELECT t.*, q.* 
       FROM pdf_download_tokens t
       JOIN quiz_results q ON t.quiz_result_id = q.id
       WHERE t.token = $1 AND t.expires_at > CURRENT_TIMESTAMP`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Invalid or expired token' };
    }
    
    return { success: true, data: result.rows[0] };
    
  } catch (error) {
    console.error('❌ Failed to verify token:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Test database connection
 */
export async function testConnection() {
  try {
    const client = await getPool().connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    
    console.log('✅ PostgreSQL connection successful');
    console.log(`   Server time: ${result.rows[0].now}`);
    
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
}

/**
 * Save quiz progress for authenticated user
 */
export async function saveQuizProgress(email, progressData) {
  const client = await getPool().connect();
  
  try {
    const query = `
      INSERT INTO quiz_progress (email, progress_data, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (email)
      DO UPDATE SET
        progress_data = $2,
        updated_at = CURRENT_TIMESTAMP
    `;
    
    await client.query(query, [email, JSON.stringify(progressData)]);
    console.log(`✅ Saved quiz progress for ${email}`);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to save quiz progress:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get quiz progress for authenticated user
 */
export async function getQuizProgress(email) {
  const client = await getPool().connect();
  
  try {
    const query = 'SELECT progress_data, updated_at FROM quiz_progress WHERE email = $1';
    const result = await client.query(query, [email]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return {
      progressData: result.rows[0].progress_data,
      updatedAt: result.rows[0].updated_at
    };
  } catch (error) {
    console.error('❌ Failed to get quiz progress:', error.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Delete quiz progress after completion
 */
export async function deleteQuizProgress(email) {
  const client = await getPool().connect();
  
  try {
    const query = 'DELETE FROM quiz_progress WHERE email = $1';
    await client.query(query, [email]);
    console.log(`✅ Deleted quiz progress for ${email}`);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to delete quiz progress:', error.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Close database connection pool
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ PostgreSQL connection pool closed');
  }
}

// /**
//  * PostgreSQL Database Module for E-DNA Quiz
//  * Uses pg (node-postgres) for Aurora PostgreSQL connection
//  */
// import dotenv from 'dotenv';
// dotenv.config();

// import pg from 'pg';
// const { Pool } = pg;

// // Database configuration from environment variables
// const DB_CONFIG = {
//   host: process.env.AURORA_HOST || process.env.DATABASE_URL?.split('@')[1]?.split(':')[0],
//   port: parseInt(process.env.AURORA_PORT || '5432'),
//   user: process.env.AURORA_USER || 'postgres',
//   password: process.env.AURORA_PASSWORD,
//   database: process.env.AURORA_DATABASE || 'edna_quiz',
//   ssl: {
//     rejectUnauthorized: false // Required for AWS RDS
//   },
//   // Connection pool settings
//   max: 20, // Maximum number of clients in the pool
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 10000,
// };

// let pool = null;

// /**
//  * Get or create PostgreSQL connection pool
//  */
// export function getPool() {
//   if (!pool) {
//     console.log('\n🔗 Creating PostgreSQL connection pool...');
//     console.log(`   Host: ${DB_CONFIG.host}`);
//     console.log(`   Port: ${DB_CONFIG.port}`);
//     console.log(`   Database: ${DB_CONFIG.database}`);
//     console.log(`   User: ${DB_CONFIG.user}`);
    
//     pool = new Pool(DB_CONFIG);
    
//     // Handle pool errors
//     pool.on('error', (err) => {
//       console.error('❌ Unexpected PostgreSQL pool error:', err);
//     });
    
//     console.log('✅ PostgreSQL connection pool created');
//   }
  
//   return pool;
// }

// /**
//  * Initialize database - create tables if they don't exist
//  */
// export async function initializeDatabase() {
//   const client = await getPool().connect();
  
//   try {
//     console.log('\n📊 Initializing PostgreSQL database...');
    
//     // Create quiz_results table
//     await client.query(`
//       CREATE TABLE IF NOT EXISTS quiz_results (
//         id UUID PRIMARY KEY,
//         user_id UUID,
//         email VARCHAR(255) NOT NULL,
//         name VARCHAR(255),
//         quiz_data JSONB NOT NULL,
//         edna_type VARCHAR(100),
//         core_type VARCHAR(50),
//         subtype VARCHAR(50),
//         core_mastery INTEGER,
//         subtype_mastery INTEGER,
//         pdf_url TEXT,
//         s3_key TEXT,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//       )
//     `);
    
//     // Create indexes
//     await client.query(`
//       CREATE INDEX IF NOT EXISTS idx_quiz_email ON quiz_results(email)
//     `);
    
//     await client.query(`
//       CREATE INDEX IF NOT EXISTS idx_quiz_created_at ON quiz_results(created_at DESC)
//     `);
    
//     // Create pdf_download_tokens table
//     await client.query(`
//       CREATE TABLE IF NOT EXISTS pdf_download_tokens (
//         token VARCHAR(255) PRIMARY KEY,
//         quiz_result_id UUID NOT NULL REFERENCES quiz_results(id) ON DELETE CASCADE,
//         expires_at TIMESTAMP NOT NULL,
//         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//       )
//     `);
    
//     // Create index on expiration
//     await client.query(`
//       CREATE INDEX IF NOT EXISTS idx_token_expires ON pdf_download_tokens(expires_at)
//     `);
    
//     console.log('✅ Database tables initialized successfully');
    
//   } catch (error) {
//     console.error('❌ Failed to initialize database:', error.message);
//     throw error;
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Save quiz result to PostgreSQL
//  */
// export async function saveQuizResult(id, email, name, results, pdfUrl, s3Key) {
//   const client = await getPool().connect();
  
//   try {
//     const query = `
//       INSERT INTO quiz_results (
//         id, email, name, quiz_data, edna_type, core_type, subtype,
//         core_mastery, subtype_mastery, pdf_url, s3_key
//       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
//       ON CONFLICT (id) DO UPDATE SET
//         quiz_data = EXCLUDED.quiz_data,
//         edna_type = EXCLUDED.edna_type,
//         core_type = EXCLUDED.core_type,
//         subtype = EXCLUDED.subtype,
//         core_mastery = EXCLUDED.core_mastery,
//         subtype_mastery = EXCLUDED.subtype_mastery,
//         pdf_url = EXCLUDED.pdf_url,
//         s3_key = EXCLUDED.s3_key,
//         updated_at = CURRENT_TIMESTAMP
//       RETURNING *
//     `;
    
//     const values = [
//       id,
//       email,
//       name,
//       JSON.stringify(results),
//       results.ednaType || null,
//       results.coreType || null,
//       results.subtype || null,
//       results.coreTypeMastery || null,
//       results.subtypeMastery || null,
//       pdfUrl,
//       s3Key
//     ];
    
//     const result = await client.query(query, values);
    
//     console.log(`✅ Quiz result saved to PostgreSQL for ${email}`);
    
//     return { success: true, data: result.rows[0] };
    
//   } catch (error) {
//     console.error('❌ Failed to save quiz result:', error.message);
//     return { success: false, error: error.message };
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Get quiz result by ID
//  */
// export async function getQuizResultById(id) {
//   const client = await getPool().connect();
  
//   try {
//     const result = await client.query(
//       'SELECT * FROM quiz_results WHERE id = $1',
//       [id]
//     );
    
//     if (result.rows.length === 0) {
//       return { success: false, error: 'Quiz result not found' };
//     }
    
//     return { success: true, data: result.rows[0] };
    
//   } catch (error) {
//     console.error('❌ Failed to get quiz result:', error.message);
//     return { success: false, error: error.message };
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Get quiz result by email (for dashboard)
//  */
// export async function getQuizResultByEmail(email) {
//   const client = await getPool().connect();
  
//   try {
//     const result = await client.query(
//       'SELECT * FROM quiz_results WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
//       [email]
//     );
    
//     if (result.rows.length === 0) {
//       return { success: false, error: 'Quiz result not found' };
//     }
    
//     return { success: true, data: result.rows[0] };
    
//   } catch (error) {
//     console.error('❌ Failed to get quiz result by email:', error.message);
//     return { success: false, error: error.message };
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Create download token
//  */
// export async function createDownloadToken(token, quizResultId, expiresAt) {
//   const client = await getPool().connect();
  
//   try {
//     await client.query(
//       'INSERT INTO pdf_download_tokens (token, quiz_result_id, expires_at) VALUES ($1, $2, $3)',
//       [token, quizResultId, expiresAt]
//     );
    
//     console.log(`✅ Download token created (expires: ${expiresAt})`);
    
//     return { success: true };
    
//   } catch (error) {
//     console.error('❌ Failed to create download token:', error.message);
//     return { success: false, error: error.message };
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Verify download token
//  */
// export async function verifyDownloadToken(token) {
//   const client = await getPool().connect();
  
//   try {
//     const result = await client.query(
//       `SELECT t.*, q.* 
//        FROM pdf_download_tokens t
//        JOIN quiz_results q ON t.quiz_result_id = q.id
//        WHERE t.token = $1 AND t.expires_at > CURRENT_TIMESTAMP`,
//       [token]
//     );
    
//     if (result.rows.length === 0) {
//       return { success: false, error: 'Invalid or expired token' };
//     }
    
//     return { success: true, data: result.rows[0] };
    
//   } catch (error) {
//     console.error('❌ Failed to verify token:', error.message);
//     return { success: false, error: error.message };
//   } finally {
//     client.release();
//   }
// }

// /**
//  * Test database connection
//  */
// export async function testConnection() {
//   try {
//     const client = await getPool().connect();
//     const result = await client.query('SELECT NOW()');
//     client.release();
    
//     console.log('✅ PostgreSQL connection successful');
//     console.log(`   Server time: ${result.rows[0].now}`);
    
//     return true;
//   } catch (error) {
//     console.error('❌ PostgreSQL connection failed:', error.message);
//     return false;
//   }
// }

// /**
//  * Close database connection pool
//  */
// export async function closePool() {
//   if (pool) {
//     await pool.end();
//     pool = null;
//     console.log('✅ PostgreSQL connection pool closed');
//   }
// }
