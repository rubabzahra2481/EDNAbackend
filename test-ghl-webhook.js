import fetch from 'node-fetch';

/**
 * Test script to simulate GHL calling our webhook
 * This helps verify the integration works before GHL configures it
 */

const BACKEND_URL = 'http://localhost:3001';
const TEST_EMAIL = 'support@brandscaling.co.uk'; // Use an email that has completed the quiz

async function testWebhook() {
  console.log('🧪 Testing GHL Webhook Integration\n');

  console.log('📍 Step 1: Testing /api/ghl/get-pdf endpoint');
  console.log(`📧 Using test email: ${TEST_EMAIL}\n`);

  try {
    const response = await fetch(`${BACKEND_URL}/api/ghl/get-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_EMAIL
      })
    });

    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log('📦 Response Body:');
    console.log(JSON.stringify(data, null, 2));

    if (data.success && data.pdfUrl) {
      console.log('\n✅ SUCCESS! Webhook is working correctly');
      console.log(`\n📄 PDF URL: ${data.pdfUrl}`);
      console.log(`\n💡 This is the URL that will be sent to GHL`);
      console.log(`💡 GHL will use this in the email template as: {{webhook.response.pdfUrl}}`);

      // Test if PDF URL is accessible
      console.log('\n📍 Step 2: Testing if PDF URL is accessible');
      const pdfResponse = await fetch(data.pdfUrl);
      console.log(`📊 PDF Response Status: ${pdfResponse.status} ${pdfResponse.statusText}`);

      if (pdfResponse.status === 200) {
        console.log('✅ PDF is accessible and can be downloaded');
        console.log(`📊 PDF Size: ${pdfResponse.headers.get('content-length')} bytes`);
        console.log(`📊 Content Type: ${pdfResponse.headers.get('content-type')}`);
      } else {
        console.log('⚠️ PDF URL returned error. It may have expired (7-day limit)');
        console.log('💡 Generate a new PDF by completing the quiz again');
      }

    } else {
      console.log('\n❌ FAILED! Webhook returned error');
      console.log('🔍 Check if:');
      console.log('  - Backend is running (npm start)');
      console.log('  - Supabase is configured correctly');
      console.log('  - Test email exists in quiz_results table');
      console.log(`  - Try changing TEST_EMAIL to an email that completed the quiz`);
    }

  } catch (error) {
    console.log('\n❌ ERROR! Failed to call webhook');
    console.log(`🔍 Error: ${error.message}`);
    console.log('🔍 Check if backend is running on port 3001');
    console.log(`💡 Run: cd backend && npm start`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📝 GHL Integration Details');
  console.log('='.repeat(60));
  console.log(`\nWebhook URL (local): ${BACKEND_URL}/api/ghl/get-pdf`);
  console.log(`Webhook URL (production): https://your-domain.com/api/ghl/get-pdf`);
  console.log(`\nRequest Format:`);
  console.log(JSON.stringify({ email: 'customer@example.com' }, null, 2));
  console.log(`\nResponse Format:`);
  console.log(JSON.stringify({
    success: true,
    email: 'customer@example.com',
    pdfUrl: 'https://brandscaling-edna-pdf.s3.amazonaws.com/...',
    core_type: 'architect',
    subtype: 'Systemized Builder'
  }, null, 2));
  console.log(`\nGHL Email Template Variable: {{webhook.response.pdfUrl}}`);
  console.log('='.repeat(60) + '\n');
}

// Run the test
testWebhook();
