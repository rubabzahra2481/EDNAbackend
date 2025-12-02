import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { uploadPDFToS3 } from './s3.js';
import { sendGHLEmailWithPDF } from './ghl.js';
import { generatePDFFromHTML, createResultsHTML } from './pdf.js';

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
    service: 'E-DNA Quiz Backend (S3 + GHL)'
  });
});

/**
 * Generate PDF and upload to S3
 * This is called after email verification
 */
app.post('/api/quiz/generate-pdf', async (req, res) => {
  try {
    const { email, name, results } = req.body;
    
    if (!email || !results) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    const resultId = uuidv4();
    console.log(`\n📝 Generating PDF for ${email}...`);
    
    // Step 1: Generate PDF
    console.log('1️⃣ Generating PDF...');
    const htmlContent = createResultsHTML({ ...results, name });
    const pdfFileName = `edna-results-${resultId}.pdf`;
    const pdfPath = path.join(tempDir, pdfFileName);
    
    const pdfResult = await generatePDFFromHTML(htmlContent, pdfPath);
    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }
    
    // Step 2: Upload to S3
    console.log('2️⃣ Uploading PDF to S3...');
    const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);
    if (!s3Result.success) {
      throw new Error(`S3 upload failed: ${s3Result.error}`);
    }
    
    // Step 3: Cleanup temp file
    console.log('3️⃣ Cleaning up temp file...');
    setTimeout(() => {
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    }, 5000);
    
    console.log('✅ PDF generated and uploaded!\n');
    
    res.json({
      success: true,
      resultId,
      pdfUrl: s3Result.url,
      message: 'PDF generated and uploaded to S3'
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
 * Send email with PDF link via GHL
 * This is called after payment is completed
 */
app.post('/api/quiz/send-email', async (req, res) => {
  try {
    const { email, name, pdfUrl, results } = req.body;
    
    if (!email || !pdfUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    console.log(`\n📧 Sending email to ${email}...`);
    
    const emailResult = await sendGHLEmailWithPDF(email, name || email, pdfUrl, results || {});
    
    if (emailResult.skipped) {
      console.log('⚠️ Email skipped (GHL not configured)\n');
      return res.json({
        success: true,
        skipped: true,
        message: 'Email skipped - GHL not configured'
      });
    }
    
    if (!emailResult.success) {
      throw new Error(`Email failed: ${emailResult.error}`);
    }
    
    console.log('✅ Email sent successfully!\n');
    
    res.json({
      success: true,
      messageId: emailResult.messageId,
      message: 'Email sent successfully'
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
 * Complete flow: Generate PDF + Send Email
 * This combines both steps for convenience
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
    
    const resultId = uuidv4();
    console.log(`\n🚀 Complete flow for ${email}...`);
    
    // Generate PDF
    console.log('1️⃣ Generating PDF...');
    const htmlContent = createResultsHTML({ ...results, name });
    const pdfFileName = `edna-results-${resultId}.pdf`;
    const pdfPath = path.join(tempDir, pdfFileName);
    
    const pdfResult = await generatePDFFromHTML(htmlContent, pdfPath);
    if (!pdfResult.success) {
      throw new Error(`PDF generation failed: ${pdfResult.error}`);
    }
    
    // Upload to S3
    console.log('2️⃣ Uploading to S3...');
    const s3Result = await uploadPDFToS3(pdfPath, pdfFileName);
    if (!s3Result.success) {
      throw new Error(`S3 upload failed: ${s3Result.error}`);
    }
    
    // Send email
    console.log('3️⃣ Sending email...');
    const emailResult = await sendGHLEmailWithPDF(email, name || email, s3Result.url, results);
    
    // Cleanup
    console.log('4️⃣ Cleaning up...');
    setTimeout(() => {
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    }, 5000);
    
    console.log('✅ Complete flow finished!\n');
    
    res.json({
      success: true,
      resultId,
      pdfUrl: s3Result.url,
      emailSent: emailResult.success,
      emailSkipped: emailResult.skipped || false,
      message: 'PDF generated, uploaded, and email sent'
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
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📄 Endpoints:');
  console.log('  POST /api/quiz/generate-pdf  - Generate PDF and upload to S3');
  console.log('  POST /api/quiz/send-email    - Send email with PDF link');
  console.log('  POST /api/quiz/complete      - Complete flow (PDF + Email)');
  console.log('');
  console.log('📧 Email: GoHighLevel');
  console.log('📄 PDF Storage: AWS S3');
  console.log('');
});

export default app;

