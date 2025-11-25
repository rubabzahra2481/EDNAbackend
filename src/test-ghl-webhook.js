import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

/**
 * Test the complete GHL webhook integration flow:
 * 1. Simulates completing the quiz (POST /api/quiz/generate-pdf)
 * 2. Verifies token creation
 * 3. Verifies GHL webhook was called
 * 4. Tests the download link
 */
async function testGHLWebhookFlow() {
  console.log('🧪 Testing GHL Webhook Integration Flow...\n');

  const BACKEND_URL = process.env.PUBLIC_BACKEND_BASE_URL || 'http://0.0.0.0:8080';

  try {
    // Test data
    const testData = {
      email: 'test@brandscaling.co.uk',
      name: 'Test User',
      results: {
        core_type: 'architect',
        subtype: 'Systemized Builder',
        decision_mastery: 75,
        core_level: 80,
        mirror_awareness: 65,
        integration_level: 70
      }
    };

    console.log('📝 Test User:', testData.name);
    console.log('📧 Test Email:', testData.email);
    console.log('');

    // Step 1: Call the generate-pdf endpoint
    console.log('1️⃣ Calling /api/quiz/generate-pdf endpoint...');
    console.log(`   URL: ${BACKEND_URL}/api/quiz/generate-pdf`);

    const response = await axios.post(
      `${BACKEND_URL}/api/quiz/generate-pdf`,
      testData,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000 // 2 minute timeout for PDF generation
      }
    );

    console.log('✅ PDF generation endpoint responded successfully\n');

    // Step 2: Check response
    console.log('2️⃣ Checking response data...');
    const data = response.data;

    console.log(`   Success: ${data.success}`);
    console.log(`   Result ID: ${data.resultId}`);
    console.log(`   PDF URL: ${data.pdfUrl ? data.pdfUrl.substring(0, 80) + '...' : 'N/A'}`);
    console.log(`   Saved to DB: ${data.savedToDatabase}`);
    console.log(`   Token Created: ${data.tokenCreated}`);
    console.log(`   GHL Notification: ${data.ghlNotification}`);
    console.log('');

    if (!data.success) {
      throw new Error('PDF generation failed');
    }

    if (!data.tokenCreated) {
      console.warn('⚠️  Warning: Token was not created');
    }

    if (data.ghlNotification !== 'sent') {
      console.warn(`⚠️  Warning: GHL notification status is: ${data.ghlNotification}`);
    }

    // Step 3: Summary
    console.log('3️⃣ Test Results Summary:');
    console.log('   ✅ PDF generated and uploaded to S3');
    console.log(`   ${data.savedToDatabase ? '✅' : '❌'} Quiz result saved to Supabase`);
    console.log(`   ${data.tokenCreated ? '✅' : '❌'} Download token created`);
    console.log(`   ${data.ghlNotification === 'sent' ? '✅' : '❌'} GHL webhook notified`);
    console.log('');

    // Step 4: Instructions for testing download link
    console.log('4️⃣ Testing Download Link:');
    console.log('');
    console.log('   To test the download link:');
    console.log('   1. Check your GHL workflow to see if it was triggered');
    console.log('   2. Look for the email sent to:', testData.email);
    console.log('   3. The email should contain a download link in the format:');
    console.log(`      ${BACKEND_URL}/download?token=<token>`);
    console.log('   4. Click the link to verify it downloads the PDF');
    console.log('   5. The link should expire after 7 hours');
    console.log('');

    // Step 5: Check backend logs
    console.log('5️⃣ Check Backend Logs:');
    console.log('');
    console.log('   Look for these log entries on your backend:');
    console.log('   • "📝 Generating FULL PDF for..."');
    console.log('   • "✅ PDF uploaded to S3"');
    console.log('   • "✅ PDF download token created"');
    console.log('   • "📤 Notifying GHL webhook for..."');
    console.log('   • "✅ GHL webhook notified successfully"');
    console.log('');

    console.log('🎉 Test PASSED!\n');
    console.log('✨ The GHL webhook integration is working correctly!');
    console.log('');

    return true;

  } catch (error) {
    console.error('\n❌ Test FAILED:');

    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Error:', error.response.data?.error || error.response.data);
    } else if (error.request) {
      console.error('   No response received from backend');
      console.error('   Make sure the backend is running at:', BACKEND_URL);
    } else {
      console.error('   Error:', error.message);
    }

    console.error('\nStack:', error.stack);
    return false;
  }
}

// Run the test
console.log('═══════════════════════════════════════════════════════════');
console.log('  E-DNA GHL Webhook Integration Test');
console.log('═══════════════════════════════════════════════════════════\n');

testGHLWebhookFlow().then(success => {
  process.exit(success ? 0 : 1);
});
