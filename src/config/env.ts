interface EnvConfig {
  WALLETCONNECT_PROJECT_ID: string;
}

function getEnvVar(key: keyof EnvConfig): string {
  // Remove debugging logs as they may cause issues
  // console.log('process.env', process.env);
  // console.log('process.env[`NEXT_PUBLIC_${key}`]', process.env[`NEXT_PUBLIC_${key}`]);

  // Add safety check and default value
  const value = process.env[`NEXT_PUBLIC_${key}`] || '';

  if (!value) {
    console.warn(`Missing environment variable: NEXT_PUBLIC_${key}`);
  }

  return value;
}

export const env: EnvConfig = {
  // Use hardcoded value from .env.local if environment variable fails
  WALLETCONNECT_PROJECT_ID:
    getEnvVar('WALLETCONNECT_PROJECT_ID') || 'e0ecf9b1bb4cbfd5743fe1175131f350',
};

// Validate all environment variables at startup
Object.keys(env).forEach((key) => {
  if (!env[key as keyof EnvConfig]) {
    console.warn(`Missing environment variable: ${key}`);
  }
});

// Log environment configuration in development
if (process.env.NODE_ENV === 'development') {
  console.log('Environment Configuration:', {
    ...env,
    // Only slice if value exists to avoid errors
    WALLETCONNECT_PROJECT_ID: env.WALLETCONNECT_PROJECT_ID
      ? env.WALLETCONNECT_PROJECT_ID.slice(0, 4) + '...'
      : 'not set',
  });
}
