import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { uploadPDFToS3, generatePresignedPdfUrl } from './s3.js';
import { sendGHLEmailWithPDF, notifyGhlWithDownloadLink } from './ghl.js';
import { generatePDFFromComponent } from './pdf-from-component.js';
import { saveQuizResult, getQuizResultByEmail, updatePaymentStatus, updateQuizResultPDF, createPdfDownloadToken, getPdfLinkByToken } from './supabase-db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware - CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://main.d4edpf6ads6l4.amplifyapp.com',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`⚠️  CORS blocked request from origin: ${origin}`);
      callback(null, true); // Still allow for now, log for debugging
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));

// Create temp directory
const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'E-DNA Quiz Backend (Full PDF + Supabase + GHL)'
  });
});

/**
 * Download endpoint - Validates token and redirects to S3 presigned URL
 * This is the public download link sent to users via GHL email
 */
app.get('/download', async (req, res) => {
  try {
    const { token } = req.query;

    console.log('\n🔗 Download request received');
    console.log(`   Token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);

    // Validate token parameter
    if (!token) {
      console.log('❌ Error: Missing token parameter');
      return res.status(400).json({
        error: 'Missing token'
      });
    }

    // Look up token in database
    console.log('🔍 Looking up token in database...');
    const linkResult = await getPdfLinkByToken(token);

    if (!linkResult.success) {
      console.log(`❌ Error: ${linkResult.error}`);
      return res.status(404).json({
        error: 'Invalid or unknown link'
      });
    }

    const record = linkResult.record;
    console.log(`✅ Token found for: ${record.email}`);

    // Check if token has expired
    const now = new Date();
    const expiresAt = new Date(record.expires_at);

    console.log(`   Expires at: ${expiresAt.toISOString()}`);
    console.log(`   Current time: ${now.toISOString()}`);

    if (now > expiresAt) {
      console.log('❌ Error: Link has expired');
      return res.status(410).json({
        error: 'Link has expired'
      });
    }

    // Generate presigned URL for S3
    console.log('🔐 Generating presigned S3 URL...');
    const urlResult = await generatePresignedPdfUrl(record.s3_key, 7 * 60 * 60);

    if (!urlResult.success) {
      console.error('❌ Error generating presigned URL:', urlResult.error);
      return res.status(500).json({
        error: 'Could not generate download link'
      });
    }

    console.log('✅ Presigned URL generated, redirecting user...\n');

    // Redirect to S3 presigned URL
    return res.redirect(urlResult.url);

    // Alternative: Return JSON (uncomment if needed)
    // return res.json({
    //   success: true,
    //   downloadUrl: urlResult.url,
    //   email: record.email
    // });

  } catch (error) {
    console.error('❌ Error in /download endpoint:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Generate FULL PDF and upload to S3
 * This is called after email verification
 * Generates complete EDNAResultsPage, not just summary
 */
app.post('/api/quiz/generate-pdf', async (req, res) => {
  try {
    const { email, name, results } = req.body;
    
    if (!email || !results) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email and results are required'
      });
    }
    
    const resultId = uuidv4();
    console.log(`\n📝 Generating FULL PDF for ${email}...`);
    
    // Step 1: Generate FULL PDF (complete EDNAResultsPage)
    console.log('1️⃣ Generating complete E-DNA Results PDF from React component...');
    const pdfFileName = `edna-results-${resultId}.pdf`;
    const pdfPath = path.join(tempDir, pdfFileName);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);
    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }
    
    // Step 2: Upload to S3
    console.log('2️⃣ Uploading PDF to S3...');
    const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);
    if (!s3Result.success) {
      throw new Error(`S3 upload failed: ${s3Result.error}`);
    }
    
    // Step 3: Save to Supabase
    console.log('3️⃣ Saving to Supabase...');
    const dbResult = await saveQuizResult(email, results, s3Result.url);
    if (!dbResult.success) {
      console.warn('⚠️ Supabase save failed (continuing anyway):', dbResult.error);
    }

    // Step 4: Create download token
    console.log('4️⃣ Creating download token...');
    const tokenResult = await createPdfDownloadToken({
      email: email,
      s3Key: s3Result.key,
      expiresInHours: 7
    });

    if (!tokenResult.success) {
      console.warn('⚠️ Token creation failed:', tokenResult.error);
    }

    // Step 5: Notify GHL with download link
    let ghlNotificationStatus = 'not_sent';
    if (tokenResult.success) {
      console.log('5️⃣ Notifying GHL with download link...');
      const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
      const publicDownloadUrl = `${publicBaseUrl}/download?token=${tokenResult.token}`;

      const ghlResult = await notifyGhlWithDownloadLink({
        email: email,
        name: name,
        downloadLink: publicDownloadUrl
      });

      if (ghlResult.success) {
        console.log('✅ GHL webhook notified successfully');
        ghlNotificationStatus = 'sent';
      } else {
        console.warn('⚠️ GHL webhook notification failed (continuing anyway):', ghlResult.error);
        ghlNotificationStatus = 'failed';
      }
    }

    // Step 6: Cleanup temp file
    console.log('6️⃣ Cleaning up temp file...');
    setTimeout(() => {
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
        console.log('🗑️ Temp file deleted');
      }
    }, 5000);

    console.log('✅ Full PDF generated, uploaded, and saved!\n');

    res.json({
      success: true,
      resultId,
      pdfUrl: s3Result.url,
      message: 'Full PDF generated and uploaded to S3',
      savedToDatabase: dbResult.success,
      tokenCreated: tokenResult.success,
      ghlNotification: ghlNotificationStatus
    });
    
  } catch (error) {
    console.error('❌ Error in /api/quiz/generate-pdf:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * NEW FAST ENDPOINT: Save results and trigger async PDF generation
 * This allows the user to see results immediately while PDF generates in background
 */
app.post('/api/quiz/save-results', async (req, res) => {
  try {
    const { email, name, results } = req.body;

    if (!email || !results) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email and results are required'
      });
    }

    const resultId = uuidv4();

    console.log(`\n📝 Saving quiz results for ${email} (fast mode)...`);

    // Save to Supabase immediately (fast) - with null PDF URL initially
    const dbResult = await saveQuizResult(email, results, null);

    if (!dbResult.success) {
      throw new Error(`Failed to save to Supabase: ${dbResult.error}`);
    }

    // Get the actual result ID from Supabase
    const savedResultId = dbResult.data?.id || resultId;

    console.log(`✅ Quiz results saved to Supabase: ${savedResultId}`);

    // Respond immediately (don't wait for PDF)
    res.json({
      success: true,
      resultId: savedResultId,
      message: 'Results saved. PDF generation started in background.'
    });

    // Generate PDF in background (async, don't await)
    generatePDFInBackground(email, name, results, savedResultId).catch(error => {
      console.error(`❌ Background PDF generation failed for ${email}:`, error);
    });

  } catch (error) {
    console.error('❌ Error in /api/quiz/save-results:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Background PDF generation function
 * Runs asynchronously without blocking the response
 */
async function generatePDFInBackground(email, name, results, resultId) {
  try {
    console.log(`\n🎨 Starting background PDF generation for ${email}...`);

    // Generate PDF from React component
    console.log('1️⃣ Generating PDF from React component...');
    const pdfFileName = `edna-results-${resultId}.pdf`;
    const pdfPath = path.join(tempDir, pdfFileName);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);

    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }

    console.log(`✅ PDF generated: ${pdfPath}`);

    // Upload to S3
    console.log('2️⃣ Uploading PDF to S3...');
    const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);

    if (!s3Result.success) {
      throw new Error(`S3 upload failed: ${s3Result.error}`);
    }

    console.log(`✅ PDF uploaded to S3: ${s3Result.url}`);

    // Update Supabase with PDF URL
    console.log('3️⃣ Updating Supabase with PDF URL...');
    const updateResult = await updateQuizResultPDF(resultId, s3Result.url);

    if (!updateResult.success) {
      throw new Error(`Failed to update PDF URL: ${updateResult.error}`);
    }

    // Create download token
    console.log('4️⃣ Creating download token...');
    const tokenResult = await createPdfDownloadToken({
      email: email,
      s3Key: s3Result.key,
      expiresInHours: 7
    });

    if (!tokenResult.success) {
      console.warn('⚠️ Token creation failed:', tokenResult.error);
    }

    // Notify GHL with download link
    if (tokenResult.success) {
      console.log('5️⃣ Notifying GHL with download link...');
      const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
      const publicDownloadUrl = `${publicBaseUrl}/download?token=${tokenResult.token}`;

      const ghlResult = await notifyGhlWithDownloadLink({
        email: email,
        name: name,
        downloadLink: publicDownloadUrl
      });

      if (ghlResult.success) {
        console.log('✅ GHL webhook notified successfully');
      } else {
        console.warn('⚠️ GHL webhook notification failed:', ghlResult.error);
      }
    }

    console.log(`✅ Background PDF generation complete for ${email}`);

    // Clean up temp file after 5 seconds
    setTimeout(() => {
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
        console.log('🗑️ Temp PDF file deleted');
      }
    }, 5000);

  } catch (error) {
    console.error(`❌ Background PDF generation error for ${email}:`, error);
    // Don't throw - this is background process
  }
}

/**
 * GHL Webhook: Get PDF URL by email
 * This is called by GHL after payment is completed
 * Returns the S3 PDF URL for the user's quiz results
 */
app.post('/api/ghl/get-pdf', async (req, res) => {
  try {
    const { email } = req.body;

    console.log('\n🔔 GHL Webhook Called!');
    console.log(`📧 Email: ${email}`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);

    if (!email) {
      console.log('❌ Error: No email provided');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: email'
      });
    }

    console.log(`🔍 Looking up quiz result for ${email}...`);

    // Get quiz result from Supabase
    const result = await getQuizResultByEmail(email);

    if (!result.success) {
      console.log(`❌ Not found: No quiz results for ${email}`);
      return res.status(404).json({
        success: false,
        error: 'No quiz results found for this email'
      });
    }

    console.log(`✅ Found quiz result!`);
    console.log(`📄 PDF URL: ${result.data.pdf_url}`);
    console.log(`🧬 Core Type: ${result.data.core_type}`);
    console.log(`🎯 Subtype: ${result.data.subtype}`);

    // Update payment status
    await updatePaymentStatus(email, 'completed');
    console.log(`💰 Payment status updated to: completed`);

    const response = {
      success: true,
      email: email,
      pdfUrl: result.data.pdf_url,
      core_type: result.data.core_type,
      subtype: result.data.subtype,
      created_at: result.data.created_at
    };

    console.log('📤 Sending response to GHL\n');
    res.json(response);

  } catch (error) {
    console.error('❌ Error in /api/ghl/get-pdf:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Send email with PDF link via GHL
 * This can be called manually or by GHL automation
 */
app.post('/api/quiz/send-email', async (req, res) => {
  try {
    const { email, pdfUrl } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: email'
      });
    }
    
    console.log(`\n📧 Sending email to ${email}...`);
    
    // If no PDF URL provided, get it from database
    let finalPdfUrl = pdfUrl;
    if (!finalPdfUrl) {
      const result = await getQuizResultByEmail(email);
      if (result.success) {
        finalPdfUrl = result.data.pdf_url;
      } else {
        return res.status(404).json({
          success: false,
          error: 'No PDF found for this email'
        });
      }
    }
    
    // Send email via GHL
    const emailResult = await sendGHLEmailWithPDF(email, finalPdfUrl);
    
    if (!emailResult.success) {
      throw new Error(`Email sending failed: ${emailResult.error}`);
    }
    
    console.log('✅ Email sent successfully!\n');
    
    res.json({
      success: true,
      message: 'Email sent with PDF link',
      email: email
    });
    
  } catch (error) {
    console.error('❌ Error in /api/quiz/send-email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Complete flow: Generate PDF, upload to S3, save to DB
 * This is the main endpoint called after email verification
 */
app.post('/api/quiz/complete', async (req, res) => {
  try {
    const { email, name, results } = req.body;
    
    if (!email || !results) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Generate and upload PDF
    const pdfResponse = await fetch(`http://0.0.0.0:${PORT}/api/quiz/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, results })
    });
    
    const pdfResult = await pdfResponse.json();
    
    if (!pdfResult.success) {
      throw new Error(pdfResult.error);
    }
    
    res.json({
      success: true,
      resultId: pdfResult.resultId,
      pdfUrl: pdfResult.pdfUrl,
      message: 'Quiz completed successfully'
    });
    
  } catch (error) {
    console.error('❌ Error in /api/quiz/complete:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ E-DNA Backend running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/health\n`);
  console.log(`📄 Endpoints:`);
  console.log(`  GET  /download                - Time-limited PDF download (via token)`);
  console.log(`  POST /api/quiz/generate-pdf   - Generate full PDF and upload to S3`);
  console.log(`  POST /api/quiz/save-results   - Save results and generate PDF in background`);
  console.log(`  POST /api/ghl/get-pdf         - GHL webhook: Get PDF URL by email`);
  console.log(`  POST /api/quiz/send-email     - Send email with PDF link`);
  console.log(`  POST /api/quiz/complete       - Complete flow (PDF + Save)`);
  console.log(`\n📧 Email: GoHighLevel (via inbound webhook)`);
  console.log(`📄 PDF: Full EDNAResultsPage`);
  console.log(`💾 Storage: AWS S3 + Supabase`);
  console.log(`🔗 Download: Time-limited tokens (7 hours)\n`);
});

export default app;

