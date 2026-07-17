/**
 * Scraper Runner
 * This script can be deployed to Render as a cron job or background worker
 * It processes the scrape queue and normalizes results
 */

import { supabaseAdmin } from '../lib/supabase';
import { scrapeMutualOfOmaha, saveRawRecords } from './mutual-of-omaha';
import { runNormalization } from '../scripts/normalize';

interface QueueItem {
  id: string;
  source: string;
  state: string;
  city_or_zip: string;
  status: string;
}

async function getNextQueueItem(): Promise<QueueItem | null> {
  const { data, error } = await supabaseAdmin
    .from('scrape_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  
  if (error || !data) {
    return null;
  }
  
  return data as QueueItem;
}

async function updateQueueItem(id: string, status: string, errorMessage?: string) {
  await supabaseAdmin
    .from('scrape_queue')
    .update({
      status,
      last_attempted_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq('id', id);
}

async function initializeQueueForState(state: string, cities: string[]) {
  for (const city of cities) {
    const { error } = await supabaseAdmin
      .from('scrape_queue')
      .upsert({
        source: 'mutual_of_omaha',
        state,
        city_or_zip: city,
        status: 'pending'
      }, {
        onConflict: 'source,state,city_or_zip'
      });
    
    if (error) {
      console.error(`Error inserting queue item for ${city}:`, error);
    }
  }
}

export async function runScraperCycle() {
  console.log('Starting scraper cycle...');
  
  // Check if under global cap
  const { data: config } = await supabaseAdmin
    .from('config')
    .select('value')
    .eq('key', 'global_cap')
    .single();
  
  const capEnabled = config?.value?.enabled !== false;
  const capLimit = config?.value?.limit || 20000;
  
  const { count: currentCount } = await supabaseAdmin
    .from('agents')
    .select('*', { count: 'exact', head: true });
  
  if (capEnabled && currentCount !== null && currentCount >= capLimit) {
    console.log('Global cap reached. Stopping scrape cycle.');
    return { stopped: true, reason: 'cap_reached' };
  }
  
  // Get next queue item
  const queueItem = await getNextQueueItem();
  
  if (!queueItem) {
    console.log('No pending queue items. Scrape cycle complete.');
    
    // If queue is empty, initialize with cities for target states
    const targetStates = {
      TX: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Lubbock'],
      FL: ['Miami', 'Jacksonville', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral'],
      GA: ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens', 'Macon', 'Albany', 'Alpharetta', 'Marietta', 'Valdosta']
    };
    
    for (const [state, cities] of Object.entries(targetStates)) {
      await initializeQueueForState(state, cities);
    }
    
    console.log('Initialized queue with target cities');
    return { stopped: false, initialized: true };
  }
  
  // Mark as in progress
  await updateQueueItem(queueItem.id, 'in_progress');
  
  try {
    console.log(`Processing: ${queueItem.source} - ${queueItem.state} - ${queueItem.city_or_zip}`);
    
    // Run the scraper
    const records = await scrapeMutualOfOmaha(queueItem.state, queueItem.city_or_zip);
    console.log(`Found ${records.length} records`);
    
    // Save to raw table
    const saved = await saveRawRecords(records);
    console.log(`Saved ${saved} raw records`);
    
    // Run normalization
    const normResult = await runNormalization(false);
    console.log('Normalization complete:', normResult);
    
    // Mark as done
    await updateQueueItem(queueItem.id, 'done');
    
    return {
      stopped: false,
      processed: queueItem.city_or_zip,
      records: records.length,
      normalized: normResult
    };
    
  } catch (error) {
    console.error(`Error processing ${queueItem.city_or_zip}:`, error);
    await updateQueueItem(queueItem.id, 'failed', String(error));
    return { stopped: false, error: String(error) };
  }
}

// Simple HTTP server to keep process alive for Render health checks
function startHttpServer() {
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', scraper: 'running' }));
    } else {
      res.writeHead(200);
      res.end('Scraper service running');
    }
  });
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });
}

// CLI runner - runs continuously
if (require.main === module) {
  const cycles = process.argv[2] === 'once' ? 1 : Infinity;
  
  console.log(`Starting scraper service (mode: ${cycles === 1 ? 'once' : 'continuous'})...`);
  
  // Start HTTP server for health checks
  startHttpServer();
  
  let completedCycles = 0;
  
  (async () => {
    while (completedCycles < cycles) {
      const result = await runScraperCycle();
      completedCycles++;
      console.log(`Cycle ${completedCycles} result:`, result);
      
      if (result.stopped) {
        console.log('Scraper stopped.');
        break;
      }
      
      // Delay between cycles (30 seconds)
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    if (cycles === Infinity) {
      console.log('Scraper service running continuously...');
    } else {
      console.log(`\nScraper run complete. Processed ${completedCycles} cycle(s).`);
      process.exit(0);
    }
  })().catch(error => {
    console.error('Scraper run failed:', error);
    process.exit(1);
  });
}
