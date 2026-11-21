/**
 * Shiprocket API HTTP Client
 * Handles authentication, token management, and all raw API calls.
 * Supports both API User login (Email + Password) and direct API Key usage.
 */

import axios from 'axios';
import { env } from '../../config/env.js';

const SHIPROCKET_BASE_URL = env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// In-memory token cache (per-process; for multi-instance deployments, use Redis)
let _tokenCache = {
  token: null,
  expiresAt: null,
};

/**
 * Authenticate with Shiprocket and get a Bearer token.
 * Tokens are valid for 24 hours per Shiprocket docs.
 */
async function authenticate() {
  const email = env.SHIPROCKET_EMAIL;
  const password = env.SHIPROCKET_PASSWORD || env.SHIPROCKET_API_KEY;

  if (email && password) {
    try {
      const res = await axios.post(
        `${SHIPROCKET_BASE_URL}/auth/login`,
        {
          email,
          password,
        },
        { timeout: 10000 }
      );

      if (res.data && res.data.token) {
        _tokenCache = {
          token: res.data.token,
          expiresAt: Date.now() + 23 * 60 * 60 * 1000 + 55 * 60 * 1000,
        };
        console.log('[Shiprocket] Auth token obtained successfully via login.');
        return _tokenCache.token;
      }
    } catch (loginErr) {
      console.warn(
        `[Shiprocket] Login attempt with ${email} returned ${loginErr.response?.status || loginErr.message}.`
      );
      if (env.SHIPROCKET_API_KEY) {
        console.log('[Shiprocket] Using provided SHIPROCKET_API_KEY directly for API requests.');
        _tokenCache = {
          token: env.SHIPROCKET_API_KEY,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        };
        return _tokenCache.token;
      }
      throw loginErr;
    }
  }

  if (env.SHIPROCKET_API_KEY) {
    console.log('[Shiprocket] Using provided SHIPROCKET_API_KEY directly.');
    _tokenCache = {
      token: env.SHIPROCKET_API_KEY,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    return _tokenCache.token;
  }

  throw new Error(
    'Shiprocket credentials missing: Please provide SHIPROCKET_API_KEY or SHIPROCKET_EMAIL & SHIPROCKET_PASSWORD in server/.env'
  );
}

/**
 * Get a valid Bearer token, refreshing if expired.
 */
async function getToken() {
  const needsRefresh =
    !_tokenCache.token ||
    !_tokenCache.expiresAt ||
    Date.now() >= _tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS;

  if (needsRefresh) {
    await authenticate();
  }

  return _tokenCache.token;
}

/**
 * Build an axios instance with the current Bearer token.
 */
async function buildClient() {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (env.SHIPROCKET_API_KEY) {
    headers['x-api-key'] = env.SHIPROCKET_API_KEY;
  }

  return axios.create({
    baseURL: SHIPROCKET_BASE_URL,
    timeout: 15000,
    headers,
  });
}

/**
 * Make a GET request to Shiprocket API.
 * @param {string} path - API path (relative to base URL)
 * @param {object} params - Query parameters
 */
export async function srGet(path, params = {}) {
  const client = await buildClient();
  try {
    const res = await client.get(path, { params });
    return res.data;
  } catch (err) {
    handleApiError(err, `GET ${path}`);
  }
}

/**
 * Make a POST request to Shiprocket API.
 * @param {string} path - API path
 * @param {object} data - Request body
 */
export async function srPost(path, data = {}) {
  const client = await buildClient();
  try {
    const res = await client.post(path, data);
    return res.data;
  } catch (err) {
    handleApiError(err, `POST ${path}`);
  }
}

/**
 * Make a PUT request to Shiprocket API.
 */
export async function srPut(path, data = {}) {
  const client = await buildClient();
  try {
    const res = await client.put(path, data);
    return res.data;
  } catch (err) {
    handleApiError(err, `PUT ${path}`);
  }
}

/**
 * Make a DELETE request to Shiprocket API.
 */
export async function srDelete(path, data = {}) {
  const client = await buildClient();
  try {
    const res = await client.delete(path, { data });
    return res.data;
  } catch (err) {
    handleApiError(err, `DELETE ${path}`);
  }
}

/**
 * Handle and re-throw Shiprocket API errors with useful context.
 */
function handleApiError(err, context) {
  if (err.response) {
    const { status, data } = err.response;
    const message =
      (data && (data.message || data.errors || JSON.stringify(data))) ||
      `HTTP ${status}`;
    console.error(`[Shiprocket] API error [${context}]: ${status} – ${message}`);

    if (status === 401 || status === 403) {
      console.info(
        '[Shiprocket Configuration Note] If you generated an API User in Shiprocket (Settings → API → Configure), please ensure SHIPROCKET_EMAIL in server/.env matches the dedicated email configured for that API User.'
      );
    }

    const apiErr = new Error(`Shiprocket API error: ${message}`);
    apiErr.statusCode = status;
    apiErr.shiprocketData = data;
    throw apiErr;
  }
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    console.error(`[Shiprocket] Timeout [${context}]`);
    const timeoutErr = new Error('Shiprocket API timed out. Please retry.');
    timeoutErr.statusCode = 503;
    throw timeoutErr;
  }
  console.error(`[Shiprocket] Network error [${context}]:`, err.message);
  throw err;
}

/**
 * Force-refresh the token (e.g., on 401 response).
 */
export async function refreshToken() {
  _tokenCache = { token: null, expiresAt: null };
  return authenticate();
}

export default { srGet, srPost, srPut, srDelete, refreshToken };
