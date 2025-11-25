/**
 * Invite Email Module (Supabase Version)
 * Sends "Invite User" email via Supabase Auth when user requests OTP
 */
import dotenv from 'dotenv';
dotenv.config();


import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.brandscaling.co.uk';

// Create Supabase admin client
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Send invite email with signup link via Supabase Auth
 * @param {string} email - User's email address
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendInviteEmail(email) {
  try {
    console.log(`\n📧 Checking if user exists: ${email}`);

    // First, check if user already exists
    const { data: existingUser, error: checkError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (checkError) {
      console.error(`❌ Error checking user existence:`, checkError.message);
    } else {
      const userExists = existingUser.users.some(user => user.email === email);
      
      if (userExists) {
        console.log(`ℹ️  User already exists: ${email}`);
        console.log(`   Skipping invite email (user already has an account)`);
        return { 
          success: true, 
          message: 'User already exists, invite email not needed' 
        };
      }
    }

    console.log(`📧 Sending Supabase invite email to: ${email}`);

    const signupLink = `${FRONTEND_URL}/signup`;

    // Use Supabase's inviteUserByEmail function
    // This will send the "Invite user" email template configured in Supabase
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: signupLink,
      data: {
        signup_link: signupLink,
        invited_at: new Date().toISOString()
      }
    });

    if (error) {
      throw error;
    }

    console.log(`✅ Supabase invite email sent successfully to ${email}`);
    console.log(`   User will be redirected to: ${signupLink}`);

    return { success: true };

  } catch (error) {
    console.error(`❌ Failed to send Supabase invite email to ${email}:`, error.message);

    return {
      success: false,
      error: error.message
    };
  }
}