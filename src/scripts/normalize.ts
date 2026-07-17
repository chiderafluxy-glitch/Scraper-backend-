import { supabaseAdmin, RawAgentRecord, Agent } from '../lib/supabase';
import { normalizePhoneE164, isValidPhone } from '../lib/phone';
import { v4 as uuidv4 } from 'uuid';

interface NormalizationResult {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Normalize raw agent records into the main agents table
 * Handles deduplication by phone number (or name+city as fallback)
 */
export async function normalizeRawRecords(batchSize: number = 100): Promise<NormalizationResult> {
  const result: NormalizationResult = {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };
  
  // Check global cap
  const { data: config } = await supabaseAdmin
    .from('config')
    .select('value')
    .eq('key', 'global_cap')
    .single();
  
  const capEnabled = config?.value?.enabled !== false;
  const capLimit = config?.value?.limit || 20000;
  
  // Get current count
  const { count: currentCount } = await supabaseAdmin
    .from('agents')
    .select('*', { count: 'exact', head: true });
  
  if (capEnabled && currentCount !== null && currentCount >= capLimit) {
    console.log(`Global cap of ${capLimit} reached. Skipping normalization.`);
    return result;
  }
  
  // Fetch unprocessed raw records
  const { data: rawRecords, error: fetchError } = await supabaseAdmin
    .from('raw_agent_records')
    .select('*')
    .order('scraped_at', { ascending: true })
    .limit(batchSize);
  
  if (fetchError) {
    console.error('Error fetching raw records:', fetchError);
    result.errors++;
    return result;
  }
  
  if (!rawRecords || rawRecords.length === 0) {
    console.log('No raw records to process');
    return result;
  }
  
  for (const raw of rawRecords) {
    result.processed++;
    
    try {
      // Normalize phone to E.164
      const phoneE164 = normalizePhoneE164(raw.phone);
      
      // Skip if no valid phone
      if (!phoneE164 && !raw.full_name) {
        result.skipped++;
        continue;
      }
      
      // Check for existing record by phone (primary dedup key)
      let existingAgent: Agent | null = null;
      
      if (phoneE164) {
        const { data: byPhone } = await supabaseAdmin
          .from('agents')
          .select('*')
          .eq('phone_e164', phoneE164)
          .single();
        
        existingAgent = byPhone as Agent | null;
      }
      
      // Fallback: check by name + city if no phone match
      if (!existingAgent && raw.full_name && raw.city) {
        const { data: byNameCity } = await supabaseAdmin
          .from('agents')
          .select('*')
          .eq('full_name', raw.full_name)
          .eq('city', raw.city)
          .single();
        
        existingAgent = byNameCity as Agent | null;
      }
      
      if (existingAgent) {
        // Update existing record - add new source if not present
        const sources = existingAgent.sources || [];
        const sourceAgentIds = existingAgent.source_agent_ids || {};
        
        if (!sources.includes(raw.source)) {
          sources.push(raw.source);
        }
        
        if (raw.source_agent_id) {
          sourceAgentIds[raw.source] = raw.source_agent_id;
        }
        
        const { error: updateError } = await supabaseAdmin
          .from('agents')
          .update({
            sources,
            source_agent_ids: sourceAgentIds,
            email: raw.email || existingAgent.email,
            phone: raw.phone || existingAgent.phone,
            phone_e164: phoneE164 || existingAgent.phone_e164
          })
          .eq('id', existingAgent.id);
        
        if (!updateError) {
          result.updated++;
        } else {
          console.error('Error updating agent:', updateError);
          result.errors++;
        }
      } else {
        // Check cap before insert
        if (capEnabled && currentCount !== null && currentCount + result.inserted >= capLimit) {
          console.log(`Global cap of ${capLimit} reached during normalization`);
          break;
        }
        
        // Insert new record
        const { error: insertError } = await supabaseAdmin
          .from('agents')
          .insert({
            id: uuidv4(),
            full_name: raw.full_name,
            phone: raw.phone,
            phone_e164: phoneE164,
            phone_confidence: 'carrier_direct',
            email: raw.email,
            city: raw.city,
            state: raw.state,
            zip: raw.zip,
            sources: [raw.source],
            source_agent_ids: raw.source_agent_id ? { [raw.source]: raw.source_agent_id } : {},
            license_lines: raw.license_lines
          });
        
        if (!insertError) {
          result.inserted++;
        } else {
          console.error('Error inserting agent:', insertError);
          result.errors++;
        }
      }
      
      // Delete processed raw record
      await supabaseAdmin
        .from('raw_agent_records')
        .delete()
        .eq('id', raw.id);
      
    } catch (error) {
      console.error('Error processing raw record:', error);
      result.errors++;
    }
  }
  
  return result;
}

/**
 * Run normalization in a loop until all records are processed
 */
export async function runNormalization(fullCycle: boolean = false): Promise<void> {
  let totalResult = {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };
  
  do {
    const result = await normalizeRawRecords(100);
    totalResult.processed += result.processed;
    totalResult.inserted += result.inserted;
    totalResult.updated += result.updated;
    totalResult.skipped += result.skipped;
    totalResult.errors += result.errors;
    
    console.log(`Batch complete: processed=${result.processed}, inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}`);
    
    if (!fullCycle || result.processed === 0) break;
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (true);
  
  console.log('\n=== Final Results ===');
  console.log(`Total processed: ${totalResult.processed}`);
  console.log(`Total inserted: ${totalResult.inserted}`);
  console.log(`Total updated: ${totalResult.updated}`);
  console.log(`Total skipped: ${totalResult.skipped}`);
  console.log(`Total errors: ${totalResult.errors}`);
}

// CLI runner
if (require.main === module) {
  const fullCycle = process.argv.includes('--full');
  
  console.log('Starting normalization job...');
  
  runNormalization(fullCycle)
    .then(() => {
      console.log('\nNormalization complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Normalization failed:', error);
      process.exit(1);
    });
}
