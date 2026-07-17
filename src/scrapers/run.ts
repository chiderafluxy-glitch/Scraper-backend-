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
    // Check if already exists first
    const { data: existing } = await supabaseAdmin
      .from('scrape_queue')
      .select('id')
      .eq('source', 'mutual_of_omaha')
      .eq('state', state)
      .eq('city_or_zip', city)
      .single();
    
    if (!existing) {
      const { error } = await supabaseAdmin
        .from('scrape_queue')
        .insert({
          source: 'mutual_of_omaha',
          state,
          city_or_zip: city,
          status: 'pending'
        });
      
      if (error) {
        console.error(`Error inserting queue item for ${city}:`, error);
      }
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
    // Expanded to 15+ states with major cities for comprehensive coverage
    const targetStates = {
      // Original 3 states with all major cities
      TX: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Lubbock'],
      FL: ['Miami', 'Jacksonville', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral'],
      GA: ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens', 'Macon', 'Albany', 'Alpharetta', 'Marietta', 'Valdosta'],
      // New states added for more coverage
      NY: ['New York', 'Brooklyn', 'Queens', 'Bronx', 'Manhattan', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers'],
      CA: ['Los Angeles', 'LA', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland', 'Long Beach', 'Bakersfield'],
      IL: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford', 'Springfield', 'Peoria', 'Elgin', 'Waukegan', 'Champaign'],
      PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Lancaster', 'Bethlehem', 'Harrisburg', 'York'],
      OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain'],
      AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Gilbert', 'Glendale', 'Tempe', 'Peoria', 'Surprise'],
      CO: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Boulder', 'Greeley', 'Loveland', 'Grand Junction'],
      WA: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Renton', 'Yakima', 'Bellingham', 'Olympia'],
      OR: ['Portland', 'Eugene', 'Salem', 'Gresham', 'Beaverton', 'Hillsboro', 'Medford', 'Bend', 'Springfield', 'Corvallis'],
      NV: ['Las Vegas', 'Henderson', 'Reno', 'Sparks', 'North Las Vegas', 'Carson City', 'Elko', 'Spring Valley', 'Enterprise', 'Sunrise Manor'],
      MA: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'Quincy', 'Lynn', 'New Bedford', 'Fall River'],
      MI: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Dearborn', 'Livonia', 'Troy', 'Flint'],
      NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Greenville'],
      NJ: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Camden', 'Clifton', 'Brick', 'Cherry Hill', 'Passaic'],
      VA: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Newport', 'Suffolk', 'Lynchburg'],
      TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Kingsport'],
      IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette'],
      MO: ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence', 'Lee\'s Summit', 'O\'Fallon', 'St. Joseph', 'St. Charles', 'Blue Springs'],
      MD: ['Baltimore', 'Columbia', 'Germantown', 'Silver Spring', 'Bethesda', 'Gaithersburg', 'Frederick', 'Rockville', 'Bowie', 'Laurel'],
      WI: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Oshkosh', 'Janesville', 'Eau Claire'],
      MN: ['Minneapolis', 'St. Paul', 'Bloomington', 'Brooklyn Park', 'Duluth', 'Rochester', 'St. Cloud', 'Blaine', 'Eden Prairie', 'Coon Rapids'],
      CT: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden'],
      SC: ['Charleston', 'Columbia', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Sumter', 'Goose Creek', 'Spartanburg'],
      AL: ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison'],
      LA: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Metairie', 'Lafayette', 'Lake Charles', 'Bossier City', 'Monroe', 'Alexandria', 'Hammond'],
      KY: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Nicholasville', 'Elizabethtown'],
      OK: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Lawton', 'Edmond', 'Moore', 'Midwest City', 'Enid', 'Stillwater'],
      IA: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Ames', 'West Des Moines', 'Council Bluffs', 'Dubuque'],
      UT: ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Ogden', 'St. George', 'Layton', 'Millcreek', 'Murray'],
      AR: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'Rogers', 'Conway', 'North Little Rock', 'Bentonville', 'Hot Springs'],
      KS: ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina'],
      MS: ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian', 'Tupelo', 'Greenville', 'Olive Branch', 'Horn Lake'],
      NM: ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Clovis', 'Hobbs', 'Socorro', 'Los Lunas'],
      NE: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'Columbus', 'Papillion'],
      ID: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell', 'Coeur d\'Alene', 'Twin Falls', 'Moscow', 'Lewiston'],
      HI: ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani', 'Makakilo', 'Halawa', 'Ewa Beach'],
      WV: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Beckley', 'Clarksburg', 'Martinsburg'],
      ME: ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Sanford', 'Saco', 'Augusta', 'Waterville'],
      NH: ['Manchester', 'Nashua', 'Concord', 'Derry', 'Rochester', 'Salem', 'Merrimack', 'Keene', 'Bedford', 'Dover'],
      MT: ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Belgrade', 'Miles City', 'Livingston'],
      RI: ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Cumberland', 'North Providence', 'South Kingstown', 'Lincoln'],
      DE: ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
      SD: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Spearfish'],
      ND: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Mandan', 'Dickinson', 'Jamestown', 'Wahpeton', 'Bismarck'],
      AK: ['Anchorage', 'Fairbanks', 'Juneau', 'Badger', 'Knik-Fairview', 'College', 'North Lakes', 'Fast Aurora', 'Tanaina', 'Hickel'],
      VT: ['Burlington', 'South Burlington', 'Rutland', 'Essex Junction', 'Barre', 'Montpelier', 'St. Albans', 'Winooski', 'Newport', 'Vergennes'],
      WY: ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Jackson', 'Cody'],
      DC: ['Washington DC', 'Georgetown', 'Dupont Circle', 'Capitol Hill', 'Adams Morgan', 'U Street', 'Kalorama', 'Woodley Park', 'Glover Park', 'Logan Circle']
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
