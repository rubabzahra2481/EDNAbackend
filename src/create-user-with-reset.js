/**
 * Create User with Reset Password Email
 * 
 * After quiz OTP verification, this creates a Supabase user without password
 * and sends a reset password email for the user to set their password.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Initialize Supabase Admin Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase configuration');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Create user account and send reset password email
 * @param {string} email - User's email address
 * @param {string} firstName - User's first name (optional)
 * @param {string} lastName - User's last name (optional)
 * @param {object} metadata - Additional user metadata (optional)
 * @returns {Promise<{success: boolean, user: object, message: string}>}
 */
export async function createUserAndSendResetEmail(email, firstName = null, lastName = null, metadata = {}) {
  try {
    console.log(`\n📝 Creating Supabase user for: ${email}`);

    // Step 1: Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existingUsers.users.some(user => user.email === email);

    let userId;

    if (userExists) {
      console.log(`ℹ️  User already exists: ${email}`);
      
      // Get existing user ID
      const existingUser = existingUsers.users.find(user => user.email === email);
      userId = existingUser.id;

      // Update user metadata if provided
      if (firstName || lastName || Object.keys(metadata).length > 0) {
        const updateData = {
          user_metadata: {
            ...existingUser.user_metadata,
            first_name: firstName || existingUser.user_metadata?.first_name,
            last_name: lastName || existingUser.user_metadata?.last_name,
            ...metadata
          }
        };

        await supabaseAdmin.auth.admin.updateUserById(userId, updateData);
        console.log(`✅ Updated user metadata for: ${email}`);
      }

    } else {
      console.log(`📧 Creating new user: ${email}`);

      // Step 2: Create user WITHOUT password
      // This creates an "incomplete" account that requires password setup
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true, // Auto-confirm email since they verified with OTP
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          full_name: firstName && lastName ? `${firstName} ${lastName}` : null,
          created_via: 'edna_quiz',
          ...metadata
        }
      });

      if (createError) {
        console.error(`❌ Error creating user:`, createError);
        throw createError;
      }

      userId = newUser.user.id;
      console.log(`✅ User created successfully: ${email} (ID: ${userId})`);
    }

    // Step 3: Generate and send reset password email
    console.log(`📧 Sending reset password email to: ${email}`);

    const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`
      }
    });

    if (resetError) {
      console.error(`❌ Error generating reset password link:`, resetError);
      throw resetError;
    }

    console.log(`✅ Reset password email sent to: ${email}`);
    console.log(`   Reset link: ${resetData.properties.action_link}`);

    return {
      success: true,
      user: {
        id: userId,
        email: email
      },
      message: 'Account created successfully. Please check your email to set your password.',
      resetLink: resetData.properties.action_link // For testing/logging
    };

  } catch (error) {
    console.error(`❌ Error in createUserAndSendResetEmail for ${email}:`, error);
    
    return {
      success: false,
      message: error.message || 'Failed to create account. Please try again.',
      error: error
    };
  }
}

/**
 * Manually send reset password email to existing user
 * @param {string} email - User's email address
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendResetPasswordEmail(email) {
  try {
    console.log(`📧 Sending reset password email to: ${email}`);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`
      }
    });

    if (error) {
      console.error(`❌ Error sending reset password email:`, error);
      throw error;
    }

    console.log(`✅ Reset password email sent to: ${email}`);

    return {
      success: true,
      message: 'Password reset email sent successfully.'
    };

  } catch (error) {
    console.error(`❌ Error in sendResetPasswordEmail:`, error);
    
    return {
      success: false,
      message: error.message || 'Failed to send reset password email.'
    };
  }
}
