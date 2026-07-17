/**
 * Supabase Setup Script
 * Run this once to set up the database schema
 * 
 * Usage: npx tsx scripts/setup-supabase.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupDatabase() {
  console.log('Setting up Supabase database...');
  console.log('\n📋 Manual Setup Required');
  console.log('\nSince the Supabase JavaScript client cannot execute raw SQL,');
  console.log('please run the schema manually:\n');
  console.log('1. Go to: https://supabase.com/dashboard/project/qgxrwuqtqbxjzsuggoty');
  console.log('2. Click "SQL Editor" in the left sidebar');
  console.log('3. Click "New Query"');
  console.log('4. Copy the contents of: supabase/schema.sql');
  console.log('5. Paste into the SQL Editor');
  console.log('6. Click "Run" (or Cmd/Ctrl + Enter)\n');
  
  // Try to verify connection
  try {
    const { data, error } = await supabase.from('agents').select('id').limit(1);
    if (error) {
      console.log('Note: The agents table does not exist yet. This is expected.');
      console.log('Run the schema.sql file in Supabase to create the tables.\n');
    } else {
      console.log('✅ Database connection verified!\n');
    }
  } catch (err) {
    console.log('Database connection test skipped.\n');
  }
}

setupDatabase()
  .then(() => {
    console.log('Setup complete!');
    process.exit(0);
  })
  .catch(console.error);
