import puppeteer from 'puppeteer';

/**
 * Generate PDF from the actual EDNAResultsPage React component
 * This visits the frontend URL and captures the rendered component as PDF
 */
export async function generatePDFFromComponent(results, outputPath, frontendUrl = 'http://localhost:3000') {
  let browser;

  try {
    console.log('1️⃣ Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2
    });

    console.log('2️⃣ Navigating to frontend...');

    // Encode results as URL parameter
    const resultsEncoded = encodeURIComponent(JSON.stringify(results));
    const pdfUrl = `${frontendUrl}/pdf-results?data=${resultsEncoded}`;

    await page.goto(pdfUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    console.log('3️⃣ Waiting for component to render...');

    // Wait for the main content to be visible (data attribute)
    // Increased timeout and made it more flexible
    try {
      await page.waitForSelector('[data-pdf-content="true"]', { timeout: 30000 });
    console.log('   ✓ Found data-pdf-content attribute');
    } catch (error) {
      console.log('   ⚠️ data-pdf-content not found, checking for any content...');
      // Fallback: wait for any content to appear
      await page.waitForSelector('body > *', { timeout: 10000 });
      console.log('   ✓ Found page content (fallback)');
    }

    // Wait for specific content (hero section) to ensure full rendering
    try {
      await page.waitForSelector('.hero-section', { timeout: 20000 });
      console.log('   ✓ Found hero-section');
    } catch (error) {
      console.log('   ⚠️ Hero section not found, continuing anyway...');
    }

    // Give extra time for images, fonts, and charts to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('   ✓ Additional wait time completed');

    console.log('4️⃣ Generating PDF...');

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });

    console.log('✅ PDF generated from React component:', outputPath);
    return { success: true, path: outputPath };

  } catch (error) {
    console.error('❌ Error generating PDF from component:', error);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
