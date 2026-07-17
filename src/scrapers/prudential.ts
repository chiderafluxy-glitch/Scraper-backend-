import { chromium, Browser, Page } from 'playwright';
import { supabaseAdmin, RawAgentRecord } from '../lib/supabase';

interface AgentProfile {
  name: string;
  phone: string | null;
  email: string | null;
  city: string;
  state: string;
  zip: string;
  profileUrl: string;
  agentId: string;
}

const SCRAPER_DELAY_MS = { min: 1000, max: 3000 };

function randomDelay(): Promise<void> {
  const delay = Math.random() * (SCRAPER_DELAY_MS.max - SCRAPER_DELAY_MS.min) + SCRAPER_DELAY_MS.min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

export async function scrapePrudential(state: string, city: string): Promise<number> {
  let browser: Browser | null = null;
  
  try {
    console.log(`[PRUDENTIAL] Starting scrape for ${city}, ${state}`);
    
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Prudential agent finder URL
    const searchUrl = `https://www.prudential.com/financial-advisor/${state.toLowerCase()}/${city.toLowerCase().replace(/ /g, '-')}`;
    console.log(`[PRUDENTIAL] Navigating to: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay();
    
    const agents: AgentProfile[] = [];
    
    // Try to find agent cards/listings
    const agentLinks = await page.locator('a[href*="/advisor/"], a[href*="/agent/"]').evaluateAll(links => 
      links.map(link => ({
        href: link.href,
        text: link.textContent?.trim() || ''
      }))
    );
    
    console.log(`[PRUDENTIAL] Found ${agentLinks.length} potential agent links`);
    
    for (const link of agentLinks.slice(0, 30)) {
      if (!link.href || link.href === 'javascript:void(0)' || link.href === '#') continue;
      
      try {
        await page.goto(link.href, { waitUntil: 'networkidle', timeout: 20000 });
        await randomDelay();
        
        const name = await page.locator('h1, [class*="name"], [class*="advisor-name"], [class*="agent-name"]').first().textContent().catch(() => null);
        const phone = await page.locator('a[href^="tel:"], [class*="phone"]').first().textContent().catch(() => null);
        const email = await page.locator('a[href^="mailto:"]').first().textContent().catch(() => null);
        const addressCity = await page.locator('[class*="city"], [class*="locality"]').first().textContent().catch(() => city);
        const addressState = await page.locator('[class*="state"], [class*="region"]').first().textContent().catch(() => state);
        const addressZip = await page.locator('[class*="zip"], [class*="postal"]').first().textContent().catch(() => '');
        
        if (name) {
          agents.push({
            name: name.trim(),
            phone: phone?.replace(/[^\d]/g, '').substring(0, 10) || null,
            email: email?.trim() || null,
            city: addressCity?.trim() || city,
            state: addressState?.trim() || state,
            zip: addressZip?.replace(/[^\d-]/g, '').trim() || '',
            profileUrl: link.href,
            agentId: link.href.split('/').pop() || ''
          });
        }
      } catch (e) {
        console.log(`[PRUDENTIAL] Error processing agent: ${e}`);
      }
    }
    
    console.log(`[PRUDENTIAL] Extracted ${agents.length} agents`);
    
    // Save to raw records
    if (agents.length > 0) {
      const records: RawAgentRecord[] = agents.map(a => ({
        source: 'prudential',
        source_agent_id: a.agentId,
        full_name: a.name,
        phone: a.phone,
        email: a.email,
        city: a.city,
        state: a.state,
        zip: a.zip,
        profile_url: a.profileUrl,
        raw_data: a as any
      }));
      
      await supabaseAdmin.from('raw_agent_records').insert(records);
      console.log(`[PRUDENTIAL] Saved ${records.length} raw records`);
    }
    
    await browser.close();
    return agents.length;
    
  } catch (error) {
    console.error(`[PRUDENTIAL] Error scraping ${city}, ${state}:`, error);
    if (browser) await browser.close();
    return 0;
  }
}
