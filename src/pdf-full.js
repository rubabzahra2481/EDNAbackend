import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate full E-DNA Results Page PDF (complete report)
 * This generates the FULL EDNAResultsPage, not just a summary
 */
export async function generateFullResultsPDF(results, outputPath) {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Create full HTML with all sections
    const htmlContent = createFullResultsHTML(results);
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' }
    });
    
    console.log('✅ Full Results PDF generated:', outputPath);
    return { success: true, path: outputPath };
    
  } catch (error) {
    console.error('❌ Error generating full PDF:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Create FULL HTML for complete E-DNA Results Page
 * This matches the EDNAResultsPage component
 */
function createFullResultsHTML(results) {
  const {
    core_type = 'architect',
    subtype = 'Custom Profile',
    decision_mastery = 0,
    core_level = 0,
    mirror_awareness = 0,
    integration_level = 0,
    name = 'User'
  } = results;

  // Color schemes
  const colors = {
    architect: {
      primary: '#7c3aed',
      secondary: '#6d28d9',
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
    },
    alchemist: {
      primary: '#f97316',
      secondary: '#ea580c',
      gradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
    },
    blurred: {
      primary: '#7c3aed',
      secondary: '#f97316',
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #f97316 100%)'
    }
  };

  const colorScheme = colors[core_type] || colors.architect;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>E-DNA Complete Results - ${subtype}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6; 
      color: #1f2937; 
      background: #ffffff;
    }
    .page {
      padding: 30px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    /* Header */
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding: 40px 20px;
      background: ${colorScheme.gradient};
      color: white;
      border-radius: 16px;
    }
    .header h1 {
      font-size: 48px;
      font-weight: 800;
      margin-bottom: 10px;
    }
    .header .subtype {
      font-size: 24px;
      opacity: 0.95;
      margin-top: 10px;
    }
    
    /* Progress Bars */
    .progress-section {
      margin: 30px 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .progress-item {
      text-align: center;
    }
    .progress-label {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .progress-value {
      font-size: 32px;
      font-weight: 800;
      color: #1f2937;
      margin-bottom: 5px;
    }
    .progress-bar {
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: ${colorScheme.gradient};
      border-radius: 4px;
    }
    
    /* Sections */
    .section {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 20px;
      font-weight: 700;
      color: white;
      background: ${colorScheme.primary};
      padding: 12px 20px;
      margin: -30px -30px 25px -30px;
      border-radius: 10px 10px 0 0;
    }
    .section-content {
      font-size: 14px;
      line-height: 1.8;
      color: #374151;
    }
    
    /* Core Identity */
    .core-identity {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
    }
    .decision-loop {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid ${colorScheme.primary};
    }
    .decision-loop h3 {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 15px;
      color: #1f2937;
    }
    .decision-steps {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 15px 0;
    }
    .decision-step {
      background: ${colorScheme.primary};
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
    }
    .arrow {
      color: #9ca3af;
      font-size: 18px;
    }
    
    /* Mirror Pair */
    .mirror-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 20px;
    }
    .mirror-box {
      padding: 15px;
      border-radius: 8px;
      border: 2px solid #e5e7eb;
    }
    .mirror-box h4 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 10px;
      color: ${colorScheme.primary};
    }
    .mirror-box p {
      font-size: 13px;
      line-height: 1.6;
      color: #6b7280;
    }
    
    /* Subtype Identity */
    .subtype-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 20px;
    }
    .subtype-box {
      padding: 15px;
      border-radius: 8px;
      background: #f9fafb;
    }
    .subtype-box h4 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #1f2937;
    }
    .subtype-box p {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
    }
    .strength {
      color: #059669;
    }
    .risk {
      color: #dc2626;
    }
    
    /* Learning Styles */
    .learning-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 20px;
    }
    .learning-box {
      text-align: center;
      padding: 15px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
    }
    .learning-box h4 {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 5px;
      font-weight: 600;
    }
    .learning-box p {
      font-size: 14px;
      font-weight: 700;
      color: ${colorScheme.primary};
    }
    
    /* Personality Traits */
    .trait-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 20px;
    }
    .trait-box {
      padding: 15px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      text-align: center;
    }
    .trait-box h4 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #1f2937;
    }
    .trait-box .label {
      font-size: 12px;
      color: ${colorScheme.primary};
      font-weight: 600;
    }
    .trait-box p {
      font-size: 12px;
      color: #6b7280;
      margin-top: 8px;
      line-height: 1.4;
    }
    
    /* Footer */
    .footer {
      text-align: center;
      margin-top: 40px;
      padding: 30px;
      border-top: 2px solid #e5e7eb;
    }
    .footer p {
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="header">
      <h1>The ${core_type.charAt(0).toUpperCase() + core_type.slice(1)}</h1>
      <div class="subtype">${subtype}</div>
      <p style="margin-top: 15px; font-size: 16px; opacity: 0.9;">
        You're someone who understands people and situations on a deep, emotional level.
      </p>
    </div>

    <!-- Progress Bars -->
    <div class="progress-section">
      <div class="progress-item">
        <div class="progress-label">Decision Mastery</div>
        <div class="progress-value">${decision_mastery}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${decision_mastery}%"></div>
        </div>
      </div>
      <div class="progress-item">
        <div class="progress-label">Core Level</div>
        <div class="progress-value">${core_level}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${core_level}%"></div>
        </div>
      </div>
      <div class="progress-item">
        <div class="progress-label">Mirror Pair Awareness</div>
        <div class="progress-value">${mirror_awareness}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${mirror_awareness}%"></div>
        </div>
      </div>
      <div class="progress-item">
        <div class="progress-label">Integration</div>
        <div class="progress-value">${integration_level}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${integration_level}%"></div>
        </div>
      </div>
    </div>

    <!-- Core Identity -->
    <div class="section">
      <div class="section-title">Core Identity</div>
      <div class="core-identity">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 15px;">${core_type.charAt(0).toUpperCase() + core_type.slice(1)}</h3>
          <div class="decision-loop">
            <h3>Default Decision Loop</h3>
            <div class="decision-steps">
              <div class="decision-step">${core_type === 'architect' ? 'Logic' : 'Emotion'}</div>
              <span class="arrow">→</span>
              <div class="decision-step">${core_type === 'architect' ? 'Emotion' : 'Logic'}</div>
              <span class="arrow">→</span>
              <div class="decision-step">${core_type === 'architect' ? 'Logic' : 'Emotion'}</div>
            </div>
            <p style="margin-top: 15px; font-size: 13px; color: #6b7280;">
              ${core_type === 'architect' ? 'Logic overrides and validates your decisions.' : 'Emotion overrides and validates your decisions.'}
            </p>
          </div>
        </div>
        <div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 15px;">Mirror Pair Awareness</h3>
          <div class="mirror-grid">
            <div class="mirror-box">
              <h4>Where You Struggle</h4>
              <p>You prioritize feelings and how you can struggle with structure, boundaries, and timelines.</p>
            </div>
            <div class="mirror-box">
              <h4>Where They Struggle</h4>
              <p>They value efficiency and structure but may overlook empathy and emotional needs.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Subtype Identity -->
    <div class="section">
      <div class="section-title">Subtype Identity</div>
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 10px; color: ${colorScheme.primary};">${subtype}</h3>
      <p style="margin-bottom: 20px; color: #6b7280;">
        You intuitively sense emotions and connections before they're spoken or seen.
      </p>
      <div class="subtype-grid">
        <div class="subtype-box">
          <h4 class="strength">✓ Strengths</h4>
          <p>You sense hidden emotions, create connection, and bring calm to any situation.</p>
        </div>
        <div class="subtype-box">
          <h4 class="risk">⚠ Risks and Blind Spots</h4>
          <p>You sometimes absorb others' emotions and avoid conflict, losing your own clarity.</p>
        </div>
      </div>
    </div>

    <!-- Learning Style Preferences -->
    <div class="section">
      <div class="section-title">Learning Style Preferences</div>
      <div class="learning-grid">
        <div class="learning-box">
          <h4>Modality Preference</h4>
          <p>Visual</p>
        </div>
        <div class="learning-box">
          <h4>Approach</h4>
          <p>Sequential</p>
        </div>
        <div class="learning-box">
          <h4>Concept Processing</h4>
          <p>Abstract</p>
        </div>
        <div class="learning-box">
          <h4>Working Environment</h4>
          <p>Individual</p>
        </div>
        <div class="learning-box">
          <h4>Pace</h4>
          <p>Flexible</p>
        </div>
      </div>
    </div>

    <!-- Neurodiversity -->
    <div class="section">
      <div class="section-title">Neurodiversity</div>
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 10px;">Neurodivergent</h3>
      <p style="color: #6b7280; line-height: 1.8;">
        You may prefer short, engaging bursts of activity and sometimes struggle with sustained focus or time management. 
        If flagged, this could suggest probable signs of ADHD-related patterns in how you focus, shift attention, or need stimulation.
      </p>
      <p style="margin-top: 15px; font-size: 12px; color: #9ca3af; font-style: italic;">
        *This is just a screening test to better understand possible neurodivergent traits*
      </p>
    </div>

    <!-- Mindset and Personality -->
    <div class="section">
      <div class="section-title">Mindset and Personality</div>
      <div class="trait-grid">
        <div class="trait-box">
          <h4>Mindset</h4>
          <div class="label">Growth Mindset</div>
          <p>You view challenges as opportunities to grow and treat setbacks as lessons.</p>
        </div>
        <div class="trait-box">
          <h4>Risk Tolerance</h4>
          <div class="label">Moderate Risk Tolerance</div>
          <p>You move thoughtfully, testing and learning before fully committing.</p>
        </div>
        <div class="trait-box">
          <h4>Extraversion</h4>
          <div class="label">Ambivert (Balanced)</div>
          <p>You adapt easily, working well both collaboratively and independently.</p>
        </div>
      </div>
    </div>

    <!-- Meta-Beliefs and Values -->
    <div class="section">
      <div class="section-title">Meta-Beliefs and Values</div>
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 10px; color: ${colorScheme.primary};">
        Mission-Driven and Profit-Focused
      </h3>
      <p style="color: #6b7280; line-height: 1.8;">
        You're guided by purpose, driven to create meaningful impact. You prioritize results, 
        turning strategy and effort into tangible success.
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p style="font-weight: 700; font-size: 16px; color: #1f2937; margin-bottom: 5px;">Brandscaling</p>
      <p>Entrepreneurial DNA Assessment</p>
      <p style="margin-top: 15px; font-size: 12px; color: #9ca3af;">
        © ${new Date().getFullYear()} Brandscaling. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

export default { generateFullResultsPDF };

