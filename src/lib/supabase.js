import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://uoyqbexemoheipwrtkcz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
