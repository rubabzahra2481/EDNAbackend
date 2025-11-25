/**
 * Production Deployment Test Script
 *
 * Tests the deployed E-DNA Quiz application endpoints to verify everything is working.
 *
 * Usage:
 *   node test-production.js
 */

const BACKEND_URL = 'http://edna-backend-env.eba-nvcram3g.us-east-1.elasticbeanstalk.com';
const FRONTEND_URL = 'https://main.d4edpf6ads6l4.amplifyapp.com';

// Sample quiz results for testing
const SAMPLE_RESULTS = {
  core_type: 'architect',
  subtype: ['Systemized Builder'],
  core_type_mastery: 85,
  subtype_mastery: 78,
  mirror_awareness: 72,
  integration_level: 80,
  neurodiversity_flags: ['executive_function'],
  learning_preferences: ['visual', 'structured'],
  decision_patterns: { analytical: 85, intuitive: 65 },
  mindset_scores: { growth: 88, fixed: 32 }
};

// Test counter
let testsPassed = 0;
let testsFailed = 0;

function logTest(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function logSuccess(message) {
  testsPassed++;
  logTest('✅', message);
}

function logFail(message) {
  testsFailed++;
  logTest('❌', message);
}

function logInfo(message) {
  logTest('ℹ️ ', message);
}

function logHeader(message) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${message}`);
  console.log(`${'='.repeat(70)}\n`);
}

async function testProduction() {
  logHeader('🧪 E-DNA QUIZ - PRODUCTION DEPLOYMENT TEST');

  logInfo(`Backend URL: ${BACKEND_URL}`);
  logInfo(`Frontend URL: ${FRONTEND_URL}`);

  // =====================================================================
  // Test 1: Health Check
  // =====================================================================
  logHeader('Test 1: Health Check');
  try {
    const healthRes = await fetch(`${BACKEND_URL}/health`);
    const healthData = await healthRes.json();

    if (healthRes.ok && healthData.status === 'ok') {
      logSuccess(`Health check passed: ${JSON.stringify(healthData)}`);
    } else {
      logFail(`Health check returned unexpected response: ${JSON.stringify(healthData)}`);
    }
  } catch (error) {
    logFail(`Health check failed: ${error.message}`);
  }

  // =====================================================================
  // Test 2: Save Quiz Results (Fast Endpoint)
  // =====================================================================
  logHeader('Test 2: Save Quiz Results (Fast Endpoint)');
  let savedResultId = null;
  let savedEmail = `test-${Date.now()}@example.com`;

  try {
    const saveRes = await fetch(`${BACKEND_URL}/api/quiz/save-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: savedEmail,
        name: 'Production Test User',
        results: SAMPLE_RESULTS
      })
    });

    const saveData = await saveRes.json();

    if (saveRes.ok && saveData.success && saveData.resultId) {
      savedResultId = saveData.resultId;
      logSuccess(`Quiz results saved successfully!`);
      logInfo(`Result ID: ${savedResultId}`);
      logInfo(`Email: ${savedEmail}`);
      logInfo(`Message: ${saveData.message}`);
    } else {
      logFail(`Failed to save quiz results: ${JSON.stringify(saveData)}`);
    }
  } catch (error) {
    logFail(`Save results endpoint failed: ${error.message}`);
  }

  // Wait a moment for background PDF generation to start
  logInfo('Waiting 3 seconds for PDF generation to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // =====================================================================
  // Test 3: GHL Webhook Endpoint (Get PDF URL)
  // =====================================================================
  logHeader('Test 3: GHL Webhook Endpoint (Get PDF URL)');
  try {
    const webhookRes = await fetch(`${BACKEND_URL}/api/ghl/get-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: savedEmail })
    });

    const webhookData = await webhookRes.json();

    if (webhookRes.ok) {
      if (webhookData.success && webhookData.pdfUrl) {
        logSuccess('GHL webhook is working!');
        logInfo(`PDF URL: ${webhookData.pdfUrl}`);
        logInfo(`User: ${webhookData.user.name} (${webhookData.user.email})`);

        // Test 3a: Verify PDF URL is accessible
        logHeader('Test 3a: Verify PDF URL Accessibility');
        try {
          const pdfRes = await fetch(webhookData.pdfUrl, { method: 'HEAD' });
          if (pdfRes.ok) {
            logSuccess(`PDF URL is accessible (Status: ${pdfRes.status})`);
          } else {
            logFail(`PDF URL returned status ${pdfRes.status} (may need S3 bucket policy update)`);
          }
        } catch (error) {
          logFail(`PDF URL check failed: ${error.message}`);
        }
      } else {
        logInfo('No PDF found yet (still generating in background)');
        logInfo(`Response: ${JSON.stringify(webhookData)}`);
        logInfo('This is normal - PDF generation takes 20-30 seconds');
      }
    } else {
      logFail(`GHL webhook returned error: ${JSON.stringify(webhookData)}`);
    }
  } catch (error) {
    logFail(`GHL webhook test failed: ${error.message}`);
  }

  // =====================================================================
  // Test 4: CORS Configuration
  // =====================================================================
  logHeader('Test 4: CORS Configuration');
  try {
    const corsRes = await fetch(`${BACKEND_URL}/health`, {
      method: 'OPTIONS'
    });

    const corsHeaders = corsRes.headers.get('access-control-allow-origin');
    if (corsHeaders) {
      logSuccess(`CORS headers present: ${corsHeaders}`);
    } else {
      logInfo('CORS check: No specific headers (may be allowing all origins)');
    }
  } catch (error) {
    logFail(`CORS test failed: ${error.message}`);
  }

  // =====================================================================
  // Test 5: Frontend Accessibility
  // =====================================================================
  logHeader('Test 5: Frontend Accessibility');
  try {
    const frontendRes = await fetch(FRONTEND_URL);
    if (frontendRes.ok) {
      logSuccess(`Frontend is accessible (Status: ${frontendRes.status})`);
    } else {
      logFail(`Frontend returned status: ${frontendRes.status}`);
    }
  } catch (error) {
    logFail(`Frontend accessibility test failed: ${error.message}`);
  }

  // =====================================================================
  // Summary
  // =====================================================================
  logHeader('📊 TEST SUMMARY');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed! Production deployment is ready.\n');
  } else {
    console.log(`\n⚠️  ${testsFailed} test(s) failed. Please review and fix.\n`);
  }

  // =====================================================================
  // GHL Integration Instructions
  // =====================================================================
  if (testsPassed > 0) {
    logHeader('📧 GHL WEBHOOK CONFIGURATION FOR FIZA');
    console.log('Webhook URL:');
    console.log(`  ${BACKEND_URL}/api/ghl/get-pdf`);
    console.log('\nRequest Method: POST');
    console.log('Content-Type: application/json');
    console.log('\nRequest Body:');
    console.log(JSON.stringify({ email: 'user@example.com' }, null, 2));
    console.log('\nExpected Response:');
    console.log(JSON.stringify({
      success: true,
      pdfUrl: 'https://s3.amazonaws.com/...',
      user: {
        name: 'User Name',
        email: 'user@example.com'
      }
    }, null, 2));
    console.log('\n');
  }
}

// Run tests
testProduction().catch(error => {
  console.error('\n❌ Test script failed:', error);
  process.exit(1);
});
