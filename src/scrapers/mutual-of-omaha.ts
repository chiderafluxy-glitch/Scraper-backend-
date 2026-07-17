import { chromium, Browser, Page } from 'playwright';
import { supabaseAdmin, RawAgentRecord } from '../lib/supabase';
import { normalizePhoneE164 } from '../lib/phone';

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

const BASE_URL = 'https://agents.mutualofomaha.com';
const SCRAPER_DELAY_MS = { min: 1000, max: 3000 };

function randomDelay(): Promise<void> {
  const delay = Math.random() * (SCRAPER_DELAY_MS.max - SCRAPER_DELAY_MS.min) + SCRAPER_DELAY_MS.min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function extractAgentIdFromUrl(url: string): Promise<string> {
  const parts = url.split('/');
  return parts[parts.length - 1] || '';
}

async function scrapeAgentProfile(page: Page, agentUrl: string): Promise<AgentProfile | null> {
  try {
    await page.goto(agentUrl, { waitUntil: 'networkidle' });
    await randomDelay();
    
    // Extract agent data from the profile page
    const name = await page.locator('h1').first().textContent() || 
                 await page.locator('[class*="name"]').first().textContent() ||
                 'Unknown';
    
    // Get phone numbers from tel: links
    const phoneLinks = page.locator('a[href^="tel:"]');
    const phones: string[] = [];
    const phoneCount = await phoneLinks.count();
    
    for (let i = 0; i < Math.min(phoneCount, 2); i++) {
      const href = await phoneLinks.nth(i).getAttribute('href');
      if (href) {
        phones.push(href.replace('tel:', '').replace(/[^\d+]/g, ''));
      }
    }
    
    // Get email
    const emailLink = page.locator('a[href^="mailto:"]').first();
    const emailHref = await emailLink.getAttribute('href');
    const email = emailHref?.replace('mailto:', '') || null;
    
    // Get location info
    const stateSpan = page.locator('span:has-text("NE"), span:has-text("TX"), span:has-text("FL"), span:has-text("GA")').first();
    const state = await stateSpan.textContent() || 'Unknown';
    
    const zipSpan = page.locator('span:has-text("68118"), span:has-text("68132"), span:has-text("7")').first();
    const zip = await zipSpan.textContent() || '';
    
    // Get city from breadcrumb
    const cityLink = page.locator('a[href*="/agents/"][href*="/"]').last();
    const city = await cityLink.textContent() || 'Unknown';
    
    return {
      name: name.trim(),
      phone: phones[0] || null,
      email,
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      profileUrl: agentUrl,
      agentId: await extractAgentIdFromUrl(agentUrl)
    };
  } catch (error) {
    console.error(`Error scraping agent profile ${agentUrl}:`, error);
    return null;
  }
}

async function searchByZip(page: Page, zip: string): Promise<AgentProfile[]> {
  const agents: AgentProfile[] = [];
  
  try {
    // Navigate to search page
    await page.goto(`${BASE_URL}/agents/search`, { waitUntil: 'networkidle' });
    await randomDelay();
    
    // Enter ZIP code
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="location"], input[placeholder*="location"]');
    await searchInput.fill(zip);
    await randomDelay();
    
    // Press Enter or click search
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await randomDelay();
    
    // Get agent links
    const agentLinks = page.locator('a[href*="/agents/"]').filter({ hasText: '' });
    const count = await agentLinks.count();
    
    for (let i = 0; i < Math.min(count, 20); i++) {
      const href = await agentLinks.nth(i).getAttribute('href');
      if (href && !href.includes('/agents/search')) {
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        const agent = await scrapeAgentProfile(page, fullUrl);
        if (agent) {
          agents.push(agent);
        }
      }
    }
  } catch (error) {
    console.error(`Error searching by ZIP ${zip}:`, error);
  }
  
  return agents;
}

