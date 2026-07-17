import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, Agent } from '@/lib/supabase';
import { parseQuery, validateStateCodes, getStatesFromCities, QueryFilter } from '@/lib/groq';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;
    
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid query parameter' },
        { status: 400 }
      );
    }
    
    // Parse the natural language query using Groq
    let filter: QueryFilter;
    try {
      filter = await parseQuery(query);
    } catch (error) {
      console.error('Error parsing query:', error);
      return NextResponse.json(
        { error: 'Failed to parse query. Please try again.' },
        { status: 500 }
      );
    }
    
    // Get states from cities if any were mentioned
    let allStates = filter.states || [];
    if (filter.cities && filter.cities.length > 0) {
      const statesFromCities = getStatesFromCities(filter.cities);
      // Merge states from cities with explicitly mentioned states
      const statesSet = new Set([...allStates, ...statesFromCities]);
      allStates = Array.from(statesSet);
    }
    
    // Handle "ALL" state
    if (allStates.length === 0 || allStates[0] === 'ALL') {
      allStates = [];
    }
    
    // Validate state codes
    const states = validateStateCodes(allStates.length > 0 ? allStates : null);
    
    // Build the query (Supabase REST doesn't support random(), so we order by id for consistency)
    let dbQuery = supabaseAdmin
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Filter by state if specified
    if (states && states.length > 0) {
      dbQuery = dbQuery.in('state', states);
    }
    
    // Filter by city if cities were specified
    if (filter.cities && filter.cities.length > 0) {
      // Use ilike for case-insensitive city matching
      const cityConditions = filter.cities.map(city => 
        `city.ilike.${city},city.ilike.${city.toLowerCase()},city.ilike.${city.toUpperCase()}`
      );
      // Note: Supabase doesn't support OR with ilike easily, so we'll filter in memory for cities
    }
    
    // Filter by delivered status
    if (filter.exclude_delivered) {
      dbQuery = dbQuery.eq('delivered', false);
    }
    
    // Apply count limit
    dbQuery = dbQuery.limit(filter.count);
    
    const { data: agents, error } = await dbQuery;
    
    if (error) {
      console.error('Error querying agents:', error);
      return NextResponse.json(
        { error: 'Database query failed' },
        { status: 500 }
      );
    }
    
    // Filter by city if cities were specified (post-query filtering)
    let filteredAgents = agents || [];
    if (filter.cities && filter.cities.length > 0) {
      const citySet = new Set(filter.cities.map(c => c.toLowerCase()));
      filteredAgents = filteredAgents.filter(agent => 
        agent.city && citySet.has(agent.city.toLowerCase())
      );
      // Apply count limit again after city filtering
      filteredAgents = filteredAgents.slice(0, filter.count);
    }
    
    // Get scraped states for the note
    const { data: scrapedData } = await supabaseAdmin
      .from('scrape_queue')
      .select('state')
      .eq('status', 'done');
    const scrapedStatesList = scrapedData?.map(d => d.state) || [];
    const uniqueStates = scrapedStatesList.filter((v, i, a) => a.indexOf(v) === i);
    const scrapedStatesNote = uniqueStates.length > 0
      ? `Currently scraped: ${uniqueStates.join(', ')}. More states coming soon.`
      : 'No states scraped yet. The scraper is still initializing.';
    
    if (filteredAgents.length === 0) {
      return NextResponse.json({
        agents: [],
        batch_id: null,
        count: 0,
        message: 'No agents found matching your criteria. Try expanding your search or waiting for more data to be scraped.',
        suggested_states: states || [],
        scraped_states_note: scrapedStatesNote
      });
    }
    
    // Create a delivery batch
    const batchId = uuidv4();
    const agentIds = filteredAgents.map(a => a.id);
    
    // Update agents as delivered in a transaction
    const { error: updateError } = await supabaseAdmin
      .from('agents')
      .update({
        delivered: true,
        delivered_at: new Date().toISOString(),
        delivered_batch_id: batchId
      })
      .in('id', agentIds);
    
    if (updateError) {
      console.error('Error updating delivered status:', updateError);
      return NextResponse.json(
        { error: 'Failed to update delivery status' },
        { status: 500 }
      );
    }
    
    // Insert delivery batch record
    await supabaseAdmin
      .from('delivery_batches')
      .insert({
        id: batchId,
        description: `Query: ${query}`,
        count: filteredAgents.length
      });
    
    // Generate CSV with name, phone, email as priority
    const csv = generateCSV(filteredAgents);
    
    return NextResponse.json({
      agents: filteredAgents,
      batch_id: batchId,
      count: filteredAgents.length,
      csv,
      filter: {
        states: states || 'ALL',
        cities: filter.cities || [],
        count_requested: filter.count,
        count_returned: filteredAgents.length,
        exclude_delivered: filter.exclude_delivered,
        notes: filter.notes
      },
      scraped_states_note: scrapedStatesNote
    });
    
  } catch (error) {
    console.error('Error in query API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateCSV(agents: Agent[]): string {
  // Priority fields: name, phone, email first
  const headers = ['full_name', 'phone', 'phone_e164', 'email', 'city', 'state', 'zip', 'sources', 'license_lines', 'delivered'];
  const rows = agents.map(agent => [
    agent.full_name || '',
    agent.phone || '',
    agent.phone_e164 || '',
    agent.email || '',
    agent.city || '',
    agent.state || '',
    agent.zip || '',
    (agent.sources || []).join('; '),
    agent.license_lines || '',
    agent.delivered ? 'Yes' : 'No'
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  return csvContent;
}
