import dotenv from 'dotenv';
import { uploadPDFToS3 } from './s3.js';
import { generatePDFFromHTML, createResultsHTML } from './pdf.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runCompleteTest() {
  console.log('🧪 Testing Complete E-DNA Flow...\n');
  
  try {
    // Test data
    const testResults = {
      name: 'Munawar (Test)',
      email: 'munawar@brandscaling.co.uk',
      core_type: 'architect',
      subtype: 'Systemized Builder',
      decision_mastery: 75,
      core_level: 80,
      mirror_awareness: 65,
      integration_level: 70
    };
    
    // Step 1: Generate PDF
    console.log('1️⃣ Generating PDF...');
    const htmlContent = createResultsHTML(testResults);
    const pdfPath = path.join(__dirname, '../temp/test-edna-results.pdf');
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const pdfResult = await generatePDFFromHTML(htmlContent, pdfPath);
    
    if (!pdfResult.success) {
      console.error('❌ PDF generation failed:', pdfResult.error);
      return false;
    }
    
    console.log('✅ PDF generated successfully');
    console.log(`   Path: ${pdfPath}`);
    console.log(`   Size: ${(fs.statSync(pdfPath).size / 1024).toFixed(2)} KB\n`);
    
    // Step 2: Upload to S3
    console.log('2️⃣ Uploading to S3...');
    const s3Result = await uploadPDFToS3(pdfPath, 'test-edna-results.pdf');
    
    if (!s3Result.success) {
      console.error('❌ S3 upload failed:', s3Result.error);
      return false;
    }
    
    console.log('✅ Uploaded to S3 successfully');
    console.log(`   URL: ${s3Result.url.substring(0, 100)}...\n`);
    
    // Step 3: Cleanup
    console.log('3️⃣ Cleaning up temp file...');
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
      console.log('✅ Temp file deleted\n');
    }
    
    // Summary
    console.log('🎉 Complete Flow Test PASSED!\n');
    console.log('Summary:');
    console.log('✅ PDF generation works');
    console.log('✅ S3 upload works');
    console.log('✅ Presigned URL generated');
    console.log('');
    console.log('📄 Test PDF URL (valid for 7 days):');
    console.log(s3Result.url);
    console.log('');
    console.log('✨ Backend is ready to use!');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Test Failed:');
    console.error('Error:', error.message);
    console.error('\nStack:', error.stack);
    return false;
  }
}

runCompleteTest();

