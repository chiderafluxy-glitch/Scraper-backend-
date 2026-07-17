import { chromium, Browser } from 'playwright';
import { RawAgentRecord } from '../lib/supabase';

const SCRAPER_DELAY_MS = { min: 1000, max: 3000 };

function randomDelay(): Promise<void> {
  const delay = Math.random() * (SCRAPER_DELAY_MS.max - SCRAPER_DELAY_MS.min) + SCRAPER_DELAY_MS.min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

export async function scrapeAllstate(state: string, city: string): Promise<RawAgentRecord[]> {
  let browser: Browser | null = null;
  const records: RawAgentRecord[] = [];
  
  try {
    console.log(`[ALLSTATE] Starting scrape for ${city}, ${state}`);
    
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Allstate agent finder URL
    const searchUrl = `https://www.allstate.com/agent/${state.toLowerCase()}/${city.toLowerCase().replace(/ /g, '-')}.aspx`;
    console.log(`[ALLSTATE] Navigating to: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay();
    
    // Try to find agent cards/listings
    const agentCards = await page.locator('[class*="agent"], [class*="Agent"], a[href*="/agent/"]').evaluateAll(elements => 
      elements.slice(0, 50).map(el => ({
        href: (el as any).href || '',
        text: el.textContent?.trim().substring(0, 100) || ''
      }))
    );
    
    console.log(`[ALLSTATE] Found ${agentCards.length} potential agent elements`);
    
    // Look for agent links
    const agentLinks = agentCards.filter(c => c.href && c.href.includes('/agent/'));
    
    for (const link of agentLinks.slice(0, 30)) {
      try {
        await page.goto(link.href, { waitUntil: 'networkidle', timeout: 20000 });
        await randomDelay();
        
        const name = await page.locator('h1, [class*="name"], [class*="agent-name"], [class*="full-name"]').first().textContent().catch(() => null);
        const phone = await page.locator('a[href^="tel:"], [class*="phone"], [class*="tel"]').first().textContent().catch(() => null);
        const email = await page.locator('a[href^="mailto:"]').first().textContent().catch(() => null);
        const addressCity = await page.locator('[class*="city"], [class*="locality"]').first().textContent().catch(() => city);
        const addressState = await page.locator('[class*="state"], [class*="region"]').first().textContent().catch(() => state);
        const addressZip = await page.locator('[class*="zip"], [class*="postal"]').first().textContent().catch(() => '');
        
        if (name) {
          const agentId = link.href.split('/').pop()?.replace('.aspx', '') || '';
          records.push({
            id: '',
            source: 'allstate',
            source_agent_id: agentId,
            full_name: name.trim(),
            phone: phone?.replace(/[^\d]/g, '').substring(0, 10) || null,
            email: email?.trim() || null,
            city: addressCity?.trim() || city,
            state: addressState?.trim() || state,
            zip: addressZip?.replace(/[^\d-]/g, '').trim() || '',
            profile_url: link.href,
            raw_data: null
          });
        }
      } catch (e) {
        console.log(`[ALLSTATE] Error processing agent: ${e}`);
      }
    }
    
    console.log(`[ALLSTATE] Extracted ${records.length} agents`);
    await browser.close();
    return records;
    
  } catch (error) {
    console.error(`[ALLSTATE] Error scraping ${city}, ${state}:`, error);
    if (browser) await browser.close();
    return records;
  }
}
