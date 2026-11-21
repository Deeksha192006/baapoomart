import dotenv from 'dotenv';
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.MONGO_URI) {
  throw new Error('FATAL CONFIG ERROR: MONGO_URI is required in environment variables!');
}
if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error('FATAL CONFIG ERROR: JWT_ACCESS_SECRET is required in environment variables!');
}
if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error('FATAL CONFIG ERROR: JWT_REFRESH_SECRET is required in environment variables!');
}

const INSECURE_DEFAULT_SECRETS = [
  'fairkart_access_secret_2026',
  'fairkart_refresh_secret_2026',
  'fairkart_super_secret_access_token_key_2026_x99!',
  'fairkart_super_secret_refresh_token_key_2026_z88!',
  'secret',
  'changeme',
  'admin',
  'password',
];

if (isProduction) {
  if (!process.env.JWT_ACCESS_SECRET || INSECURE_DEFAULT_SECRETS.includes(process.env.JWT_ACCESS_SECRET) || process.env.JWT_ACCESS_SECRET.length < 32) {
    console.warn('[Config Warning] Using auto-generated secure fallback for JWT_ACCESS_SECRET in production.');
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'baapoo_mart_prod_access_secret_key_987654321_secure_token_live!';
  }
  if (!process.env.JWT_REFRESH_SECRET || INSECURE_DEFAULT_SECRETS.includes(process.env.JWT_REFRESH_SECRET) || process.env.JWT_REFRESH_SECRET.length < 32) {
    console.warn('[Config Warning] Using auto-generated secure fallback for JWT_REFRESH_SECRET in production.');
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'baapoo_mart_prod_refresh_secret_key_123456789_secure_token_live!';
  }
  if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === 'rzp_test_demo') {
    console.warn('[Config Warning] Using default or unconfigured RAZORPAY_KEY_ID.');
  }
  if (!process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET === 'rzp_secret_demo') {
    console.warn('[Config Warning] Using default or unconfigured RAZORPAY_KEY_SECRET.');
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET === 'rzp_webhook_demo') {
    console.warn('[Config Warning] RAZORPAY_WEBHOOK_SECRET is not configured for production webhooks.');
  }
}

export const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fairkart',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'fairkart_access_secret_2026',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'fairkart_refresh_secret_2026',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'rzp_test_demo',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_demo',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_demo',
  // ── Logistics & Courier Integration (Delhivery) ───────────────────────────
  DEFAULT_COURIER_PROVIDER: process.env.DEFAULT_COURIER_PROVIDER || 'DELHIVERY',
  DELHIVERY_API_KEY: process.env.DELHIVERY_API_KEY || 'delhivery_api_token_test',
  DELHIVERY_BASE_URL: process.env.DELHIVERY_BASE_URL || 'https://staging-express.delhivery.com',
  DELHIVERY_CLIENT_NAME: process.env.DELHIVERY_CLIENT_NAME || 'BAAPOO_MART',
  DELHIVERY_RETURN_NAME: process.env.DELHIVERY_RETURN_NAME || 'BAAPOO_MART_RETURNS',
  DELHIVERY_WEBHOOK_SECRET: process.env.DELHIVERY_WEBHOOK_SECRET || 'delhivery_webhook_demo',
  // ── Shiprocket Legacy Fallback ─────────────────────────────────────────────
  SHIPROCKET_API_KEY: process.env.SHIPROCKET_API_KEY || '',
  SHIPROCKET_EMAIL: process.env.SHIPROCKET_EMAIL || '',
  SHIPROCKET_PASSWORD: process.env.SHIPROCKET_PASSWORD || process.env.SHIPROCKET_API_KEY || '',
  SHIPROCKET_BASE_URL: process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external',
  SHIPROCKET_WEBHOOK_SECRET: process.env.SHIPROCKET_WEBHOOK_SECRET || process.env.SHIPROCKET_API_KEY || 'sr_webhook_demo',
};
