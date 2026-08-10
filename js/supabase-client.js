// js/supabase-client.js
// Replace these two values with your Supabase project's URL and publishable/anon key.
// Never put a service_role key in a static frontend.

const SUPABASE_URL = 'https://etquvhtzwqzjskmkxlog.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bOxwVXwO6l0uruPOf_J-0A_vU5aqJQb';

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

export const APP_CONFIG = {
  avatarBucket: 'avatars',
  mediaBucket: 'media',
  oauthRedirect: window.location.origin + window.location.pathname
};

export function isConfigured() {
  return !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_');
}
