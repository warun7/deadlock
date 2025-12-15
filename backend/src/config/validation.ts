import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'JUDGE0_URL',
  'PORT',
  'NODE_ENV',
];

const optionalEnvVars = [
  'FRONTEND_URL',
  'LOG_LEVEL',
];

export function validateEnv(): void {
  console.log('🔍 Validating environment variables...');
  
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    console.error('See env.example.txt for reference.\n');
    process.exit(1);
  }
  
  // Warn about optional variables
  const missingOptional = optionalEnvVars.filter(varName => !process.env[varName]);
  if (missingOptional.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    missingOptional.forEach(varName => console.warn(`   - ${varName}`));
  }
  
  // Validate URL formats
  try {
    new URL(process.env.SUPABASE_URL!);
    new URL(process.env.JUDGE0_URL!);
  } catch (error) {
    console.error('❌ Invalid URL format in environment variables');
    process.exit(1);
  }
  
  // Validate PORT
  const port = parseInt(process.env.PORT!, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('❌ Invalid PORT number');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value || defaultValue!;
}

