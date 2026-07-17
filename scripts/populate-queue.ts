import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qgxrwuqtqbxjzsuggoty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFneHJ3dXF0cWJ4anpzdWdnb3R5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE3NjM0NSwiZXhwIjoyMDk5NzUyMzQ1fQ.y0gzDUSO80tXZhJGg9xJADv3nTSCEIfY5qsRVNXtQtQ';

const supabase = createClient(supabaseUrl, supabaseKey);

const targetStates = {
  TX: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Lubbock'],
  FL: ['Miami', 'Jacksonville', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral'],
  GA: ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens', 'Macon', 'Albany', 'Alpharetta', 'Marietta', 'Valdosta'],
  NY: ['New York', 'Brooklyn', 'Queens', 'Bronx', 'Manhattan', 'Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Yonkers'],
  CA: ['Los Angeles', 'LA', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland', 'Long Beach', 'Bakersfield'],
  IL: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford', 'Springfield', 'Peoria', 'Elgin', 'Waukegan', 'Champaign'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Lancaster', 'Bethlehem', 'Harrisburg', 'York'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Gilbert', 'Glendale', 'Tempe', 'Peoria', 'Surprise'],
  CO: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Boulder', 'Greeley', 'Loveland', 'Grand Junction'],
  WA: ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Renton', 'Yakima', 'Bellingham', 'Olympia'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Greenville'],
  MI: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Dearborn', 'Livonia', 'Troy', 'Flint'],
  NJ: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Camden', 'Clifton', 'Brick', 'Cherry Hill', 'Passaic'],
  VA: ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Newport', 'Suffolk', 'Lynchburg'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Kingsport']
};

const carriers = ['state_farm', 'allstate', 'prudential'];

async function addQueueItems() {
  console.log('Adding queue items for new carriers...');
  
  for (const carrier of carriers) {
    let carrierCount = 0;
    const items = [];
    
    for (const [state, cities] of Object.entries(targetStates)) {
      for (const city of cities) {
        items.push({
          source: carrier,
          state,
          city_or_zip: city,
          status: 'pending'
        });
      }
    }
    
    // Insert in batches of 50
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const { error } = await supabase
        .from('scrape_queue')
        .insert(batch);
      
      if (error) {
        console.error(`Error inserting batch for ${carrier}:`, error.message);
      } else {
        carrierCount += batch.length;
      }
    }
    
    console.log(`Added ${carrierCount} items for ${carrier}`);
  }
  
  // Check total
  const { count } = await supabase
    .from('scrape_queue')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total queue items: ${count}`);
}

addQueueItems().catch(console.error);
