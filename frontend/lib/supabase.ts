import { createClient } from "@supabase/supabase-js";

// ==========================================
// SUPABASE SETUP INSTRUCTIONS:
// ==========================================
// 1. Go to https://supabase.com and create a free account
// 2. Create a new project
// 3. Go to Settings > API
// 4. Copy your Project URL and anon/public key
// 5. Paste them below (or use .env file)
// ==========================================

const supabaseUrl =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  "https://your-project.supabase.co";
const supabaseAnonKey =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "your-anon-key-here";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Check if Supabase is properly configured
export const isSupabaseConfigured = () => {
  return (
    !supabaseUrl.includes("your-project") &&
    !supabaseAnonKey.includes("your-anon-key")
  );
};
