/**
 * Detailed diagnostic script to check quiz results in database
 * Shows full quiz_data JSONB field
 * Run: node src/check-results-detailed.js support@brandscaling.co.uk
 */

import dotenv from 'dotenv';
dotenv.config();

import { getPool } from './postgres-db.js';

async function checkResultsDetailed(email) {
  const client = await getPool().connect();
  
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log('\n🔍 Checking quiz results in database...');
    console.log(`📧 Email: "${email}"`);
    console.log(`📧 Normalized: "${normalizedEmail}"`);
    console.log('');
    
    // Get most recent result with full quiz_data
    const result = await client.query(
      `SELECT id, email, name, created_at, core_type, subtype, quiz_data 
       FROM quiz_results 
       WHERE LOWER(TRIM(email)) = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [normalizedEmail]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ No results found');
      return;
    }
    
    const row = result.rows[0];
    console.log('📊 Most Recent Result:');
    console.log(`   ID: ${row.id}`);
    console.log(`   Email: ${row.email}`);
    console.log(`   Name: ${row.name}`);
    console.log(`   Created: ${row.created_at}`);
    console.log(`   Core Type: ${row.core_type || 'NULL'}`);
    console.log(`   Subtype: ${row.subtype || 'NULL'}`);
    console.log('');
    
    if (row.quiz_data) {
      console.log('📦 Quiz Data (JSONB):');
      console.log(JSON.stringify(row.quiz_data, null, 2));
      console.log('');
      
      // Check if quiz_data has core_type
      if (row.quiz_data.core_type) {
        console.log(`✅ Quiz data contains core_type: ${row.quiz_data.core_type}`);
      } else {
        console.log('⚠️ Quiz data does not contain core_type');
      }
    } else {
      console.log('⚠️ No quiz_data found');
    }
    
    // Count total results
    const countResult = await client.query(
      'SELECT COUNT(*) as total FROM quiz_results WHERE LOWER(TRIM(email)) = $1',
      [normalizedEmail]
    );
    console.log(`\n📈 Total results for this email: ${countResult.rows[0].total}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
  } finally {
    client.release();
    process.exit(0);
  }
}

const email = process.argv[2] || 'support@brandscaling.co.uk';
checkResultsDetailed(email);

