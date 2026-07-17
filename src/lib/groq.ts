import Groq from 'groq-sdk';

// Create Groq client lazily so it can work without env var during import
let groqInstance: Groq | null = null;

function getGroqClient(apiKey?: string): Groq {
  const key = apiKey || process.env.GROQ_API_KEY;
  if (!groqInstance || (apiKey && key !== process.env.GROQ_API_KEY)) {
    groqInstance = new Groq({ apiKey: key });
  }
  return groqInstance;
}

export interface QueryFilter {
  states: string[] | null;
  cities: string[] | null;
  count: number;
  exclude_delivered: boolean;
  notes: string | null;
}

// Full state name to state code mapping
const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC'
};

// Major cities to state mapping (unique per state to avoid ambiguity)
// When cities appear in multiple states, the state query will be used
const CITY_TO_STATE: Record<string, string> = {
  // Texas
  'houston': 'TX', 'dallas': 'TX', 'austin': 'TX', 'san antonio': 'TX', 'fort worth': 'TX',
  'el paso': 'TX', 'arlington': 'TX', 'corpus christi': 'TX', 'plano': 'TX', 'lubbock': 'TX',
  // Florida
  'miami': 'FL', 'jacksonville': 'FL', 'tampa': 'FL', 'orlando': 'FL', 'st petersburg': 'FL',
  'st. petersburg': 'FL', 'hialeah': 'FL', 'tallahassee': 'FL', 'fort lauderdale': 'FL',
  'port st lucie': 'FL', 'port st. lucie': 'FL', 'cape coral': 'FL',
  // Georgia
  'atlanta': 'GA', 'augusta': 'GA', 'savannah': 'GA', 'macon': 'GA', 'alpharetta': 'GA',
  'marietta': 'GA', 'valdosta': 'GA',
  // California
  'los angeles': 'CA', 'la': 'CA', 'san francisco': 'CA', 'san diego': 'CA', 'san jose': 'CA',
  'sacramento': 'CA', 'fresno': 'CA', 'oakland': 'CA', 'long beach': 'CA', 'bakersfield': 'CA',
  // New York
  'new york': 'NY', 'nyc': 'NY', 'brooklyn': 'NY', 'queens': 'NY', 'bronx': 'NY',
  'manhattan': 'NY', 'buffalo': 'NY', 'rochester': 'NY', 'syracuse': 'NY', 'yonkers': 'NY',
  // Illinois
  'chicago': 'IL', 'aurora': 'IL', 'naperville': 'IL', 'joliet': 'IL', 'rockford': 'IL',
  // Pennsylvania
  'philadelphia': 'PA', 'pittsburgh': 'PA', 'allentown': 'PA', 'erie': 'PA', 'reading': 'PA',
  // Ohio
  'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH', 'toledo': 'OH', 'akron': 'OH',
  // Arizona
  'phoenix': 'AZ', 'tucson': 'AZ', 'mesa': 'AZ', 'chandler': 'AZ', 'scottsdale': 'AZ',
  // Colorado (Aurora is IL primarily)
  'denver': 'CO', 'colorado springs': 'CO', 'fort collins': 'CO', 'lakewood': 'CO',
  // Washington
  'seattle': 'WA', 'spokane': 'WA', 'tacoma': 'WA', 'vancouver': 'WA', 'bellevue': 'WA',
  // Oregon
  'portland': 'OR', 'eugene': 'OR', 'salem': 'OR', 'gresham': 'OR', 'beaverton': 'OR',
  // Nevada
  'las vegas': 'NV', 'henderson': 'NV', 'reno': 'NV', 'sparks': 'NV', 'north las vegas': 'NV',
  // Massachusetts
  'boston': 'MA', 'worcester': 'MA', 'cambridge': 'MA', 'lowell': 'MA', 'brockton': 'MA',
  // Michigan
  'detroit': 'MI', 'grand rapids': 'MI', 'warren': 'MI', 'sterling heights': 'MI', 'ann arbor': 'MI',
  // North Carolina
  'charlotte': 'NC', 'raleigh': 'NC', 'greensboro': 'NC', 'durham': 'NC', 'winston-salem': 'NC',
  // New Jersey
  'jersey city': 'NJ', 'paterson': 'NJ', 'elizabeth': 'NJ', 'trenton': 'NJ', 'camden': 'NJ',
  // Virginia
  'virginia beach': 'VA', 'norfolk': 'VA', 'chesapeake': 'VA', 'richmond': 'VA', 'newport news': 'VA',
  // Tennessee
  'nashville': 'TN', 'memphis': 'TN', 'knoxville': 'TN', 'chattanooga': 'TN', 'clarksville': 'TN',
  // Indiana
  'indianapolis': 'IN', 'fort wayne': 'IN', 'evansville': 'IN', 'south bend': 'IN', 'carmel': 'IN',
  // Missouri
  'kansas city': 'MO', 'st louis': 'MO', 'st. louis': 'MO', 'springfield': 'MO',
  // Maryland
  'baltimore': 'MD', 'columbia': 'MD', 'germantown': 'MD', 'silver spring': 'MD', 'bethesda': 'MD',
  // Wisconsin
  'milwaukee': 'WI', 'madison': 'WI', 'green bay': 'WI', 'kenosha': 'WI', 'racine': 'WI',
  // Connecticut
  'bridgeport': 'CT', 'new haven': 'CT', 'hartford': 'CT', 'stamford': 'CT', 'waterbury': 'CT',
  // South Carolina (Columbia is MD primarily)
  'charleston': 'SC', 'north charleston': 'SC', 'mount pleasant': 'SC', 'rock hill': 'SC',
  // Alabama
  'birmingham': 'AL', 'montgomery': 'AL', 'mobile': 'AL', 'huntsville': 'AL', 'tuscaloosa': 'AL',
  // Louisiana
  'new orleans': 'LA', 'baton rouge': 'LA', 'shreveport': 'LA', 'metairie': 'LA', 'lafayette': 'LA',
  // Kentucky
  'louisville': 'KY', 'lexington': 'KY', 'bowling green': 'KY', 'owensboro': 'KY', 'covington': 'KY',
  // Oklahoma
  'oklahoma city': 'OK', 'tulsa': 'OK', 'norman': 'OK', 'broken arrow': 'OK', 'lawton': 'OK',
  // Iowa
  'des moines': 'IA', 'cedar rapids': 'IA', 'davenport': 'IA', 'sioux city': 'IA', 'iowa city': 'IA',
  // Utah
  'salt lake city': 'UT', 'west valley city': 'UT', 'provo': 'UT', 'west jordan': 'UT', 'orem': 'UT',
  // Arkansas
  'little rock': 'AR', 'fort smith': 'AR', 'fayetteville': 'AR', 'springdale': 'AR', 'jonesboro': 'AR',
  // Kansas
  'wichita': 'KS', 'overland park': 'KS', 'olathe': 'KS', 'topeka': 'KS', 'lawrence': 'KS',
  // Mississippi
  'jackson': 'MS', 'gulfport': 'MS', 'southaven': 'MS', 'hattiesburg': 'MS', 'biloxi': 'MS',
  // New Mexico
  'albuquerque': 'NM', 'las cruces': 'NM', 'rio rancho': 'NM', 'santa fe': 'NM', 'roswell': 'NM',
  // Nebraska (Omaha is primary, Bellevue is WA primarily)
  'omaha': 'NE', 'lincoln': 'NE', 'grand island': 'NE', 'kearney': 'NE',
  // Idaho
  'boise': 'ID', 'meridian': 'ID', 'nampa': 'ID', 'idaho falls': 'ID', 'pocatello': 'ID',
  // Hawaii
  'honolulu': 'HI', 'pearl city': 'HI', 'hilo': 'HI', 'kailua': 'HI', 'waipahu': 'HI',
  // West Virginia (Charleston is SC primarily)
  'huntington': 'WV', 'morgantown': 'WV', 'parkersburg': 'WV', 'wheeling': 'WV',
  // Maine (Portland is OR primarily)
  'lewiston': 'ME', 'bangor': 'ME', 'south portland': 'ME', 'auburn': 'ME',
  // Montana
  'billings': 'MT', 'missoula': 'MT', 'great falls': 'MT', 'bozeman': 'MT', 'butte': 'MT',
  // Rhode Island
  'providence': 'RI', 'warwick': 'RI', 'cranston': 'RI', 'pawtucket': 'RI', 'east providence': 'RI',
  // Delaware
  'wilmington': 'DE', 'dover': 'DE', 'newark': 'DE', 'middletown': 'DE', 'smyrna': 'DE',
  // South Dakota
  'sioux falls': 'SD', 'rapid city': 'SD', 'aberdeen': 'SD', 'brookings': 'SD', 'watertown': 'SD',
  // North Dakota
  'fargo': 'ND', 'bismarck': 'ND', 'grand forks': 'ND', 'minot': 'ND', 'west fargo': 'ND',
  // Alaska
  'anchorage': 'AK', 'fairbanks': 'AK', 'juneau': 'AK',
  // Vermont
  'burlington': 'VT', 'south burlington': 'VT', 'rutland': 'VT', 'essex junction': 'VT', 'barre': 'VT',
  // Wyoming
  'cheyenne': 'WY', 'casper': 'WY', 'laramie': 'WY', 'gillette': 'WY', 'rock springs': 'WY',
  // DC
  'dc': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC'
};

