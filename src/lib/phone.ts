import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

/**
 * Normalize a phone number to E.164 format
 * E.g., "(402) 819-2862" -> "+14028192862"
 */
export function normalizePhoneE164(phoneRaw: string | null | undefined): string | null {
  if (!phoneRaw || phoneRaw.trim() === '') {
    return null;
  }

  // Clean the input
  let cleaned = phoneRaw.trim();
  
  // Remove common formatting characters
  cleaned = cleaned.replace(/[^\d+]/g, '');
  
  // Handle US numbers
  // If it's 10 digits, add +1
  if (/^\d{10}$/.test(cleaned)) {
    return `+1${cleaned}`;
  }
  
  // If it starts with 1 and has 11 digits (US format without +)
  if (/^1\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  
  // If it already has +, validate and return
  if (cleaned.startsWith('+')) {
    try {
      const parsed = parsePhoneNumber(cleaned, 'US' as CountryCode);
      if (parsed && parsed.isValid()) {
        return parsed.format('E.164');
      }
    } catch {
      // Fall through to try other methods
    }
  }
  
  // Try to parse as US number
  try {
    const parsed = parsePhoneNumber(cleaned, 'US' as CountryCode);
    if (parsed && parsed.isValid()) {
      return parsed.format('E.164');
    }
  } catch {
    // Fall through
  }
  
  // Last resort: if it looks like a phone number, add +1
  if (/^\d{10,11}$/.test(cleaned)) {
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+${cleaned}`;
    }
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
  }
  
  return null;
}

/**
 * Check if a phone number is valid
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  
  try {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) return false;
    
    return isValidPhoneNumber(normalized, 'US' as CountryCode);
  } catch {
    return false;
  }
}

/**
 * Format a phone number for display
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  
  try {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) return phone;
    
    const parsed = parsePhoneNumber(normalized, 'US' as CountryCode);
    if (parsed) {
      return parsed.formatNational();
    }
  } catch {
    // Fall through
  }
  
  return phone;
}
