import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    // Get total counts
    const { count: totalAgents } = await supabaseAdmin
      .from('agents')
      .select('*', { count: 'exact', head: true });
    
    const { count: deliveredAgents } = await supabaseAdmin
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('delivered', true);
    
    // Get counts by state
    const { data: stateCounts } = await supabaseAdmin
      .from('agents')
      .select('state, delivered')
      .not('state', 'is', null);
    
    const byState: Record<string, { total: number; delivered: number; remaining: number }> = {};
    
    for (const row of stateCounts || []) {
      const state = row.state || 'Unknown';
      if (!byState[state]) {
        byState[state] = { total: 0, delivered: 0, remaining: 0 };
      }
      byState[state].total++;
      if (row.delivered) {
        byState[state].delivered++;
      } else {
        byState[state].remaining++;
      }
    }
    
    // Get global cap config
    const { data: config } = await supabaseAdmin
      .from('config')
      .select('value')
      .eq('key', 'global_cap')
      .single();
    
    const globalCap = config?.value?.limit || 20000;
    const capEnabled = config?.value?.enabled !== false;
    
    // Get queue status
    const { count: pendingQueue } = await supabaseAdmin
      .from('scrape_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    const { count: processingQueue } = await supabaseAdmin
      .from('scrape_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress');
    
    return NextResponse.json({
      total_agents: totalAgents || 0,
      total_delivered: deliveredAgents || 0,
      remaining: (totalAgents || 0) - (deliveredAgents || 0),
      global_cap: {
        limit: globalCap,
        enabled: capEnabled,
        usage_percent: Math.round(((totalAgents || 0) / globalCap) * 100)
      },
      by_state: byState,
      queue: {
        pending: pendingQueue || 0,
        processing: processingQueue || 0
      }
    });
    
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
