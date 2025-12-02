import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { uploadPDFToS3 } from './s3.js';
import { sendGHLEmailWithPDF } from './ghl.js';
import { generateFullResultsPDF } from './pdf-full.js';
import { saveQuizResult, getQuizResultByEmail, updatePaymentStatus } from './supabase-db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
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
    console.log('1️⃣ Generating complete E-DNA Results PDF...');
    const pdfFileName = `edna-results-${resultId}.pdf`;
    const pdfPath = path.join(tempDir, pdfFileName);
    
    const pdfResult = await generateFullResultsPDF({ ...results, name }, pdfPath);
    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }
    
    // Step 2: Upload to S3
    console.log('2️⃣ Uploading PDF to S3...');
    const s3Key = `pdfs/${pdfFileName}`;
    const s3Result = await uploadPDFToS3(pdfPath, s3Key);
    if (!s3Result.success) {
      throw new Error(`S3 upload failed: ${s3Result.error}`);
    }
    
    // Step 3: Save to Supabase
    console.log('3️⃣ Saving to Supabase...');
    const dbResult = await saveQuizResult(email, results, s3Result.url);
    if (!dbResult.success) {
      console.warn('⚠️ Supabase save failed (continuing anyway):', dbResult.error);
    }
    
    // Step 4: Cleanup temp file
    console.log('4️⃣ Cleaning up temp file...');
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
      savedToDatabase: dbResult.success
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
 * GHL Webhook: Get PDF URL by email
 * This is called by GHL after payment is completed
 * Returns the S3 PDF URL for the user's quiz results
 */
app.post('/api/ghl/get-pdf', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: email'
      });
    }
    
    console.log(`\n🔍 GHL webhook: Looking up PDF for ${email}...`);
    
    // Get quiz result from Supabase
    const result = await getQuizResultByEmail(email);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'No quiz results found for this email'
      });
    }
    
    // Update payment status
    await updatePaymentStatus(email, 'completed');
    
    console.log('✅ PDF URL retrieved for GHL\n');
    
    res.json({
      success: true,
      email: email,
      pdfUrl: result.data.pdf_url,
      core_type: result.data.core_type,
      subtype: result.data.subtype,
      created_at: result.data.created_at
    });
    
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
    const pdfResponse = await fetch(`http://localhost:${PORT}/api/quiz/generate-pdf`, {
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
app.listen(PORT, () => {
  console.log(`\n✅ E-DNA Backend running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health\n`);
  console.log(`📄 Endpoints:`);
  console.log(`  POST /api/quiz/generate-pdf  - Generate full PDF and upload to S3`);
  console.log(`  POST /api/ghl/get-pdf         - GHL webhook: Get PDF URL by email`);
  console.log(`  POST /api/quiz/send-email     - Send email with PDF link`);
  console.log(`  POST /api/quiz/complete       - Complete flow (PDF + Save)`);
  console.log(`\n📧 Email: GoHighLevel`);
  console.log(`📄 PDF: Full EDNAResultsPage`);
  console.log(`💾 Storage: AWS S3 + Supabase\n`);
});

export default app;

