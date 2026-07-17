import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export interface QueryFilter {
  states: string[] | null;
  count: number;
  exclude_delivered: boolean;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a query parser for an insurance agent lead database. Given a user's request for a list of insurance agent leads, extract a JSON object with these fields:
- states: array of state codes (e.g. ["TX", "FL", "GA"]), or ["ALL"] if unspecified or if they want all states
- count: integer, how many records they want (default: 1000)
- exclude_delivered: boolean, default true unless they explicitly ask for a re-send or already delivered records
- notes: anything else relevant (e.g. "exclude Houston", "prefer email available")

Return ONLY valid JSON, no preamble, no explanation.`;

export async function parseQuery(userRequest: string): Promise<QueryFilter> {
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
      count: Math.min(Math.max(parseInt(parsed.count) || 1000, 1), 10000),
      exclude_delivered: parsed.exclude_delivered !== false,
      notes: parsed.notes || null
    };
  } catch (error) {
    console.error('Failed to parse Groq response:', response, error);
    // Return default filter on parse error
    return {
      states: ['ALL'],
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

export function validateStateCodes(codes: string[] | null): string[] | null {
  if (!codes || codes.length === 0 || codes[0] === 'ALL') {
    return null; // null means all states
  }
  
  const upperCodes = codes.map(c => c.toUpperCase());
  const validCodes = upperCodes.filter(c => VALID_STATE_CODES.includes(c));
  
  return validCodes.length > 0 ? validCodes : null;
}
