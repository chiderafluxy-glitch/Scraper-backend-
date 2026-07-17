import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, Agent } from '@/lib/supabase';
import { parseQuery, validateStateCodes, QueryFilter } from '@/lib/groq';
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
    
    // Validate state codes
    const states = validateStateCodes(filter.states);
    
    // Build the query
    let dbQuery = supabaseAdmin
      .from('agents')
      .select('*')
      .order('random()');
    
    // Filter by state if specified
    if (states && states.length > 0) {
      dbQuery = dbQuery.in('state', states);
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
    
    if (!agents || agents.length === 0) {
      return NextResponse.json({
        agents: [],
        batch_id: null,
        count: 0,
        message: 'No agents found matching your criteria'
      });
    }
    
    // Create a delivery batch
    const batchId = uuidv4();
    const agentIds = agents.map(a => a.id);
    
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
        count: agents.length
      });
    
    // Generate CSV
    const csv = generateCSV(agents);
    
    return NextResponse.json({
      agents,
      batch_id: batchId,
      count: agents.length,
      csv,
      filter: {
        states: states || 'ALL',
        count_requested: filter.count,
        count_returned: agents.length,
        exclude_delivered: filter.exclude_delivered
      }
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
  const headers = ['full_name', 'phone', 'phone_e164', 'email', 'city', 'state', 'zip', 'sources', 'license_lines', 'delivered'];
  const rows = agents.map(agent => [
    agent.full_name,
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
