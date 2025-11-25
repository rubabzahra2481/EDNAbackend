import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// JWT secret for Agent access tokens (should be in .env)
const JWT_SECRET = process.env.AGENT_JWT_SECRET || 'your-secret-key-change-this-in-production';
const TOKEN_EXPIRY = '2h'; // 2 hour expiry

/**
 * Generate a lightweight JWT token for Agent iframe access
 * @param {string} userId - Supabase user ID
 * @returns {string} JWT token
 */
export function generateAgentToken(userId) {
  const payload = {
    userId,
    type: 'agent_access',
    iat: Math.floor(Date.now() / 1000),
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });

  return token;
}

/**
 * Verify an Agent access token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded payload or null if invalid
 */
export function verifyAgentToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check token type
    if (decoded.type !== 'agent_access') {
      console.log('❌ Invalid token type:', decoded.type);
      return null;
    }

    return decoded;
  } catch (error) {
    console.log('❌ Token verification failed:', error.message);
    return null;
  }
}

/**
 * Verify Supabase session and generate Agent access token
 * @param {string} supabaseAccessToken - Supabase auth token from frontend
 * @returns {object} { success, token, userId, error }
 */
export async function createAgentTokenFromSupabase(supabaseAccessToken) {
  try {
    // Verify the Supabase token and get user
    const { data: { user }, error } = await supabase.auth.getUser(supabaseAccessToken);

    if (error || !user) {
      console.log('❌ Supabase session verification failed:', error?.message);
      return {
        success: false,
        error: 'Invalid or expired Supabase session',
      };
    }

    console.log('✅ Supabase session verified for user:', user.id);

    // Generate lightweight Agent access token
    const agentToken = generateAgentToken(user.id);

    return {
      success: true,
      token: agentToken,
      userId: user.id,
      expiresIn: TOKEN_EXPIRY,
    };
  } catch (err) {
    console.error('❌ Error creating Agent token:', err);
    return {
      success: false,
      error: 'Failed to create Agent access token',
    };
  }
}

/**
 * Middleware to verify Agent access token from request
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
export function verifyAgentTokenMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const decoded = verifyAgentToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }

  // Attach user ID to request
  req.userId = decoded.userId;
  next();
}
