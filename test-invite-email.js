/**
 * Test Script for Invite Email Functionality
 *
 * This script tests the invite email endpoint directly
 * Run: node test-invite-email.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { sendInviteEmail } from './src/invite-email-supabase.js';

const TEST_EMAIL = 'your-test-email@example.com'; // Replace with your email

console.log('\n🧪 Testing Invite Email Functionality\n');
console.log('=' .repeat(60));

async function runTest() {
  try {
    console.log(`\n1️⃣ Testing sendInviteEmail() function directly...`);
    console.log(`   Email: ${TEST_EMAIL}`);

    const result = await sendInviteEmail(TEST_EMAIL);

    console.log('\n📊 Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('\n✅ SUCCESS: Invite email function worked!');
      console.log('   Check your email inbox (and spam folder)');
      console.log('   Look for email from: noreply@mail.app.supabase.io');
      console.log('   Subject: "You have been invited"');
    } else {
      console.log('\n❌ FAILED: Error occurred');
      console.log('   Error:', result.error);

      // Common error diagnostics
      if (result.error?.includes('401') || result.error?.includes('unauthorized')) {
        console.log('\n💡 Diagnosis: SUPABASE_SERVICE_KEY is invalid or missing');
        console.log('   Fix: Check your .env file has correct SUPABASE_SERVICE_KEY');
      } else if (result.error?.includes('network') || result.error?.includes('ENOTFOUND')) {
        console.log('\n💡 Diagnosis: Cannot reach Supabase servers');
        console.log('   Fix: Check your internet connection');
      } else if (result.error?.includes('User already registered')) {
        console.log('\n💡 Diagnosis: User already exists in Supabase');
        console.log('   Note: Supabase invite emails only work for NEW users');
        console.log('   Try with a different email that hasn\'t registered yet');
      }
    }

  } catch (error) {
    console.error('\n❌ EXCEPTION:', error.message);
    console.error('\nStack:', error.stack);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n🏁 Test Complete\n');
}

runTest();
