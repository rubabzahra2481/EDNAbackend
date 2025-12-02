import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://xuhkruljgrspjzluqyjo.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Save quiz result with verified email to Supabase
 * This creates a record linking email to quiz results and S3 PDF URL
 */
export async function saveQuizResult(email, results, pdfUrl) {
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .insert([
        {
          email: email.toLowerCase(),
          core_type: results.core_type,
          subtype: results.subtype,
          decision_mastery: results.decision_mastery,
          core_level: results.core_level,
          mirror_awareness: results.mirror_awareness,
          integration_level: results.integration_level,
          pdf_url: pdfUrl,
          created_at: new Date().toISOString(),
          payment_status: 'pending' // Will be updated after payment
        }
      ])
      .select();

    if (error) {
      // If table doesn't exist, create it
      if (error.code === '42P01') {
        console.log('📋 Creating quiz_results table...');
        await createQuizResultsTable();
        // Retry insert
        return await saveQuizResult(email, results, pdfUrl);
      }
      throw error;
    }

    console.log('✅ Quiz result saved to Supabase:', data[0]?.id);
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('❌ Error saving quiz result:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get quiz result by email
 * Used by GHL webhook to retrieve PDF URL after payment
 */
export async function getQuizResultByEmail(email) {
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .select('*')
      .eq('email', email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      return { success: false, error: 'No quiz result found for this email' };
    }

    console.log('✅ Quiz result retrieved for:', email);
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('❌ Error retrieving quiz result:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update payment status after successful purchase
 */
export async function updatePaymentStatus(email, status = 'completed') {
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .update({ payment_status: status, payment_date: new Date().toISOString() })
      .eq('email', email.toLowerCase())
      .select();

    if (error) throw error;

    console.log('✅ Payment status updated for:', email);
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('❌ Error updating payment status:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create quiz_results table if it doesn't exist
 * This runs automatically on first use
 */
async function createQuizResultsTable() {
  try {
    // Note: This requires Supabase SQL editor or migration
    // For now, we'll log instructions
    console.log(`
📋 Please create the quiz_results table in Supabase SQL Editor:

CREATE TABLE quiz_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  core_type TEXT NOT NULL,
  subtype TEXT NOT NULL,
  decision_mastery INTEGER,
  core_level INTEGER,
  mirror_awareness INTEGER,
  integration_level INTEGER,
  pdf_url TEXT,
  payment_status TEXT DEFAULT 'pending',
  payment_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_quiz_results_email ON quiz_results(email);
CREATE INDEX idx_quiz_results_created_at ON quiz_results(created_at DESC);

-- Enable Row Level Security
ALTER TABLE quiz_results ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role full access
CREATE POLICY "Service role can do everything" ON quiz_results
  FOR ALL USING (true);
    `);
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error creating table:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update quiz result with PDF URL after background generation
 */
export async function updateQuizResultPDF(resultId, pdfUrl) {
  try {
    const { data, error } = await supabase
      .from('quiz_results')
      .update({ pdf_url: pdfUrl })
      .eq('id', resultId)
      .select();

    if (error) {
      console.error('❌ Supabase update error:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ PDF URL updated in Supabase for result:', resultId);
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('❌ Error updating quiz result PDF:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new PDF download token
 * Used for generating time-limited download links sent via GHL
 */
export async function createPdfDownloadToken({ email, s3Key, expiresInHours = 7 }) {
  try {
    // Generate a secure random token
    const token = randomBytes(32).toString('hex');

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    const { data, error } = await supabase
      .from('edna_pdf_links')
      .insert([
        {
          email: email.toLowerCase(),
          token: token,
          s3_key: s3Key,
          expires_at: expiresAt.toISOString()
        }
      ])
      .select();

    if (error) {
      console.error('❌ Error creating PDF download token:', error);
      return { success: false, error: error.message };
    }

    console.log(`✅ PDF download token created for ${email} (expires in ${expiresInHours}h)`);

    return {
      success: true,
      token: token,
      expiresAt: expiresAt.toISOString(),
      data: data[0]
    };
  } catch (error) {
    console.error('❌ Error creating PDF download token:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get PDF link record by token
 * Used to validate and retrieve PDF information when user clicks download link
 */
export async function getPdfLinkByToken(token) {
  try {
    const { data, error } = await supabase
      .from('edna_pdf_links')
      .select('*')
      .eq('token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        console.log('⚠️ Token not found:', token.substring(0, 8) + '...');
        return { success: false, error: 'Token not found' };
      }
      throw error;
    }

    if (!data) {
      console.log('⚠️ No data returned for token:', token.substring(0, 8) + '...');
      return { success: false, error: 'Invalid token' };
    }

    console.log(`✅ PDF link retrieved for token: ${token.substring(0, 8)}... (email: ${data.email})`);

    return {
      success: true,
      record: {
        email: data.email,
        s3_key: data.s3_key,
        expires_at: data.expires_at,
        created_at: data.created_at
      }
    };
  } catch (error) {
    console.error('❌ Error retrieving PDF link by token:', error);
    return { success: false, error: error.message };
  }
}

export default {
  saveQuizResult,
  getQuizResultByEmail,
  updatePaymentStatus,
  updateQuizResultPDF,
  createPdfDownloadToken,
  getPdfLinkByToken
};

