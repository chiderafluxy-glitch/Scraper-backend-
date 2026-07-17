import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    // Check database connection
    const { error } = await supabaseAdmin.from('agents').select('id').limit(1);
    
    if (error) {
      return NextResponse.json(
        { status: 'unhealthy', error: 'Database connection failed' },
        { status: 503 }
      );
    }
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'final-expense-agent-pipeline'
    });
    
  } catch (error) {
    return NextResponse.json(
      { status: 'unhealthy', error: 'Service error' },
      { status: 503 }
    );
  }
}
