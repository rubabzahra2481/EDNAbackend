import puppeteer from 'puppeteer';

/**
 * Generate PDF from HTML content
 */
export async function generatePDFFromHTML(htmlContent, outputPath) {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
    });
    
    console.log('✅ PDF generated:', outputPath);
    return { success: true, path: outputPath };
    
  } catch (error) {
    console.error('❌ Error generating PDF:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Create HTML template for E-DNA Results
 */
export function createResultsHTML(results) {
  const coreType = results.core_type || 'architect';
  const subtype = results.subtype || 'Custom Profile';
  const userName = results.name || 'User';
  
  const colors = {
    architect: { primary: '#667eea', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    alchemist: { primary: '#f093fb', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    blurred: { primary: '#4facfe', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }
  };
  
  const colorScheme = colors[coreType] || colors.architect;
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>E-DNA Results - ${subtype}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      background: #f5f5f5;
    }
    .container { 
      max-width: 800px; 
      margin: 0 auto; 
      padding: 40px 20px; 
    }
    .header { 
      background: ${colorScheme.gradient}; 
      color: white; 
      padding: 50px 40px; 
      text-align: center; 
      border-radius: 15px; 
      margin-bottom: 40px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
    }
    .header h1 { 
      font-size: 42px; 
      margin-bottom: 15px; 
      font-weight: 700;
    }
    .header .subtype {
      font-size: 28px;
      margin-top: 20px;
      font-weight: 600;
      opacity: 0.95;
    }
    .section { 
      background: white; 
      padding: 35px; 
      margin-bottom: 25px; 
      border-radius: 12px; 
      border-left: 5px solid ${colorScheme.primary};
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
    }
    .section h2 { 
      color: ${colorScheme.primary}; 
      font-size: 26px; 
      margin-bottom: 20px;
      font-weight: 600;
    }
    .metric {
      margin: 20px 0;
    }
    .metric h3 {
      font-size: 16px;
      margin-bottom: 10px;
      color: #555;
      font-weight: 600;
    }
    .progress-bar { 
      background: #e8e8e8; 
      height: 30px; 
      border-radius: 15px; 
      overflow: hidden;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
    }
    .progress-fill { 
      background: ${colorScheme.gradient}; 
      height: 100%; 
      display: flex; 
      align-items: center; 
      justify-content: flex-end; 
      padding-right: 15px; 
      color: white; 
      font-weight: bold;
      font-size: 14px;
      transition: width 0.3s ease;
    }
    .info-box {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      margin: 15px 0;
      border-left: 3px solid ${colorScheme.primary};
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding: 30px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.08);
    }
    .footer p {
      color: #666;
      font-size: 14px;
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Entrepreneurial DNA Results</h1>
      <p style="font-size: 18px; opacity: 0.9;">Personalized Assessment for ${userName}</p>
      <div class="subtype">${subtype}</div>
      <p style="margin-top: 10px; font-size: 16px; opacity: 0.85;">Core Type: ${coreType.toUpperCase()}</p>
    </div>
    
    <div class="section">
      <h2>📊 Your Core Metrics</h2>
      
      <div class="metric">
        <h3>Decision Mastery</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${results.decision_mastery || 0}%">
            ${results.decision_mastery || 0}%
          </div>
        </div>
      </div>
      
      <div class="metric">
        <h3>Core Level</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${results.core_level || 0}%">
            ${results.core_level || 0}%
          </div>
        </div>
      </div>
      
      <div class="metric">
        <h3>Mirror Pair Awareness</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${results.mirror_awareness || 0}%">
            ${results.mirror_awareness || 0}%
          </div>
        </div>
      </div>
      
      <div class="metric">
        <h3>Integration Level</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${results.integration_level || 0}%">
            ${results.integration_level || 0}%
          </div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <h2>🎯 Your Profile</h2>
      <div class="info-box">
        <p><strong>Core Type:</strong> ${coreType.toUpperCase()}</p>
        <p style="margin-top: 10px;"><strong>Subtype:</strong> ${subtype}</p>
        <p style="margin-top: 15px; color: #666;">
          This comprehensive assessment reveals your unique entrepreneurial DNA,
          helping you understand your natural strengths and growth opportunities.
        </p>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Brandscaling</strong></p>
      <p>Entrepreneurial DNA Assessment</p>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} Brandscaling. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

export default { generatePDFFromHTML, createResultsHTML };

