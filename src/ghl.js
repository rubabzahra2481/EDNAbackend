import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GHL_API_URL = 'https://rest.gohighlevel.com/v1';
const GHL_INBOUND_WEBHOOK_URL = process.env.GHL_INBOUND_WEBHOOK_URL || 'https://services.leadconnectorhq.com/hooks/GUAsdl1r4AN8xBT6u61i/webhook-trigger/25fd04e5-0e38-4cec-a2e0-58fd4ff69fa6';

/**
 * Send email via GoHighLevel with PDF link
 */
export async function sendGHLEmailWithPDF(email, name, pdfUrl, results) {
  try {
    const apiKey = process.env.GHL_API_KEY;
    
    if (!apiKey || apiKey === 'your-ghl-api-key-here') {
      console.warn('⚠️ GHL_API_KEY not configured - skipping email');
      return {
        success: false,
        error: 'GHL API key not configured',
        skipped: true
      };
    }
    
    const emailHTML = createEmailHTML(name, pdfUrl, results);
    
    const response = await axios.post(
      `${GHL_API_URL}/conversations/messages/email`,
      {
        type: 'Email',
        contactId: await getOrCreateContact(email, name),
        html: emailHTML,
        subject: `Your E-DNA Results: ${results.subtype || results.core_type}`,
        from: process.env.GHL_SENDER_EMAIL || 'noreply@brandscaling.com',
        fromName: process.env.GHL_SENDER_NAME || 'Brandscaling'
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ GHL email sent successfully');
    
    return {
      success: true,
      messageId: response.data.id
    };
    
  } catch (error) {
    console.error('❌ Error sending GHL email:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

async function getOrCreateContact(email, name) {
  const apiKey = process.env.GHL_API_KEY;
  
  try {
    const searchResponse = await axios.get(
      `${GHL_API_URL}/contacts/`,
      {
        params: { email },
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }
    );
    
    if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
      return searchResponse.data.contacts[0].id;
    }
    
    const createResponse = await axios.post(
      `${GHL_API_URL}/contacts/`,
      { email, name, source: 'E-DNA Quiz' },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return createResponse.data.contact.id;
    
  } catch (error) {
    console.error('Error with GHL contact:', error.response?.data || error.message);
    throw error;
  }
}

function createEmailHTML(name, pdfUrl, results) {
  const coreType = results.core_type || 'architect';
  const colors = {
    architect: '#667eea',
    alchemist: '#f093fb',
    blurred: '#4facfe'
  };
  const primaryColor = colors[coreType] || colors.architect;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, ${adjustColor(primaryColor, -20)} 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Your E-DNA Results Are Ready!</h1>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px;">
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Hi ${name},
              </p>
              
              <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">
                Thank you for completing your payment! Your complete E-DNA assessment results are now available.
              </p>
              
              <div style="background-color: #f9f9f9; border-left: 4px solid ${primaryColor}; padding: 20px; margin: 30px 0;">
                <h2 style="color: ${primaryColor}; margin: 0 0 10px 0; font-size: 24px;">
                  ${results.subtype || 'Your Profile'}
                </h2>
                <p style="color: #666666; margin: 0; font-size: 14px;">
                  Core Type: <strong>${(results.core_type || 'architect').toUpperCase()}</strong>
                </p>
              </div>
              
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${pdfUrl}" style="display: inline-block; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 5px; font-size: 16px; font-weight: bold;">
                      Download Your Complete Results (PDF)
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="font-size: 14px; color: #666666; margin: 30px 0 0 0; text-align: center;">
                This link will be available for 7 days. Make sure to download your results!
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="font-size: 14px; color: #666666; margin: 0 0 10px 0;">
                <strong>Brandscaling</strong><br>
                Entrepreneurial DNA Assessment
              </p>
              <p style="font-size: 12px; color: #999999; margin: 0;">
                © ${new Date().getFullYear()} Brandscaling. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

function adjustColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255))
    .toString(16).slice(1);
}

/**
 * Notify GHL via inbound webhook with download link
 * This triggers a GHL workflow that sends the email with the time-limited download link
 * @param {Object} params - { email, name, downloadLink, ednaType, coreType }
 */
export async function notifyGhlWithDownloadLink({ email, name, downloadLink, ednaType, coreType }) {
  try {
    // Validate required parameters
    if (!email || !downloadLink) {
      const errorMsg = 'Missing required parameters: email and downloadLink are required';
      console.error('❌ GHL webhook notification failed:', errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }

    console.log(`📤 Notifying GHL webhook for ${email}...`);
    console.log(`   Download Link: ${downloadLink}`);
    console.log(`   E-DNA Type: ${ednaType || 'Not provided'}`);
    console.log(`   Core Type: ${coreType || 'Not provided'}`);

    // Build the complete payload
    const payload = {
      email: email,
      name: name || email.split('@')[0], // Use email prefix as fallback name
      downloadLink: downloadLink,
      ednaType: ednaType || 'Unknown',
      coreType: coreType || 'Unknown',
      timestamp: new Date().toISOString()
    };

    // Log the complete payload before sending
    console.log('📦 Webhook Payload:', JSON.stringify(payload, null, 2));

    // POST to GHL inbound webhook
    const response = await axios.post(
      GHL_INBOUND_WEBHOOK_URL,
      payload,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    console.log('✅ GHL webhook notified successfully');
    console.log('   Response status:', response.status);
    console.log('   Response data:', JSON.stringify(response.data, null, 2));

    return {
      success: true,
      status: response.status,
      data: response.data
    };

  } catch (error) {
    console.error('❌ Error notifying GHL webhook:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

export default { sendGHLEmailWithPDF, notifyGhlWithDownloadLink };

