/**
 * Delhivery API HTTP Client
 * Handles authentication and requests to Delhivery B2C Express API.
 * Supports Staging (sandbox) and Production environments.
 *
 * Staging URL: https://staging-express.delhivery.com
 * Production URL: https://track.delhivery.com
 */

import axios from 'axios';
import { env } from '../../config/env.js';

const DELHIVERY_BASE_URL = env.DELHIVERY_BASE_URL || 'https://staging-express.delhivery.com';
const TIMEOUT_MS = 15000;

/**
 * Check if a real Delhivery API token is configured (not empty and not default placeholder)
 */
export function isDelhiveryConfigured() {
  const token = env.DELHIVERY_API_KEY;
  return Boolean(token && token !== 'delhivery_api_token_test' && token.trim().length > 8);
}

/**
 * Helper to build auth headers
 */
function getHeaders(contentType = 'application/json') {
  const token = env.DELHIVERY_API_KEY || 'delhivery_api_token_test';
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': contentType,
    'Accept': 'application/json',
  };
}

/**
 * Perform a GET request to Delhivery API
 */
export async function delhiveryGet(endpoint, params = {}) {
  const url = `${DELHIVERY_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  try {
    const res = await axios.get(url, {
      params,
      headers: getHeaders(),
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    const msg = (typeof data === 'string' ? data : data?.message || data?.error || err.message);
    const error = new Error(`Delhivery GET ${endpoint} failed (${status || 'NET_ERR'}): ${msg}`);
    error.statusCode = status;
    error.data = data;
    throw error;
  }
}

/**
 * Perform a POST request to Delhivery API
 * @param {string} endpoint - API route
 * @param {any} data - Request body
 * @param {boolean} isFormUrlEncoded - Whether body should be urlencoded
 */
export async function delhiveryPost(endpoint, data, isFormUrlEncoded = false) {
  const url = `${DELHIVERY_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  const contentType = isFormUrlEncoded
    ? 'application/x-www-form-urlencoded'
    : 'application/json';

  try {
    const res = await axios.post(url, data, {
      headers: getHeaders(contentType),
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const responseData = err.response?.data;
    const msg = (typeof responseData === 'string' ? responseData : responseData?.message || responseData?.error || err.message);
    const error = new Error(`Delhivery POST ${endpoint} failed (${status || 'NET_ERR'}): ${msg}`);
    error.statusCode = status;
    error.data = responseData;
    throw error;
  }
}