async function searchByState(page: Page, state: string): Promise<AgentProfile[]> {
  const agents: AgentProfile[] = [];
  
  try {
    // Navigate to state page
    await page.goto(`${BASE_URL}/agents/${state.toLowerCase()}`, { waitUntil: 'networkidle' });
    await randomDelay();
    
    // Get city links
    const cityLinks = page.locator(`a[href*="/agents/${state.toLowerCase()}/"]`);
    const cityCount = await cityLinks.count();
    
    // Sample cities if there are many
    const maxCities = Math.min(cityCount, 50);
    const cities: string[] = [];
    
    for (let i = 0; i < maxCities; i++) {
      const href = await cityLinks.nth(i).getAttribute('href');
      if (href) {
        cities.push(href);
      }
    }
    
    // Scrape each city
    for (const cityPath of cities) {
      const fullUrl = cityPath.startsWith('http') ? cityPath : `${BASE_URL}${cityPath}`;
      await page.goto(fullUrl, { waitUntil: 'networkidle' });
      await randomDelay();
      
      // Get agent links on city page
      const agentLinks = page.locator(`a[href*="/agents/${state.toLowerCase()}/"]`);
      const agentCount = await agentLinks.count();
      
      for (let i = 0; i < Math.min(agentCount, 20); i++) {
        const href = await agentLinks.nth(i).getAttribute('href');
        if (href && !href.includes('/agents/search') && !href.match(/\/[a-z]{2}\/[a-z-]+$/)) {
          const fullAgentUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const agent = await scrapeAgentProfile(page, fullAgentUrl);
          if (agent) {
            agents.push(agent);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error searching by state ${state}:`, error);
  }
  
  return agents;
}

export async function scrapeMutualOfOmaha(state?: string, zip?: string): Promise<RawAgentRecord[]> {
  let browser: Browser | null = null;
  const records: RawAgentRecord[] = [];
  
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    if (zip) {
      const agents = await searchByZip(page, zip);
      for (const agent of agents) {
        records.push({
          id: '',
          source: 'mutual_of_omaha',
          source_agent_id: agent.agentId,
          full_name: agent.name,
          phone: agent.phone,
          email: agent.email,
          city: agent.city,
          state: agent.state,
          zip: agent.zip,
          license_lines: 'Life Insurance',
          scraped_at: new Date().toISOString(),
          raw_payload: agent as unknown as Record<string, unknown>
        });
      }
    } else if (state) {
      const agents = await searchByState(page, state);
      for (const agent of agents) {
        records.push({
          id: '',
          source: 'mutual_of_omaha',
          source_agent_id: agent.agentId,
          full_name: agent.name,
          phone: agent.phone,
          email: agent.email,
          city: agent.city,
          state: agent.state,
          zip: agent.zip,
          license_lines: 'Life Insurance',
          scraped_at: new Date().toISOString(),
          raw_payload: agent as unknown as Record<string, unknown>
        });
      }
    } else {
      // Scrape all target states
      for (const targetState of ['TX', 'FL', 'GA']) {
        const agents = await searchByState(page, targetState);
        for (const agent of agents) {
          records.push({
            id: '',
            source: 'mutual_of_omaha',
            source_agent_id: agent.agentId,
            full_name: agent.name,
            phone: agent.phone,
            email: agent.email,
            city: agent.city,
            state: agent.state,
            zip: agent.zip,
            license_lines: 'Life Insurance',
            scraped_at: new Date().toISOString(),
            raw_payload: agent as unknown as Record<string, unknown>
          });
        }
      }
    }
    
    await browser.close();
  } catch (error) {
    console.error('Error in Mutual of Omaha scraper:', error);
    if (browser) await browser.close();
    throw error;
  }
  
  return records;
}

export async function saveRawRecords(records: RawAgentRecord[]): Promise<number> {
  let savedCount = 0;
  
  for (const record of records) {
    try {
      const { error } = await supabaseAdmin
        .from('raw_agent_records')
        .upsert({
          source: record.source,
          source_agent_id: record.source_agent_id,
          full_name: record.full_name,
          phone: record.phone,
          email: record.email,
          city: record.city,
          state: record.state,
          zip: record.zip,
          license_lines: record.license_lines,
          raw_payload: record.raw_payload
        }, {
          onConflict: 'source,source_agent_id'
        });
      
      if (!error) {
        savedCount++;
      }
    } catch (error) {
      console.error('Error saving raw record:', error);
    }
  }
  
  return savedCount;
}

// CLI runner
if (require.main === module) {
  const state = process.argv[2];
  const zip = process.argv[3];
  
  console.log(`Starting Mutual of Omaha scraper... State: ${state || 'all'}, ZIP: ${zip || 'N/A'}`);
  
  scrapeMutualOfOmaha(state, zip)
    .then(async (records) => {
      console.log(`Found ${records.length} agent records`);
      const saved = await saveRawRecords(records);
      console.log(`Saved ${saved} raw records to database`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Scraper failed:', error);
      process.exit(1);
    });
}
