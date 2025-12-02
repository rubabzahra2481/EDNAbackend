import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { uploadPDFToS3, generatePresignedPdfUrl } from './s3.js';
import { sendGHLEmailWithPDF, notifyGhlWithDownloadLink } from './ghl.js';
import { generatePDFFromComponent } from './pdf-from-component.js';
import { sendInviteEmail } from './invite-email-supabase.js';
import { createUserAndSendResetEmail, sendResetPasswordEmail } from './create-user-with-reset.js';
import { createAgentTokenFromSupabase, verifyAgentTokenMiddleware } from './agent-token.js';
// Aurora PostgreSQL Database (replacing Supabase for quiz data)
import {
  initializeDatabase,
  saveQuizResult,
  getQuizResultById,
  getQuizResultByEmail,
  createDownloadToken,
  verifyDownloadToken,
  testConnection,
  closePool,
  saveQuizProgress,
  getQuizProgress,
  deleteQuizProgress
} from './postgres-db.js';
// Keep Supabase imports for authentication (if needed in future)
// import { supabase } from './supabase-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware - CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://main.d4edpf6ads6l4.amplifyapp.com',
  'https://brandscaling.co.uk',
  'https://www.brandscaling.co.uk',
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
    service: 'E-DNA Quiz Backend (Full PDF + Aurora PostgreSQL + GHL)'
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
    const linkResult = await verifyDownloadToken(token);

    if (!linkResult.success) {
      console.log(`❌ Error: ${linkResult.error}`);
      return res.status(404).json({
        error: 'Invalid or unknown link'
      });
    }

    const record = linkResult.data;
    console.log(`✅ Token found for: ${record.email}`);

    // Token expiration is already checked in verifyDownloadToken
    // No need to check again here

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

    // Use local development URL if NODE_ENV is not production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const frontendUrl = isDevelopment 
      ? 'http://localhost:3000' 
      : (process.env.FRONTEND_URL || 'https://brandscaling.co.uk');
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
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const tokenResult = await createDownloadToken(token, resultId, expiresAt);

    if (!tokenResult.success) {
      console.warn('⚠️ Token creation failed:', tokenResult.error);
    }

    // Step 5: Notify GHL with download link
    let ghlNotificationStatus = 'not_sent';
    if (tokenResult.success) {
      console.log('5️⃣ Notifying GHL with download link...');
      const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
      const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

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
    console.log(`📦 Results data:`, {
      email,
      name,
      core_type: results.core_type,
      subtype: results.subtype
    });

    // Save to Aurora MySQL immediately (fast) - with null PDF URL initially
    const dbResult = await saveQuizResult(resultId, email, name, results, null, null);

    if (!dbResult.success) {
      throw new Error(`Failed to save to Aurora MySQL: ${dbResult.error}`);
    }

    console.log(`✅ Quiz results saved to Aurora MySQL: ${resultId}`);

    // Respond immediately (don't wait for PDF)
    res.json({
      success: true,
      resultId: resultId,
      message: 'Results saved. PDF generation started in background.'
    });

    // Generate PDF in background (async, don't await)
    generatePDFInBackground(email, name, results, resultId).catch(error => {
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
 * GET /api/quiz/results-by-email
 * Retrieve quiz results by email (for dashboard)
 */
app.get('/api/quiz/results-by-email', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: email'
      });
    }

    // Normalize email to lowercase for consistent database queries
    const normalizedEmail = email.toLowerCase().trim();
    
    console.log(`\n🔍 Fetching quiz results for email: "${email}" (normalized: "${normalizedEmail}")...`);

    const dbResult = await getQuizResultByEmail(normalizedEmail);

    if (!dbResult.success) {
      return res.status(404).json({
        success: false,
        error: 'No quiz results found for this email'
      });
    }

    // Parse the results JSON from database
    const quizData = dbResult.data;
    const results = typeof quizData.quiz_data === 'string' 
      ? JSON.parse(quizData.quiz_data) 
      : quizData.quiz_data;

    console.log(`✅ Quiz results found for ${email}`);

    res.json({
      success: true,
      results: results,
      resultId: quizData.id,
      createdAt: quizData.created_at
    });

  } catch (error) {
    console.error('❌ Error in /api/quiz/results-by-email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Save quiz progress for authenticated user
 */
app.post('/api/quiz/save-progress', async (req, res) => {
  try {
    const { email, progressData } = req.body;
    
    if (!email || !progressData) {
      return res.status(400).json({
        success: false,
        error: 'Email and progress data are required'
      });
    }
    
    await saveQuizProgress(email, progressData);
    
    res.json({
      success: true,
      message: 'Quiz progress saved successfully'
    });
  } catch (error) {
    console.error('❌ Error saving quiz progress:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get quiz progress for authenticated user
 */
app.get('/api/quiz/get-progress', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }
    
    const progress = await getQuizProgress(email);
    
    if (!progress) {
      return res.json({
        success: false,
        message: 'No saved progress found'
      });
    }
    
    res.json({
      success: true,
      progressData: progress.progressData,
      updatedAt: progress.updatedAt
    });
  } catch (error) {
    console.error('❌ Error getting quiz progress:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Delete quiz progress after completion
 */
app.delete('/api/quiz/delete-progress', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }
    
    await deleteQuizProgress(email);
    
    res.json({
      success: true,
      message: 'Quiz progress deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting quiz progress:', error);
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

    // Use local development URL if NODE_ENV is not production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const frontendUrl = isDevelopment 
      ? 'http://localhost:3000' 
      : (process.env.FRONTEND_URL || 'https://brandscaling.co.uk');
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

    // PDF URL and S3 key already saved in saveQuizResult above
    console.log('3️⃣ PDF URL and S3 key saved in Aurora PostgreSQL ✅');

    // Create download token (7 days expiration)
    console.log('4️⃣ Creating download token (7 days expiration)...');
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const tokenResult = await createDownloadToken(token, resultId, expiresAt);

    if (!tokenResult.success) {
      console.warn('⚠️ Token creation failed:', tokenResult.error);
    }

    // Notify GHL with download link and E-DNA details
    if (tokenResult.success) {
      console.log('5️⃣ Notifying GHL with download link...');
      const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
      const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

      const ghlResult = await notifyGhlWithDownloadLink({
        email: email,
        name: name,
        downloadLink: publicDownloadUrl,
        ednaType: results.subtype || 'Unknown',
        coreType: results.core_type || 'Unknown'
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

    // Get quiz result from Aurora MySQL
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

    // Payment tracking not implemented in current version

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

/**
 * Send Invite Email via Supabase
 * This endpoint is called when users request OTP for E-DNA quiz verification
 * Sends an invite email with signup link alongside the OTP email
 */
app.post('/api/send-invite-email', async (req, res) => {
  try {
    const { email } = req.body;

    console.log('\n📨 Invite email request received');
    console.log(`   Email: ${email}`);

    if (!email) {
      console.log('❌ Error: Email is required');
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Send invite email via Supabase
    const result = await sendInviteEmail(email);

    if (result.success) {
      console.log('✅ Invite email sent successfully\n');
      return res.json({
        success: true,
        message: 'Invite email sent'
      });
    } else {
      console.error('❌ Failed to send invite email:', result.error);
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Error in /api/send-invite-email:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Create User and Send Reset Password Email
 * This endpoint is called after quiz OTP verification
 * Creates a Supabase account without password and sends reset password email
 */
app.post('/api/create-user-with-reset', async (req, res) => {
  try {
    const { email, firstName, lastName, metadata } = req.body;

    console.log('\n📝 Create user with reset password request received');
    console.log(`   Email: ${email}`);

    if (!email) {
      console.log('❌ Error: Email is required');
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Create user and send reset password email
    const result = await createUserAndSendResetEmail(email, firstName, lastName, metadata);

    if (result.success) {
      console.log('✅ User created and reset password email sent\n');
      return res.json({
        success: true,
        message: result.message,
        user: result.user
      });
    } else {
      console.error('❌ Failed to create user:', result.message);
      return res.status(500).json({
        success: false,
        error: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in /api/create-user-with-reset:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});


// import dotenv from 'dotenv';
// dotenv.config();

// import express from 'express';
// import cors from 'cors';
// import { v4 as uuidv4 } from 'uuid';
// import fs from 'fs';
// import path from 'path';
// import { fileURLToPath } from 'url';

// import { uploadPDFToS3, generatePresignedPdfUrl } from './s3.js';
// import { sendGHLEmailWithPDF, notifyGhlWithDownloadLink } from './ghl.js';
// import { generatePDFFromComponent } from './pdf-from-component.js';
// import { sendInviteEmail } from './invite-email-supabase.js';
// import { createUserAndSendResetEmail, sendResetPasswordEmail } from './create-user-with-reset.js';
// import { createAgentTokenFromSupabase, verifyAgentTokenMiddleware } from './agent-token.js';
// // Aurora PostgreSQL Database (replacing Supabase for quiz data)
// import {
//   initializeDatabase,
//   saveQuizResult,
//   getQuizResultById,
//   getQuizResultByEmail,
//   createDownloadToken,
//   verifyDownloadToken,
//   testConnection,
//   closePool
// } from './postgres-db.js';
// // Keep Supabase imports for authentication (if needed in future)
// // import { supabase } from './supabase-db.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// const PORT = process.env.PORT || 8080;

// // Middleware - CORS Configuration
// const allowedOrigins = [
//   'http://localhost:3000',
//   'http://localhost:8080',
//   'https://main.d4edpf6ads6l4.amplifyapp.com',
//   process.env.FRONTEND_URL
// ].filter(Boolean); // Remove undefined values

// app.use(cors({
//   origin: (origin, callback) => {
//     // Allow requests with no origin (like mobile apps, Postman, or same-origin)
//     if (!origin) return callback(null, true);

//     if (allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       console.log(`⚠️  CORS blocked request from origin: ${origin}`);
//       callback(null, true); // Still allow for now, log for debugging
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// }));

// app.use(express.json({ limit: '50mb' }));

// // Create temp directory
// const tempDir = path.join(__dirname, '../temp');
// if (!fs.existsSync(tempDir)) {
//   fs.mkdirSync(tempDir, { recursive: true });
// }

// // Health check
// app.get('/health', (req, res) => {
//   res.json({
//     status: 'ok',
//     timestamp: new Date().toISOString(),
//     service: 'E-DNA Quiz Backend (Full PDF + Aurora PostgreSQL + GHL)'
//   });
// });

// /**
//  * Download endpoint - Validates token and redirects to S3 presigned URL
//  * This is the public download link sent to users via GHL email
//  */
// app.get('/download', async (req, res) => {
//   try {
//     const { token } = req.query;

//     console.log('\n🔗 Download request received');
//     console.log(`   Token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);

//     // Validate token parameter
//     if (!token) {
//       console.log('❌ Error: Missing token parameter');
//       return res.status(400).json({
//         error: 'Missing token'
//       });
//     }

//     // Look up token in database
//     console.log('🔍 Looking up token in database...');
//     const linkResult = await verifyDownloadToken(token);

//     if (!linkResult.success) {
//       console.log(`❌ Error: ${linkResult.error}`);
//       return res.status(404).json({
//         error: 'Invalid or unknown link'
//       });
//     }

//     const record = linkResult.data;
//     console.log(`✅ Token found for: ${record.email}`);

//     // Token expiration is already checked in verifyDownloadToken
//     // No need to check again here

//     // Generate presigned URL for S3
//     console.log('🔐 Generating presigned S3 URL...');
//     const urlResult = await generatePresignedPdfUrl(record.s3_key, 7 * 60 * 60);

//     if (!urlResult.success) {
//       console.error('❌ Error generating presigned URL:', urlResult.error);
//       return res.status(500).json({
//         error: 'Could not generate download link'
//       });
//     }

//     console.log('✅ Presigned URL generated, redirecting user...\n');

//     // Redirect to S3 presigned URL
//     return res.redirect(urlResult.url);

//     // Alternative: Return JSON (uncomment if needed)
//     // return res.json({
//     //   success: true,
//     //   downloadUrl: urlResult.url,
//     //   email: record.email
//     // });

//   } catch (error) {
//     console.error('❌ Error in /download endpoint:', error);
//     res.status(500).json({
//       error: 'Internal server error'
//     });
//   }
// });

// /**
//  * Generate FULL PDF and upload to S3
//  * This is called after email verification
//  * Generates complete EDNAResultsPage, not just summary
//  */
// app.post('/api/quiz/generate-pdf', async (req, res) => {
//   try {
//     const { email, name, results } = req.body;
    
//     if (!email || !results) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields: email and results are required'
//       });
//     }
    
//     const resultId = uuidv4();
//     console.log(`\n📝 Generating FULL PDF for ${email}...`);
    
//     // Step 1: Generate FULL PDF (complete EDNAResultsPage)
//     console.log('1️⃣ Generating complete E-DNA Results PDF from React component...');
//     const pdfFileName = `edna-results-${resultId}.pdf`;
//     const pdfPath = path.join(tempDir, pdfFileName);

//     const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
//     const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);
//     if (!pdfResult.success) {
//       throw new Error(`PDF generation failed: ${pdfResult.error}`);
//     }
    
//     // Step 2: Upload to S3
//     console.log('2️⃣ Uploading PDF to S3...');
//     const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);
//     if (!s3Result.success) {
//       throw new Error(`S3 upload failed: ${s3Result.error}`);
//     }
    
//     // Step 3: Save to Supabase
//     console.log('3️⃣ Saving to Supabase...');
//     const dbResult = await saveQuizResult(email, results, s3Result.url);
//     if (!dbResult.success) {
//       console.warn('⚠️ Supabase save failed (continuing anyway):', dbResult.error);
//     }

//     // Step 4: Create download token
//     console.log('4️⃣ Creating download token...');
//     const token = uuidv4();
//     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
//     const tokenResult = await createDownloadToken(token, resultId, expiresAt);

//     if (!tokenResult.success) {
//       console.warn('⚠️ Token creation failed:', tokenResult.error);
//     }

//     // Step 5: Notify GHL with download link
//     let ghlNotificationStatus = 'not_sent';
//     if (tokenResult.success) {
//       console.log('5️⃣ Notifying GHL with download link...');
//       const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
//       const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

//       const ghlResult = await notifyGhlWithDownloadLink({
//         email: email,
//         name: name,
//         downloadLink: publicDownloadUrl
//       });

//       if (ghlResult.success) {
//         console.log('✅ GHL webhook notified successfully');
//         ghlNotificationStatus = 'sent';
//       } else {
//         console.warn('⚠️ GHL webhook notification failed (continuing anyway):', ghlResult.error);
//         ghlNotificationStatus = 'failed';
//       }
//     }

//     // Step 6: Cleanup temp file
//     console.log('6️⃣ Cleaning up temp file...');
//     setTimeout(() => {
//       if (fs.existsSync(pdfPath)) {
//         fs.unlinkSync(pdfPath);
//         console.log('🗑️ Temp file deleted');
//       }
//     }, 5000);

//     console.log('✅ Full PDF generated, uploaded, and saved!\n');

//     res.json({
//       success: true,
//       resultId,
//       pdfUrl: s3Result.url,
//       message: 'Full PDF generated and uploaded to S3',
//       savedToDatabase: dbResult.success,
//       tokenCreated: tokenResult.success,
//       ghlNotification: ghlNotificationStatus
//     });
    
//   } catch (error) {
//     console.error('❌ Error in /api/quiz/generate-pdf:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * NEW FAST ENDPOINT: Save results and trigger async PDF generation
//  * This allows the user to see results immediately while PDF generates in background
//  */
// app.post('/api/quiz/save-results', async (req, res) => {
//   try {
//     const { email, name, results } = req.body;

//     if (!email || !results) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields: email and results are required'
//       });
//     }

//     const resultId = uuidv4();

//     console.log(`\n📝 Saving quiz results for ${email} (fast mode)...`);
//     console.log(`📦 Results data:`, {
//       email,
//       name,
//       core_type: results.core_type,
//       subtype: results.subtype
//     });

//     // Save to Aurora MySQL immediately (fast) - with null PDF URL initially
//     const dbResult = await saveQuizResult(resultId, email, name, results, null, null);

//     if (!dbResult.success) {
//       throw new Error(`Failed to save to Aurora MySQL: ${dbResult.error}`);
//     }

//     console.log(`✅ Quiz results saved to Aurora MySQL: ${resultId}`);

//     // Respond immediately (don't wait for PDF)
//     res.json({
//       success: true,
//       resultId: resultId,
//       message: 'Results saved. PDF generation started in background.'
//     });

//     // Generate PDF in background (async, don't await)
//     generatePDFInBackground(email, name, results, resultId).catch(error => {
//       console.error(`❌ Background PDF generation failed for ${email}:`, error);
//     });

//   } catch (error) {
//     console.error('❌ Error in /api/quiz/save-results:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * GET /api/quiz/results-by-email
//  * Retrieve quiz results by email (for dashboard)
//  */
// app.get('/api/quiz/results-by-email', async (req, res) => {
//   try {
//     const { email } = req.query;

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required parameter: email'
//       });
//     }

//     console.log(`\n🔍 Fetching quiz results for ${email}...`);

//     const dbResult = await getQuizResultByEmail(email);

//     if (!dbResult.success) {
//       return res.status(404).json({
//         success: false,
//         error: 'No quiz results found for this email'
//       });
//     }

//     // Parse the results JSON from database
//     const quizData = dbResult.data;
//     const results = typeof quizData.quiz_data === 'string' 
//       ? JSON.parse(quizData.quiz_data) 
//       : quizData.quiz_data;

//     console.log(`✅ Quiz results found for ${email}`);

//     res.json({
//       success: true,
//       results: results,
//       resultId: quizData.id,
//       createdAt: quizData.created_at
//     });

//   } catch (error) {
//     console.error('❌ Error in /api/quiz/results-by-email:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * Background PDF generation function
//  * Runs asynchronously without blocking the response
//  */
// async function generatePDFInBackground(email, name, results, resultId) {
//   try {
//     console.log(`\n🎨 Starting background PDF generation for ${email}...`);

//     // Generate PDF from React component
//     console.log('1️⃣ Generating PDF from React component...');
//     const pdfFileName = `edna-results-${resultId}.pdf`;
//     const pdfPath = path.join(tempDir, pdfFileName);

//     const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
//     const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);

//     if (!pdfResult.success) {
//       throw new Error(`PDF generation failed: ${pdfResult.error}`);
//     }

//     console.log(`✅ PDF generated: ${pdfPath}`);

//     // Upload to S3
//     console.log('2️⃣ Uploading PDF to S3...');
//     const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);

//     if (!s3Result.success) {
//       throw new Error(`S3 upload failed: ${s3Result.error}`);
//     }

//     console.log(`✅ PDF uploaded to S3: ${s3Result.url}`);

//     // PDF URL and S3 key already saved in saveQuizResult above
//     console.log('3️⃣ PDF URL and S3 key saved in Aurora PostgreSQL ✅');

//     // Create download token (7 days expiration)
//     console.log('4️⃣ Creating download token (7 days expiration)...');
//     const token = uuidv4();
//     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
//     const tokenResult = await createDownloadToken(token, resultId, expiresAt);

//     if (!tokenResult.success) {
//       console.warn('⚠️ Token creation failed:', tokenResult.error);
//     }

//     // Notify GHL with download link and E-DNA details
//     if (tokenResult.success) {
//       console.log('5️⃣ Notifying GHL with download link...');
//       const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
//       const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

//       const ghlResult = await notifyGhlWithDownloadLink({
//         email: email,
//         name: name,
//         downloadLink: publicDownloadUrl,
//         ednaType: results.subtype || 'Unknown',
//         coreType: results.core_type || 'Unknown'
//       });

//       if (ghlResult.success) {
//         console.log('✅ GHL webhook notified successfully');
//       } else {
//         console.warn('⚠️ GHL webhook notification failed:', ghlResult.error);
//       }
//     }

//     console.log(`✅ Background PDF generation complete for ${email}`);

//     // Clean up temp file after 5 seconds
//     setTimeout(() => {
//       if (fs.existsSync(pdfPath)) {
//         fs.unlinkSync(pdfPath);
//         console.log('🗑️ Temp PDF file deleted');
//       }
//     }, 5000);

//   } catch (error) {
//     console.error(`❌ Background PDF generation error for ${email}:`, error);
//     // Don't throw - this is background process
//   }
// }

// /**
//  * GHL Webhook: Get PDF URL by email
//  * This is called by GHL after payment is completed
//  * Returns the S3 PDF URL for the user's quiz results
//  */
// app.post('/api/ghl/get-pdf', async (req, res) => {
//   try {
//     const { email } = req.body;

//     console.log('\n🔔 GHL Webhook Called!');
//     console.log(`📧 Email: ${email}`);
//     console.log(`⏰ Time: ${new Date().toISOString()}`);

//     if (!email) {
//       console.log('❌ Error: No email provided');
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required field: email'
//       });
//     }

//     console.log(`🔍 Looking up quiz result for ${email}...`);

//     // Get quiz result from Aurora MySQL
//     const result = await getQuizResultByEmail(email);

//     if (!result.success) {
//       console.log(`❌ Not found: No quiz results for ${email}`);
//       return res.status(404).json({
//         success: false,
//         error: 'No quiz results found for this email'
//       });
//     }

//     console.log(`✅ Found quiz result!`);
//     console.log(`📄 PDF URL: ${result.data.pdf_url}`);
//     console.log(`🧬 Core Type: ${result.data.core_type}`);
//     console.log(`🎯 Subtype: ${result.data.subtype}`);

//     // Payment tracking not implemented in current version

//     const response = {
//       success: true,
//       email: email,
//       pdfUrl: result.data.pdf_url,
//       core_type: result.data.core_type,
//       subtype: result.data.subtype,
//       created_at: result.data.created_at
//     };

//     console.log('📤 Sending response to GHL\n');
//     res.json(response);

//   } catch (error) {
//     console.error('❌ Error in /api/ghl/get-pdf:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * Send email with PDF link via GHL
//  * This can be called manually or by GHL automation
//  */
// app.post('/api/quiz/send-email', async (req, res) => {
//   try {
//     const { email, pdfUrl } = req.body;
    
//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required field: email'
//       });
//     }
    
//     console.log(`\n📧 Sending email to ${email}...`);
    
//     // If no PDF URL provided, get it from database
//     let finalPdfUrl = pdfUrl;
//     if (!finalPdfUrl) {
//       const result = await getQuizResultByEmail(email);
//       if (result.success) {
//         finalPdfUrl = result.data.pdf_url;
//       } else {
//         return res.status(404).json({
//           success: false,
//           error: 'No PDF found for this email'
//         });
//       }
//     }
    
//     // Send email via GHL
//     const emailResult = await sendGHLEmailWithPDF(email, finalPdfUrl);
    
//     if (!emailResult.success) {
//       throw new Error(`Email sending failed: ${emailResult.error}`);
//     }
    
//     console.log('✅ Email sent successfully!\n');
    
//     res.json({
//       success: true,
//       message: 'Email sent with PDF link',
//       email: email
//     });
    
//   } catch (error) {
//     console.error('❌ Error in /api/quiz/send-email:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * Complete flow: Generate PDF, upload to S3, save to DB
//  * This is the main endpoint called after email verification
//  */
// app.post('/api/quiz/complete', async (req, res) => {
//   try {
//     const { email, name, results } = req.body;
    
//     if (!email || !results) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields'
//       });
//     }
    
//     // Generate and upload PDF
//     const pdfResponse = await fetch(`http://0.0.0.0:${PORT}/api/quiz/generate-pdf`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({ email, name, results })
//     });
    
//     const pdfResult = await pdfResponse.json();
    
//     if (!pdfResult.success) {
//       throw new Error(pdfResult.error);
//     }
    
//     res.json({
//       success: true,
//       resultId: pdfResult.resultId,
//       pdfUrl: pdfResult.pdfUrl,
//       message: 'Quiz completed successfully'
//     });
    
//   } catch (error) {
//     console.error('❌ Error in /api/quiz/complete:', error);
//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// });

// /**
//  * Send Invite Email via Supabase
//  * This endpoint is called when users request OTP for E-DNA quiz verification
//  * Sends an invite email with signup link alongside the OTP email
//  */
// app.post('/api/send-invite-email', async (req, res) => {
//   try {
//     const { email } = req.body;

//     console.log('\n📨 Invite email request received');
//     console.log(`   Email: ${email}`);

//     if (!email) {
//       console.log('❌ Error: Email is required');
//       return res.status(400).json({
//         success: false,
//         error: 'Email is required'
//       });
//     }

//     // Send invite email via Supabase
//     const result = await sendInviteEmail(email);

//     if (result.success) {
//       console.log('✅ Invite email sent successfully\n');
//       return res.json({
//         success: true,
//         message: 'Invite email sent'
//       });
//     } else {
//       console.error('❌ Failed to send invite email:', result.error);
//       return res.status(500).json({
//         success: false,
//         error: result.error
//       });
//     }

//   } catch (error) {
//     console.error('❌ Error in /api/send-invite-email:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Internal server error'
//     });
//   }
// });

// /**
//  * Create User and Send Reset Password Email
//  * This endpoint is called after quiz OTP verification
//  * Creates a Supabase account without password and sends reset password email
//  */
// app.post('/api/create-user-with-reset', async (req, res) => {
//   try {
//     const { email, firstName, lastName, metadata } = req.body;

//     console.log('\n📝 Create user with reset password request received');
//     console.log(`   Email: ${email}`);

//     if (!email) {
//       console.log('❌ Error: Email is required');
//       return res.status(400).json({
//         success: false,
//         error: 'Email is required'
//       });
//     }

//     // Create user and send reset password email
//     const result = await createUserAndSendResetEmail(email, firstName, lastName, metadata);

//     if (result.success) {
//       console.log('✅ User created and reset password email sent\n');
//       return res.json({
//         success: true,
//         message: result.message,
//         user: result.user
//       });
//     } else {
//       console.error('❌ Failed to create user:', result.message);
//       return res.status(500).json({
//         success: false,
//         error: result.message
//       });
//     }

//   } catch (error) {
//     console.error('❌ Error in /api/create-user-with-reset:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Internal server error'
//     });
//   }
// });

// /**
//  * Generate Agent Access Token
//  * POST /api/agent/token
//  * 
//  * Verifies Supabase session and generates a lightweight JWT token for Agent iframe
//  * This replaces passing the Supabase auth token directly to avoid cross-domain issues
//  * 
//  * Request body:
//  * - supabaseToken: Supabase auth token from frontend
//  * 
//  * Response:
//  * - success: boolean
//  * - token: JWT token (2-hour expiry)
//  * - userId: Supabase user ID
//  * - expiresIn: Token expiry duration
//  */
// app.post('/api/agent/token', async (req, res) => {
//   try {
//     const { supabaseToken } = req.body;

//     if (!supabaseToken) {
//       return res.status(400).json({
//         success: false,
//         error: 'Supabase token is required'
//       });
//     }

//     console.log('🔑 Generating Agent access token...');

//     const result = await createAgentTokenFromSupabase(supabaseToken);

//     if (!result.success) {
//       return res.status(401).json(result);
//     }

//     console.log('✅ Agent token generated for user:', result.userId);

//     res.json(result);

//   } catch (error) {
//     console.error('❌ Error in /api/agent/token:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Internal server error'
//     });
//   }
// });

// /**
//  * Verify Agent Access Token (Example protected endpoint)
//  * GET /api/agent/verify
//  * 
//  * Example endpoint showing how to protect Agent backend routes
//  * Requires Authorization: Bearer <agent_token> header
//  */
// app.get('/api/agent/verify', verifyAgentTokenMiddleware, (req, res) => {
//   res.json({
//     success: true,
//     userId: req.userId,
//     message: 'Token is valid'
//   });
// });

// // Initialize Aurora MySQL and start server
// async function startServer() {
//   try {
//     console.log('\n🚀 Starting E-DNA Backend...\n');

//     // Test database connection
//     console.log('🔗 Testing Aurora PostgreSQL connection...');
//     const dbConnected = await testConnection();

//     if (!dbConnected) {
//       console.warn('⚠️  Failed to connect to Aurora PostgreSQL');
//       console.warn('   Database operations will fail until connection is established');
//       console.warn('   Please check your database credentials and network access');
//       console.warn('   Server will continue to run for other endpoints...');
//     } else {
//       console.log('✅ Database connection successful - initializing tables...');
//       await initializeDatabase();
//     }

//     // Start Express server
//     app.listen(PORT, '0.0.0.0', () => {
//       console.log(`\n✅ E-DNA Backend running on http://0.0.0.0:${PORT}`);
//       console.log(`📊 Health check: http://0.0.0.0:${PORT}/health\n`);
//       console.log(`📄 Endpoints:`);
//       console.log(`  GET  /download                  - Time-limited PDF download (via token)`);
//       console.log(`  POST /api/quiz/generate-pdf     - Generate full PDF and upload to S3`);
//       console.log(`  POST /api/quiz/save-results     - Save results and generate PDF in background`);
//       console.log(`  POST /api/send-invite-email     - Send Supabase invite email with signup link`);
//       console.log(`  POST /api/create-user-with-reset - Create user and send password reset email`);
//       console.log(`  POST /api/agent/token           - Generate Agent access token (JWT)`);
//       console.log(`  GET  /api/agent/verify          - Verify Agent access token`);
//       console.log(`  POST /api/ghl/get-pdf           - GHL webhook: Get PDF URL by email`);
//       console.log(`  POST /api/quiz/send-email       - Send email with PDF link`);
//       console.log(`  POST /api/quiz/complete         - Complete flow (PDF + Save)`);
//       console.log(`\n📧 Email: GoHighLevel (via inbound webhook)`);
//       console.log(`📄 PDF: Full EDNAResultsPage`);
//       console.log(`💾 Storage: AWS S3 + Aurora PostgreSQL`);
//       console.log(`🔗 Download: Time-limited tokens (7 days = 168 hours)`);
//       console.log(`🔑 Agent: Lightweight JWT tokens (2 hours expiry)\n`);
//     });

//   } catch (error) {
//     console.error('❌ Failed to start server:', error);
//     process.exit(1);
//   }
// }

// // Start the server
// startServer();

// export default app;









// // import dotenv from 'dotenv';
// // dotenv.config();

// // import express from 'express';
// // import cors from 'cors';
// // import { v4 as uuidv4 } from 'uuid';
// // import fs from 'fs';
// // import path from 'path';
// // import { fileURLToPath } from 'url';

// // import { uploadPDFToS3, generatePresignedPdfUrl } from './s3.js';
// // import { sendGHLEmailWithPDF, notifyGhlWithDownloadLink } from './ghl.js';
// // import { generatePDFFromComponent } from './pdf-from-component.js';
// // import { sendInviteEmail } from './invite-email-supabase.js';
// // // Aurora PostgreSQL Database (replacing Supabase for quiz data)
// // import {
// //   initializeDatabase,
// //   saveQuizResult,
// //   getQuizResultById,
// //   createDownloadToken,
// //   verifyDownloadToken,
// //   testConnection,
// //   closePool
// // } from './postgres-db.js';
// // // Keep Supabase imports for authentication (if needed in future)
// // // import { supabase } from './supabase-db.js';

// // const __filename = fileURLToPath(import.meta.url);
// // const __dirname = path.dirname(__filename);

// // const app = express();
// // const PORT = process.env.PORT || 8080;

// // // Middleware - CORS Configuration
// // const allowedOrigins = [
// //   'http://localhost:3000',
// //   'http://localhost:8080',
// //   'https://main.d4edpf6ads6l4.amplifyapp.com',
// //   process.env.FRONTEND_URL
// // ].filter(Boolean); // Remove undefined values

// // app.use(cors({
// //   origin: (origin, callback) => {
// //     // Allow requests with no origin (like mobile apps, Postman, or same-origin)
// //     if (!origin) return callback(null, true);

// //     if (allowedOrigins.indexOf(origin) !== -1) {
// //       callback(null, true);
// //     } else {
// //       console.log(`⚠️  CORS blocked request from origin: ${origin}`);
// //       callback(null, true); // Still allow for now, log for debugging
// //     }
// //   },
// //   credentials: true,
// //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
// //   allowedHeaders: ['Content-Type', 'Authorization']
// // }));

// // app.use(express.json({ limit: '50mb' }));

// // // Create temp directory
// // const tempDir = path.join(__dirname, '../temp');
// // if (!fs.existsSync(tempDir)) {
// //   fs.mkdirSync(tempDir, { recursive: true });
// // }

// // // Health check
// // app.get('/health', (req, res) => {
// //   res.json({
// //     status: 'ok',
// //     timestamp: new Date().toISOString(),
// //     service: 'E-DNA Quiz Backend (Full PDF + Aurora PostgreSQL + GHL)'
// //   });
// // });

// // /**
// //  * Download endpoint - Validates token and redirects to S3 presigned URL
// //  * This is the public download link sent to users via GHL email
// //  */
// // app.get('/download', async (req, res) => {
// //   try {
// //     const { token } = req.query;

// //     console.log('\n🔗 Download request received');
// //     console.log(`   Token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);

// //     // Validate token parameter
// //     if (!token) {
// //       console.log('❌ Error: Missing token parameter');
// //       return res.status(400).json({
// //         error: 'Missing token'
// //       });
// //     }

// //     // Look up token in database
// //     console.log('🔍 Looking up token in database...');
// //     const linkResult = await verifyDownloadToken(token);

// //     if (!linkResult.success) {
// //       console.log(`❌ Error: ${linkResult.error}`);
// //       return res.status(404).json({
// //         error: 'Invalid or unknown link'
// //       });
// //     }

// //     const record = linkResult.data;
// //     console.log(`✅ Token found for: ${record.email}`);

// //     // Token expiration is already checked in verifyDownloadToken
// //     // No need to check again here

// //     // Generate presigned URL for S3
// //     console.log('🔐 Generating presigned S3 URL...');
// //     const urlResult = await generatePresignedPdfUrl(record.s3_key, 7 * 60 * 60);

// //     if (!urlResult.success) {
// //       console.error('❌ Error generating presigned URL:', urlResult.error);
// //       return res.status(500).json({
// //         error: 'Could not generate download link'
// //       });
// //     }

// //     console.log('✅ Presigned URL generated, redirecting user...\n');

// //     // Redirect to S3 presigned URL
// //     return res.redirect(urlResult.url);

// //     // Alternative: Return JSON (uncomment if needed)
// //     // return res.json({
// //     //   success: true,
// //     //   downloadUrl: urlResult.url,
// //     //   email: record.email
// //     // });

// //   } catch (error) {
// //     console.error('❌ Error in /download endpoint:', error);
// //     res.status(500).json({
// //       error: 'Internal server error'
// //     });
// //   }
// // });

// // /**
// //  * Generate FULL PDF and upload to S3
// //  * This is called after email verification
// //  * Generates complete EDNAResultsPage, not just summary
// //  */
// // app.post('/api/quiz/generate-pdf', async (req, res) => {
// //   try {
// //     const { email, name, results } = req.body;
    
// //     if (!email || !results) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: email and results are required'
// //       });
// //     }
    
// //     const resultId = uuidv4();
// //     console.log(`\n📝 Generating FULL PDF for ${email}...`);
    
// //     // Step 1: Generate FULL PDF (complete EDNAResultsPage)
// //     console.log('1️⃣ Generating complete E-DNA Results PDF from React component...');
// //     const pdfFileName = `edna-results-${resultId}.pdf`;
// //     const pdfPath = path.join(tempDir, pdfFileName);

// //     const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
// //     const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);
// //     if (!pdfResult.success) {
// //       throw new Error(`PDF generation failed: ${pdfResult.error}`);
// //     }
    
// //     // Step 2: Upload to S3
// //     console.log('2️⃣ Uploading PDF to S3...');
// //     const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);
// //     if (!s3Result.success) {
// //       throw new Error(`S3 upload failed: ${s3Result.error}`);
// //     }
    
// //     // Step 3: Save to Supabase
// //     console.log('3️⃣ Saving to Supabase...');
// //     const dbResult = await saveQuizResult(email, results, s3Result.url);
// //     if (!dbResult.success) {
// //       console.warn('⚠️ Supabase save failed (continuing anyway):', dbResult.error);
// //     }

// //     // Step 4: Create download token
// //     console.log('4️⃣ Creating download token...');
// //     const token = uuidv4();
// //     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
// //     const tokenResult = await createDownloadToken(token, resultId, expiresAt);

// //     if (!tokenResult.success) {
// //       console.warn('⚠️ Token creation failed:', tokenResult.error);
// //     }

// //     // Step 5: Notify GHL with download link
// //     let ghlNotificationStatus = 'not_sent';
// //     if (tokenResult.success) {
// //       console.log('5️⃣ Notifying GHL with download link...');
// //       const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
// //       const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

// //       const ghlResult = await notifyGhlWithDownloadLink({
// //         email: email,
// //         name: name,
// //         downloadLink: publicDownloadUrl
// //       });

// //       if (ghlResult.success) {
// //         console.log('✅ GHL webhook notified successfully');
// //         ghlNotificationStatus = 'sent';
// //       } else {
// //         console.warn('⚠️ GHL webhook notification failed (continuing anyway):', ghlResult.error);
// //         ghlNotificationStatus = 'failed';
// //       }
// //     }

// //     // Step 6: Cleanup temp file
// //     console.log('6️⃣ Cleaning up temp file...');
// //     setTimeout(() => {
// //       if (fs.existsSync(pdfPath)) {
// //         fs.unlinkSync(pdfPath);
// //         console.log('🗑️ Temp file deleted');
// //       }
// //     }, 5000);

// //     console.log('✅ Full PDF generated, uploaded, and saved!\n');

// //     res.json({
// //       success: true,
// //       resultId,
// //       pdfUrl: s3Result.url,
// //       message: 'Full PDF generated and uploaded to S3',
// //       savedToDatabase: dbResult.success,
// //       tokenCreated: tokenResult.success,
// //       ghlNotification: ghlNotificationStatus
// //     });
    
// //   } catch (error) {
// //     console.error('❌ Error in /api/quiz/generate-pdf:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * NEW FAST ENDPOINT: Save results and trigger async PDF generation
// //  * This allows the user to see results immediately while PDF generates in background
// //  */
// // app.post('/api/quiz/save-results', async (req, res) => {
// //   try {
// //     const { email, name, results } = req.body;

// //     if (!email || !results) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields: email and results are required'
// //       });
// //     }

// //     const resultId = uuidv4();

// //     console.log(`\n📝 Saving quiz results for ${email} (fast mode)...`);
// //     console.log(`📦 Results data:`, {
// //       email,
// //       name,
// //       core_type: results.core_type,
// //       subtype: results.subtype
// //     });

// //     // Save to Aurora MySQL immediately (fast) - with null PDF URL initially
// //     const dbResult = await saveQuizResult(resultId, email, name, results, null, null);

// //     if (!dbResult.success) {
// //       throw new Error(`Failed to save to Aurora MySQL: ${dbResult.error}`);
// //     }

// //     console.log(`✅ Quiz results saved to Aurora MySQL: ${resultId}`);

// //     // Respond immediately (don't wait for PDF)
// //     res.json({
// //       success: true,
// //       resultId: resultId,
// //       message: 'Results saved. PDF generation started in background.'
// //     });

// //     // Generate PDF in background (async, don't await)
// //     generatePDFInBackground(email, name, results, resultId).catch(error => {
// //       console.error(`❌ Background PDF generation failed for ${email}:`, error);
// //     });

// //   } catch (error) {
// //     console.error('❌ Error in /api/quiz/save-results:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * Background PDF generation function
// //  * Runs asynchronously without blocking the response
// //  */
// // async function generatePDFInBackground(email, name, results, resultId) {
// //   try {
// //     console.log(`\n🎨 Starting background PDF generation for ${email}...`);

// //     // Generate PDF from React component
// //     console.log('1️⃣ Generating PDF from React component...');
// //     const pdfFileName = `edna-results-${resultId}.pdf`;
// //     const pdfPath = path.join(tempDir, pdfFileName);

// //     const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
// //     const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);

// //     if (!pdfResult.success) {
// //       throw new Error(`PDF generation failed: ${pdfResult.error}`);
// //     }

// //     console.log(`✅ PDF generated: ${pdfPath}`);

// //     // Upload to S3
// //     console.log('2️⃣ Uploading PDF to S3...');
// //     const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);

// //     if (!s3Result.success) {
// //       throw new Error(`S3 upload failed: ${s3Result.error}`);
// //     }

// //     console.log(`✅ PDF uploaded to S3: ${s3Result.url}`);

// //     // PDF URL and S3 key already saved in saveQuizResult above
// //     console.log('3️⃣ PDF URL and S3 key saved in Aurora PostgreSQL ✅');

// //     // Create download token (7 days expiration)
// //     console.log('4️⃣ Creating download token (7 days expiration)...');
// //     const token = uuidv4();
// //     const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
// //     const tokenResult = await createDownloadToken(token, resultId, expiresAt);

// //     if (!tokenResult.success) {
// //       console.warn('⚠️ Token creation failed:', tokenResult.error);
// //     }

// //     // Notify GHL with download link and E-DNA details
// //     if (tokenResult.success) {
// //       console.log('5️⃣ Notifying GHL with download link...');
// //       const publicBaseUrl = process.env.PUBLIC_BACKEND_BASE_URL || 'https://ry93w5zzjy.us-east-1.awsapprunner.com';
// //       const publicDownloadUrl = `${publicBaseUrl}/download?token=${token}`;

// //       const ghlResult = await notifyGhlWithDownloadLink({
// //         email: email,
// //         name: name,
// //         downloadLink: publicDownloadUrl,
// //         ednaType: results.subtype || 'Unknown',
// //         coreType: results.core_type || 'Unknown'
// //       });

// //       if (ghlResult.success) {
// //         console.log('✅ GHL webhook notified successfully');
// //       } else {
// //         console.warn('⚠️ GHL webhook notification failed:', ghlResult.error);
// //       }
// //     }

// //     console.log(`✅ Background PDF generation complete for ${email}`);

// //     // Clean up temp file after 5 seconds
// //     setTimeout(() => {
// //       if (fs.existsSync(pdfPath)) {
// //         fs.unlinkSync(pdfPath);
// //         console.log('🗑️ Temp PDF file deleted');
// //       }
// //     }, 5000);

// //   } catch (error) {
// //     console.error(`❌ Background PDF generation error for ${email}:`, error);
// //     // Don't throw - this is background process
// //   }
// // }

// // /**
// //  * GHL Webhook: Get PDF URL by email
// //  * This is called by GHL after payment is completed
// //  * Returns the S3 PDF URL for the user's quiz results
// //  */
// // app.post('/api/ghl/get-pdf', async (req, res) => {
// //   try {
// //     const { email } = req.body;

// //     console.log('\n🔔 GHL Webhook Called!');
// //     console.log(`📧 Email: ${email}`);
// //     console.log(`⏰ Time: ${new Date().toISOString()}`);

// //     if (!email) {
// //       console.log('❌ Error: No email provided');
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required field: email'
// //       });
// //     }

// //     console.log(`🔍 Looking up quiz result for ${email}...`);

// //     // Get quiz result from Aurora MySQL
// //     const result = await getQuizResultByEmail(email);

// //     if (!result.success) {
// //       console.log(`❌ Not found: No quiz results for ${email}`);
// //       return res.status(404).json({
// //         success: false,
// //         error: 'No quiz results found for this email'
// //       });
// //     }

// //     console.log(`✅ Found quiz result!`);
// //     console.log(`📄 PDF URL: ${result.data.pdf_url}`);
// //     console.log(`🧬 Core Type: ${result.data.core_type}`);
// //     console.log(`🎯 Subtype: ${result.data.subtype}`);

// //     // Payment tracking not implemented in current version

// //     const response = {
// //       success: true,
// //       email: email,
// //       pdfUrl: result.data.pdf_url,
// //       core_type: result.data.core_type,
// //       subtype: result.data.subtype,
// //       created_at: result.data.created_at
// //     };

// //     console.log('📤 Sending response to GHL\n');
// //     res.json(response);

// //   } catch (error) {
// //     console.error('❌ Error in /api/ghl/get-pdf:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * Send email with PDF link via GHL
// //  * This can be called manually or by GHL automation
// //  */
// // app.post('/api/quiz/send-email', async (req, res) => {
// //   try {
// //     const { email, pdfUrl } = req.body;
    
// //     if (!email) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required field: email'
// //       });
// //     }
    
// //     console.log(`\n📧 Sending email to ${email}...`);
    
// //     // If no PDF URL provided, get it from database
// //     let finalPdfUrl = pdfUrl;
// //     if (!finalPdfUrl) {
// //       const result = await getQuizResultByEmail(email);
// //       if (result.success) {
// //         finalPdfUrl = result.data.pdf_url;
// //       } else {
// //         return res.status(404).json({
// //           success: false,
// //           error: 'No PDF found for this email'
// //         });
// //       }
// //     }
    
// //     // Send email via GHL
// //     const emailResult = await sendGHLEmailWithPDF(email, finalPdfUrl);
    
// //     if (!emailResult.success) {
// //       throw new Error(`Email sending failed: ${emailResult.error}`);
// //     }
    
// //     console.log('✅ Email sent successfully!\n');
    
// //     res.json({
// //       success: true,
// //       message: 'Email sent with PDF link',
// //       email: email
// //     });
    
// //   } catch (error) {
// //     console.error('❌ Error in /api/quiz/send-email:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * Complete flow: Generate PDF, upload to S3, save to DB
// //  * This is the main endpoint called after email verification
// //  */
// // app.post('/api/quiz/complete', async (req, res) => {
// //   try {
// //     const { email, name, results } = req.body;
    
// //     if (!email || !results) {
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Missing required fields'
// //       });
// //     }
    
// //     // Generate and upload PDF
// //     const pdfResponse = await fetch(`http://0.0.0.0:${PORT}/api/quiz/generate-pdf`, {
// //       method: 'POST',
// //       headers: { 'Content-Type': 'application/json' },
// //       body: JSON.stringify({ email, name, results })
// //     });
    
// //     const pdfResult = await pdfResponse.json();
    
// //     if (!pdfResult.success) {
// //       throw new Error(pdfResult.error);
// //     }
    
// //     res.json({
// //       success: true,
// //       resultId: pdfResult.resultId,
// //       pdfUrl: pdfResult.pdfUrl,
// //       message: 'Quiz completed successfully'
// //     });
    
// //   } catch (error) {
// //     console.error('❌ Error in /api/quiz/complete:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: error.message
// //     });
// //   }
// // });

// // /**
// //  * Send Invite Email via Supabase
// //  * This endpoint is called when users request OTP for E-DNA quiz verification
// //  * Sends an invite email with signup link alongside the OTP email
// //  */
// // app.post('/api/send-invite-email', async (req, res) => {
// //   try {
// //     const { email } = req.body;

// //     console.log('\n📨 Invite email request received');
// //     console.log(`   Email: ${email}`);

// //     if (!email) {
// //       console.log('❌ Error: Email is required');
// //       return res.status(400).json({
// //         success: false,
// //         error: 'Email is required'
// //       });
// //     }

// //     // Send invite email via Supabase
// //     const result = await sendInviteEmail(email);

// //     if (result.success) {
// //       console.log('✅ Invite email sent successfully\n');
// //       return res.json({
// //         success: true,
// //         message: 'Invite email sent'
// //       });
// //     } else {
// //       console.error('❌ Failed to send invite email:', result.error);
// //       return res.status(500).json({
// //         success: false,
// //         error: result.error
// //       });
// //     }

// //   } catch (error) {
// //     console.error('❌ Error in /api/send-invite-email:', error);
// //     res.status(500).json({
// //       success: false,
// //       error: 'Internal server error'
// //     });
// //   }
// // });

// // // Initialize Aurora MySQL and start server
// // async function startServer() {
// //   try {
// //     console.log('\n🚀 Starting E-DNA Backend...\n');

// //     // Test database connection
// //     console.log('🔗 Testing Aurora PostgreSQL connection...');
// //     const dbConnected = await testConnection();

// //     if (!dbConnected) {
// //       console.warn('⚠️  Failed to connect to Aurora PostgreSQL');
// //       console.warn('   Database operations will fail until connection is established');
// //       console.warn('   Please check your database credentials and network access');
// //       console.warn('   Server will continue to run for other endpoints...');
// //     } else {
// //       console.log('✅ Database connection successful - initializing tables...');
// //       await initializeDatabase();
// //     }

// //     // Start Express server
// //     app.listen(PORT, '0.0.0.0', () => {
// //       console.log(`\n✅ E-DNA Backend running on http://0.0.0.0:${PORT}`);
// //       console.log(`📊 Health check: http://0.0.0.0:${PORT}/health\n`);
// //       console.log(`📄 Endpoints:`);
// //       console.log(`  GET  /download                  - Time-limited PDF download (via token)`);
// //       console.log(`  POST /api/quiz/generate-pdf     - Generate full PDF and upload to S3`);
// //       console.log(`  POST /api/quiz/save-results     - Save results and generate PDF in background`);
// //       console.log(`  POST /api/send-invite-email     - Send Supabase invite email with signup link`);
// //       console.log(`  POST /api/ghl/get-pdf           - GHL webhook: Get PDF URL by email`);
// //       console.log(`  POST /api/quiz/send-email       - Send email with PDF link`);
// //       console.log(`  POST /api/quiz/complete         - Complete flow (PDF + Save)`);
// //       console.log(`\n📧 Email: GoHighLevel (via inbound webhook)`);
// //       console.log(`📄 PDF: Full EDNAResultsPage`);
// //       console.log(`💾 Storage: AWS S3 + Aurora MySQL`);
// //       console.log(`🔗 Download: Time-limited tokens (7 days = 168 hours)\n`);
// //     });

// //   } catch (error) {
// //     console.error('❌ Failed to start server:', error);
// //     process.exit(1);
// //   }
// // }

// // // Start the server
// // startServer();

/**
 * Download PDF endpoint - Server-side PDF generation
 * Generates PDF using Puppeteer and returns it directly for download
 */
app.post('/api/quiz/download-pdf', async (req, res) => {
  let pdfPath = null;
  
  try {
    const { results, name } = req.body;
    
    if (!results) {
      return res.status(400).json({
        success: false,
        error: 'Results data is required'
      });
    }
    
    console.log(`\n📥 PDF download request received`);
    console.log(`   Core Type: ${results.core_type || 'Unknown'}`);
    console.log(`   Subtype: ${results.subtype || 'Unknown'}`);
    
    // Generate PDF using Puppeteer
    const resultId = uuidv4();
    const pdfFileName = `edna-results-${resultId}.pdf`;
    pdfPath = path.join(tempDir, pdfFileName);
    
    // Use local development URL if NODE_ENV is not production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const frontendUrl = isDevelopment 
      ? 'http://localhost:3000' 
      : (process.env.FRONTEND_URL || 'https://brandscaling.co.uk');
    const pdfResult = await generatePDFFromComponent({ ...results, name }, pdfPath, frontendUrl);
    
    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }
    
    console.log(`✅ PDF generated: ${pdfPath}`);
    
    // Generate filename
    const coreTypeName = results.core_type === 'alchemist' ? 'Alchemist' : 
                        results.core_type === 'architect' ? 'Architect' : 'Mixed';
    const filename = `EDNA-Results-${coreTypeName}-${new Date().toISOString().split('T')[0]}.pdf`;
    
    // Send PDF as download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Stream the PDF file
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
    
    // Clean up temp file after response is finished
    res.on('finish', () => {
      setTimeout(() => {
        if (fs.existsSync(pdfPath)) {
          fs.unlinkSync(pdfPath);
          console.log('🗑️ Temp PDF file deleted after successful download');
        }
      }, 2000); // Increased delay to ensure download completes
    });
    
    fileStream.on('error', (error) => {
      console.error('❌ Error streaming PDF:', error);
      // Clean up on error
      if (pdfPath && fs.existsSync(pdfPath)) {
        try {
          fs.unlinkSync(pdfPath);
          console.log('🗑️ Temp PDF file deleted after error');
        } catch (unlinkError) {
          console.error('Failed to delete temp file:', unlinkError);
        }
      }
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to stream PDF'
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error in /api/quiz/download-pdf:', error);
    
    // Clean up temp file on error
    if (pdfPath && fs.existsSync(pdfPath)) {
      try {
        fs.unlinkSync(pdfPath);
      } catch (unlinkError) {
        console.error('Failed to delete temp file:', unlinkError);
      }
    }
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate PDF'
      });
    }
  }
});

// New Quiz Scoring Endpoint
import { calculateAllResults } from './scoring.js';

app.post('/api/quiz/submit-new', async (req, res) => {
  try {
    const { answers, email, name } = req.body;
    
    if (!answers) {
      return res.status(400).json({
        success: false,
        error: 'Answers are required'
      });
    }

    // Calculate results using new scoring logic
    const results = calculateAllResults(answers);

    // Save to database if email provided
    if (email) {
      const quizId = uuidv4();
      await saveQuizResult({
        quiz_id: quizId,
        email,
        name: name || 'Anonymous',
        results: JSON.stringify(results),
        answers: JSON.stringify(answers)
      });
    }

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process quiz submission'
    });
  }
});

// // export default app;


// Initialize database and start server
async function startServer() {
  try {
    console.log('\n🚀 Starting E-DNA Backend...\n');

    // Test database connection
    console.log('🔗 Testing PostgreSQL connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      console.warn('⚠️  Failed to connect to PostgreSQL');
      console.warn('   Database operations will fail until connection is established');
      console.warn('   Please check your database credentials and network access');
      console.warn('   Server will continue to run for other endpoints...');
    } else {
      console.log('✅ Database connection successful - initializing tables...');
      await initializeDatabase();
    }

    // Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✅ E-DNA Backend running on http://0.0.0.0:${PORT}`);
      console.log(`📊 Health check: http://0.0.0.0:${PORT}/health\n`);
      console.log(`📄 Key Endpoints:`);
      console.log(`  GET  /health                       - Health check`);
      console.log(`  POST /api/quiz-results             - Save quiz results`);
      console.log(`  GET  /api/quiz-results/:email      - Get quiz results by email`);
      console.log(`  POST /api/quiz-progress/save       - Save quiz progress`);
      console.log(`  GET  /api/quiz-progress/:email     - Get saved progress`);
      console.log(`  DELETE /api/quiz-progress          - Delete progress`);
      console.log(`  POST /api/signup-with-otp          - Signup with OTP verification`);
      console.log(`\n💾 Database: PostgreSQL`);
      console.log(`🔐 Auth: AWS Cognito\n`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;

