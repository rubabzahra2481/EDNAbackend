/**
 * Environment Variable Verification Script
 * Run: node verify-env.js
 */

import dotenv from 'dotenv';
dotenv.config();

console.log('\n🔍 Verifying Environment Configuration\n');
console.log('='.repeat(60));

const requiredVars = {
  'SUPABASE_URL': process.env.SUPABASE_URL,
  'SUPABASE_SERVICE_KEY': process.env.SUPABASE_SERVICE_KEY,
  'FRONTEND_URL': process.env.FRONTEND_URL,
  'AWS_REGION': process.env.AWS_REGION,
  'AWS_ACCESS_KEY_ID': process.env.AWS_ACCESS_KEY_ID,
  'AWS_SECRET_ACCESS_KEY': process.env.AWS_SECRET_ACCESS_KEY,
  'S3_BUCKET_NAME': process.env.S3_BUCKET_NAME,
  'GHL_INBOUND_WEBHOOK_URL': process.env.GHL_INBOUND_WEBHOOK_URL,
  'PUBLIC_BACKEND_BASE_URL': process.env.PUBLIC_BACKEND_BASE_URL,
  'PORT': process.env.PORT
};

let allGood = true;

for (const [key, value] of Object.entries(requiredVars)) {
  if (value) {
    // Show partial value for security
    const displayValue = key.includes('KEY') || key.includes('PASSWORD')
      ? `${value.substring(0, 10)}...`
      : value;
    console.log(`✅ ${key.padEnd(30)} ${displayValue}`);
  } else {
    console.log(`❌ ${key.padEnd(30)} MISSING`);
    allGood = false;
  }
}

console.log('='.repeat(60));

if (allGood) {
  console.log('\n✅ All environment variables are configured correctly!\n');
  console.log('Next step: Test invite email functionality');
  console.log('Run: node test-invite-email.js\n');
} else {
  console.log('\n❌ Some environment variables are missing!');
  console.log('Check your .env file and ensure all required variables are set.\n');
  process.exit(1);
}
