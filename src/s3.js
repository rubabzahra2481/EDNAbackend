import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'brandscaling-edna-pdf';

/**
 * Upload PDF to S3
 */
export async function uploadPDFToS3(filePath, fileName) {
  try {
    const fileContent = fs.readFileSync(filePath);
    const s3Key = `pdfs/${fileName}`;

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/pdf',
      // Remove ServerSideEncryption as it can interfere with presigned URLs
      // ServerSideEncryption: 'AES256'
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // Generate presigned URL (valid for 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key
    });

    const presignedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 604800 // 7 days
    });

    console.log('✅ PDF uploaded to S3:', s3Key);
    console.log('📄 Presigned URL generated (expires in 7 days)');

    return {
      success: true,
      url: presignedUrl,
      key: s3Key
    };

  } catch (error) {
    console.error('❌ Error uploading to S3:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate a pre-signed URL for downloading a PDF from S3
 * Used to create time-limited direct download links
 * @param {string} s3Key - The S3 object key (path)
 * @param {number} expiresInSeconds - URL validity duration (default: 7 hours)
 */
export async function generatePresignedPdfUrl(s3Key, expiresInSeconds = 7 * 60 * 60) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds
    });

    console.log(`✅ Pre-signed URL generated for ${s3Key} (expires in ${expiresInSeconds / 3600}h)`);

    return {
      success: true,
      url: presignedUrl
    };

  } catch (error) {
    console.error('❌ Error generating presigned URL:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default { uploadPDFToS3, generatePresignedPdfUrl };

