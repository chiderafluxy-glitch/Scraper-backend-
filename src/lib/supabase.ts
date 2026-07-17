import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qgxrwuqtqbxjzsuggoty.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseServiceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.log('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

// Client for server-side operations with elevated privileges
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Client for browser-side operations (read-only for public data)
export const supabase = createClient(
  supabaseUrl,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Type definitions
export interface Agent {
  id: string;
  full_name: string;
  phone: string | null;
  phone_e164: string | null;
  phone_confidence: string;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sources: string[];
  source_agent_ids: Record<string, string>;
  license_lines: string | null;
  delivered: boolean;
  delivered_at: string | null;
  delivered_batch_id: string | null;
  created_at: string;
  updated_at?: string;
}

export interface RawAgentRecord {
  id: string;
  source: string;
  source_agent_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  license_lines: string | null;
  scraped_at: string;
  raw_payload: Record<string, unknown>;
}

export interface ScrapeQueueItem {
  id: string;
  source: string;
  state: string;
  city_or_zip: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  attempts: number;
  error_message: string | null;
}

export interface DeliveryBatch {
  id: string;
  description: string | null;
  count: number;
  created_at: string;
}

export interface AgentStats {
  total_agents: number;
  total_delivered: number;
  remaining: number;
  global_cap?: {
    limit: number;
    enabled: boolean;
    usage_percent: number;
  };
  by_state: Record<string, { total: number; delivered: number; remaining: number }>;
  queue?: {
    pending: number;
    processing: number;
  };
}
