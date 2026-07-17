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

interface LocationData {
  city: string;
  state: string;
  zip: string;
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

/**
 * Extract location data (city, state, zip) using multiple strategies.
 * Primary: JSON-LD structured data
 * Fallback: Target common address container patterns
 * Diagnostic: Logs page structure if extraction fails
 */
async function extractLocationData(page: Page, agentUrl: string): Promise<LocationData> {
  const defaultLocation: LocationData = {
    city: 'Unknown',
    state: 'Unknown',
    zip: ''
  };

  try {
    // Strategy 1: Extract from JSON-LD structured data (most reliable)
    const jsonLdData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent || '');
          // Check for PostalAddress in different schema.org types
          if (data.address || (data['@type'] === 'Person' && data.address)) {
            return data.address;
          }
          // Handle nested address structures
          if (Array.isArray(data) && data[0]?.address) {
            return data[0].address;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
      return null;
    });

    if (jsonLdData) {
      console.log(`[DEBUG] Extracted JSON-LD address data from ${agentUrl}:`, jsonLdData);
      return {
        city: jsonLdData.addressLocality || jsonLdData.city || 'Unknown',
        state: jsonLdData.addressRegion || jsonLdData.state || 'Unknown',
        zip: jsonLdData.postalCode || jsonLdData.zip || ''
      };
    }

    // Strategy 2: Target common address container classes/attributes
    let city = 'Unknown';
    let state = 'Unknown';
    let zip = '';

    // Try class-based selectors (most common pattern)
    const cityElement = await page.locator('[class*="city"], [class*="locality"], span[itemprop="addressLocality"]').first();
    const stateElement = await page.locator('[class*="state"], [class*="region"], span[itemprop="addressRegion"]').first();
    const zipElement = await page.locator('[class*="zip"], [class*="postal"], span[itemprop="postalCode"]').first();

    if (await cityElement.count() > 0) {
      city = (await cityElement.textContent())?.trim() || 'Unknown';
    }

    if (await stateElement.count() > 0) {
      state = (await stateElement.textContent())?.trim() || 'Unknown';
    }

    if (await zipElement.count() > 0) {
      zip = (await zipElement.textContent())?.trim() || '';
    }

    // Strategy 3: Parse address from combined text patterns
    if (city === 'Unknown' || state === 'Unknown') {
      const addressContainer = await page.locator('[class*="address"]').first();
      if (await addressContainer.count() > 0) {
        const addressText = await addressContainer.textContent();
        if (addressText) {
          // Try to parse "City, State ZIP" pattern
          const match = addressText.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
          if (match) {
            city = match[1].trim();
            state = match[2];
            zip = match[3];
            console.log(`[DEBUG] Parsed address from text: "${addressText}" -> ${city}, ${state} ${zip}`);
          }
        }
      }
    }

    // Strategy 4: Final fallback - use breadcrumb navigation or URL path hints
    if (city === 'Unknown') {
      const breadcrumbLink = await page.locator('a[href*="/agents/"][href*="/"]').last();
      if (await breadcrumbLink.count() > 0) {
        const breadcrumbText = await breadcrumbLink.textContent();
        if (breadcrumbText) {
          city = breadcrumbText.trim();
          console.log(`[DEBUG] Extracted city from breadcrumb: ${city}`);
        }
      }
    }