const SYSTEM_PROMPT = `You are a query parser for an insurance agent lead database. Given a user's request for a list of insurance agent leads, extract a JSON object with these fields:
- states: array of state codes (e.g. ["TX", "FL", "GA"]), or ["ALL"] if unspecified or if they want all states. UNDERSTAND full state names like "Oregon" → "OR", "Illinois" → "IL"
- cities: array of city names mentioned (e.g. ["Chicago", "Miami", "LA"]) - these will be mapped to states
- count: integer, how many records they want (default: 1000, max: 10000)
- exclude_delivered: boolean, default true unless they explicitly ask for a re-send or already delivered records
- notes: anything else relevant (e.g. "exclude Houston", "prefer email available")

Return ONLY valid JSON, no preamble, no explanation.`;

export async function parseQuery(userRequest: string, apiKey?: string): Promise<QueryFilter> {
  const groq = getGroqClient(apiKey);
  
  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userRequest }
    ],
    model: 'llama-3.1-8b-instant',
    temperature: 0.1,
    max_tokens: 256,
  });

  const response = completion.choices[0]?.message?.content;
  
  if (!response) {
    throw new Error('No response from Groq');
  }

  try {
    // Parse the JSON response
    const parsed = JSON.parse(response.trim());
    
    // Validate and set defaults
    return {
      states: parsed.states || ['ALL'],
      cities: parsed.cities || null,
      count: Math.min(Math.max(parseInt(parsed.count) || 1000, 1), 10000),
      exclude_delivered: parsed.exclude_delivered !== false,
      notes: parsed.notes || null
    };
  } catch (error) {
    console.error('Failed to parse Groq response:', response, error);
    // Return default filter on parse error
    return {
      states: ['ALL'],
      cities: null,
      count: 1000,
      exclude_delivered: true,
      notes: null
    };
  }
}

// State code validation
const VALID_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

// Convert full state names to codes
export function normalizeStateName(name: string): string {
  return STATE_NAME_TO_CODE[name.toLowerCase()] || name.toUpperCase();
}

// Convert city names to state codes
export function cityToState(city: string): string | null {
  return CITY_TO_STATE[city.toLowerCase()] || null;
}

// Get states from cities
export function getStatesFromCities(cities: string[]): string[] {
  const states = new Set<string>();
  for (const city of cities) {
    const state = cityToState(city);
    if (state) {
      states.add(state);
    }
  }
  return Array.from(states);
}

export function validateStateCodes(codes: string[] | null): string[] | null {
  if (!codes || codes.length === 0 || codes[0] === 'ALL') {
    return null; // null means all states
  }
  
  // First normalize any full state names to codes
  const normalizedCodes = codes.map(c => normalizeStateName(c));
  const validCodes = normalizedCodes.filter(c => VALID_STATE_CODES.includes(c));
  
  return validCodes.length > 0 ? validCodes : null;
}
