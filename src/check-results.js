/**
 * Diagnostic script to check quiz results in database
 * Run: node src/check-results.js support@brandscaling.co.uk
 */

import dotenv from 'dotenv';
dotenv.config();

import { getPool } from './postgres-db.js';

async function checkResults(email) {
  const client = await getPool().connect();
  
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log('\n🔍 Checking quiz results in database...');
    console.log(`📧 Email: "${email}"`);
    console.log(`📧 Normalized: "${normalizedEmail}"`);
    console.log('');
    
    // Check exact match
    console.log('1️⃣ Checking exact match (case-sensitive):');
    const exactResult = await client.query(
      'SELECT id, email, name, created_at, core_type, subtype FROM quiz_results WHERE email = $1',
      [email]
    );
    console.log(`   Found: ${exactResult.rows.length} row(s)`);
    if (exactResult.rows.length > 0) {
      exactResult.rows.forEach((row, idx) => {
        console.log(`   Row ${idx + 1}:`, {
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          core_type: row.core_type
        });
      });
    }
    
    // Check normalized match
    console.log('\n2️⃣ Checking normalized match (lowercase):');
    const normalizedResult = await client.query(
      'SELECT id, email, name, created_at, core_type, subtype FROM quiz_results WHERE LOWER(TRIM(email)) = $1',
      [normalizedEmail]
    );
    console.log(`   Found: ${normalizedResult.rows.length} row(s)`);
    if (normalizedResult.rows.length > 0) {
      normalizedResult.rows.forEach((row, idx) => {
        console.log(`   Row ${idx + 1}:`, {
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          core_type: row.core_type
        });
      });
    }
    
    // Check case-insensitive match
    console.log('\n3️⃣ Checking case-insensitive match (ILIKE):');
    const ilikeResult = await client.query(
      'SELECT id, email, name, created_at, core_type, subtype FROM quiz_results WHERE email ILIKE $1',
      [`%${normalizedEmail}%`]
    );
    console.log(`   Found: ${ilikeResult.rows.length} row(s)`);
    if (ilikeResult.rows.length > 0) {
      ilikeResult.rows.forEach((row, idx) => {
        console.log(`   Row ${idx + 1}:`, {
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          core_type: row.core_type
        });
      });
    }
    
    // List all emails in database
    console.log('\n4️⃣ All emails in database:');
    const allEmails = await client.query(
      'SELECT DISTINCT email, COUNT(*) as count FROM quiz_results GROUP BY email ORDER BY email'
    );
    console.log(`   Total unique emails: ${allEmails.rows.length}`);
    allEmails.rows.forEach((row, idx) => {
      console.log(`   ${idx + 1}. "${row.email}" (${row.count} result(s))`);
    });
    
    // Check most recent results
    console.log('\n5️⃣ Most recent 5 quiz results:');
    const recentResults = await client.query(
      'SELECT id, email, name, created_at, core_type, subtype FROM quiz_results ORDER BY created_at DESC LIMIT 5'
    );
    recentResults.rows.forEach((row, idx) => {
      console.log(`   ${idx + 1}. Email: "${row.email}", Created: ${row.created_at}, Type: ${row.core_type}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
  } finally {
    client.release();
    process.exit(0);
  }
}

const email = process.argv[2] || 'support@brandscaling.co.uk';
checkResults(email);