    return { city, state, zip };
  } catch (error) {
    console.error(`[ERROR] Failed to extract location from ${agentUrl}:`, error);
    // Log page structure for debugging if extraction completely fails
    try {
      const htmlSnippet = await page.locator('body').evaluate((el) => {
        const addressLike = el.querySelector('[class*="address"], [class*="location"], [class*="contact"]');
        return addressLike ? addressLike.outerHTML.substring(0, 500) : 'No address-like element found';
      });
      console.log(`[DEBUG] Page HTML snippet for troubleshooting:\n${htmlSnippet}`);
    } catch (e) {
      // Silent fail on debug attempt
    }
    return defaultLocation;
  }
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
    
    // Extract location data using robust multi-strategy approach
    const location = await extractLocationData(page, agentUrl);
    
    return {
      name: name.trim(),
      phone: phones[0] || null,
      email,
      city: location.city,
      state: location.state,
      zip: location.zip,
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
  let consecutiveEmptyResults = 0;
  
  try {
    // Navigate to search page
    await page.goto(`${BASE_URL}/agents/search`, { waitUntil: 'networkidle' });
    await randomDelay();
    
    // Enter ZIP code — target the specific search-by-name-or-location input.
    // The broad selector previously used matched 4 different inputs on this page
    // (this one, plus unrelated "Search here..." widgets elsewhere on the page),
    // which trips Playwright's strict mode. Use the exact placeholder/aria-label
    // this input actually has, and fall back to a scoped attempt if the site changes it.
    let searchInput = page.getByPlaceholder('Search by name or location');
    if ((await searchInput.count()) === 0) {
      searchInput = page.getByRole('textbox', { name: 'Conduct a search' });
    }
    await searchInput.first().waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.first().fill(zip);
    await randomDelay();
    
    // Press Enter or click search
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await randomDelay();
    
    // Take a screenshot on zero results for debugging
    const agentLinks = page.locator('a[href*="/agents/"][href*="/tx/"], a[href*="/agents/"][href*="/fl/"], a[href*="/agents/"][href*="/ga/"]');
    const count = await agentLinks.count();
    
    if (count === 0) {
      await page.screenshot({ path: '/tmp/scraper-zero-results.png' });
      console.warn(`[WARNING] Zero results for ZIP ${zip} — screenshot saved to /tmp/scraper-zero-results.png`);
      console.warn(`[DEBUG] Current URL: ${page.url()}`);
      
      // Try alternative selectors to debug
      const allAgentLinks = page.locator('a[href*="/agents/"]');
      const allCount = await allAgentLinks.count();
      console.warn(`[DEBUG] Found ${allCount} total /agents/ links on page`);
      
      // Check if search actually returned results
      const bodyText = await page.locator('body').textContent();
      if (bodyText?.includes('No results') || bodyText?.includes('no results')) {
        console.warn(`[DEBUG] Page indicates no results found`);
      }
      
      consecutiveEmptyResults++;
      return agents;
    }
    
    console.log(`[ZIP: ${zip}] Found ${count} agent links`);
    
    for (let i = 0; i < Math.min(count, 20); i++) {
      const href = await agentLinks.nth(i).getAttribute('href');
      if (href) {
        const cleanHref = href.split('#')[0]; // Remove #contact fragment
        const fullUrl = new URL(cleanHref, BASE_URL).toString();
        const agent = await scrapeAgentProfile(page, fullUrl);
        if (agent) {
          agents.push(agent);
          consecutiveEmptyResults = 0;
        } else {
          consecutiveEmptyResults++;
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
  let consecutiveEmptyResults = 0;
  
  try {
    // Navigate to state page
    await page.goto(`${BASE_URL}/agents/${state.toLowerCase()}`, { waitUntil: 'networkidle' });
    await randomDelay();
    
    // Get city links
    const cityLinks = page.locator(`a[href*="/agents/${state.toLowerCase()}/"]`);
    const cityCount = await cityLinks.count();
    
    console.log(`[STATE: ${state}] Found ${cityCount} city links`);
    
    // Sample cities if there are many
    const maxCities = Math.min(cityCount, 50);
    const cities: string[] = [];
    
    for (let i = 0; i < maxCities; i++) {
      const href = await cityLinks.nth(i).getAttribute('href');
      if (href) {
        cities.push(href);
      }
    }
    
    // Scrape each city with zero-result monitoring
    for (let cityIndex = 0; cityIndex < cities.length; cityIndex++) {
      const cityPath = cities[cityIndex];
      const fullUrl = new URL(cityPath, BASE_URL).toString();
      
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle' });
        await randomDelay();
        
        // Get agent links on city page
        const agentLinks = page.locator(`a[href*="/agents/${state.toLowerCase()}/"]`);
        const agentCount = await agentLinks.count();
        
        let cityCityAgents = 0;
        for (let i = 0; i < Math.min(agentCount, 20); i++) {
          const href = await agentLinks.nth(i).getAttribute('href');
          if (href && !href.includes('/agents/search') && !href.match(/\/[a-z]{2}\/[a-z-]+$/)) {
            const fullAgentUrl = new URL(href, BASE_URL).toString();
            const agent = await scrapeAgentProfile(page, fullAgentUrl);
            if (agent) {
              agents.push(agent);
              cityCityAgents++;
              consecutiveEmptyResults = 0;
            }
          }
        }

        // Track zero-result cities
        if (agentCount === 0) {
          consecutiveEmptyResults++;
          console.warn(`[STATE: ${state}, CITY: ${cityIndex + 1}/${cities.length}] Zero agents found — selector may be broken`);
          
          // Alert after 5 consecutive empty results
          if (consecutiveEmptyResults >= 5) {
            console.error(`[CRITICAL WARNING] ${consecutiveEmptyResults} consecutive empty results in state ${state} — scraper may be broken. Halting state scrape.`);
            break;
          }
        } else {
          console.log(`[STATE: ${state}, CITY: ${cityIndex + 1}/${cities.length}] Found ${agentCount} agents, scraped ${cityCityAgents}`);
        }
      } catch (error) {
        console.error(`Error scraping city ${cityPath}:`, error);
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
        console.log(`\n=== Starting scrape for state: ${targetState} ===`);
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
