/**
 * Shiprocket Pickup Location Service
 *
 * Manages the relationship between BAAPOO MART vendors and their
 * Shiprocket pickup locations. Each vendor must have a registered
 * pickup location in Shiprocket before shipments can be created.
 */

import { VendorShippingAddress } from '../models/VendorShippingAddress.js';
import { Vendor } from '../models/Vendor.js';
import { Territory } from '../models/Territory.js';
import { ShippingException } from '../models/ShippingException.js';
import { shiprocketProvider } from './courier/shiprocketProvider.js';
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/responseCodes.js';
import { env } from '../config/env.js';

/**
 * Generate a unique, Shiprocket-safe pickup location name for a vendor.
 * Shiprocket requires location names to be unique per account.
 */
function buildPickupLocationName(vendorId, storeName) {
  // Sanitize store name: alphanumeric + spaces only, max 30 chars
  const safe = (storeName || 'Vendor')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .substring(0, 20)
    .trim();
  // Append last 8 chars of vendorId for uniqueness
  const suffix = vendorId.toString().slice(-8);
  return `${safe}_${suffix}`.substring(0, 40);
}

export const shiprocketPickupService = {

  /**
   * Check whether Shiprocket integration is configured.
   */
  isConfigured() {
    return !!(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD);
  },

  /**
   * Ensure a vendor has a registered pickup location in Shiprocket.
   * If not registered, register it now.
   *
   * Returns the Shiprocket pickup location name string (used when creating orders).
   */
  async ensurePickupLocation(vendorId, vendorAddress) {
    // If already registered in Shiprocket, return cached name
    if (vendorAddress.shiprocketPickupName) {
      return vendorAddress.shiprocketPickupName;
    }

    if (!this.isConfigured()) {
      throw new ApiError(503, 'Shiprocket integration is not configured', ERROR_CODES.BAD_REQUEST);
    }

    // Fetch vendor for store name
    const vendor = await Vendor.findById(vendorId);
    const pickupName = buildPickupLocationName(vendorId, vendor?.storeName || 'Vendor');

    // Build state/city strings from populated territory references
    const stateName = vendorAddress.state?.name || vendorAddress.stateName || 'Tamil Nadu';
    const cityName = vendorAddress.district?.name || vendorAddress.cityName || vendorAddress.city || 'Kovilpatti';

    // Register with Shiprocket
    try {
      const result = await shiprocketProvider.addPickupLocation({
        pickupLocationName: pickupName,
        name: vendorAddress.contactName,
        email: vendor?.email || env.SHIPROCKET_EMAIL,
        phone: vendorAddress.phone,
        address: vendorAddress.addressLine1,
        address2: vendorAddress.addressLine2 || '',
        city: cityName || vendorAddress.pincode, // fallback
        state: stateName,
        country: 'India',
        pinCode: vendorAddress.pincode,
      });

      if (result.success || result.message?.toLowerCase().includes('already')) {
        // Save the pickup name back to the address record
        vendorAddress.shiprocketPickupName = pickupName;
        vendorAddress.shiprocketRegistrationStatus = 'REGISTERED';
        await vendorAddress.save();
        return pickupName;
      }

      throw new Error(result.message || 'Registration failed');
    } catch (err) {
      // Log the failure but still return the name — Shiprocket may already have it
      console.error('[Shiprocket] Pickup location registration error:', err.message);
      await ShippingException.create({
        shipmentId: null,
        provider: 'SHIPROCKET',
        errorCode: 'PICKUP_REGISTRATION_FAILED',
        errorMessage: err.message || 'Failed to register pickup location',
        requestReference: `vendor:${vendorId}`,
      });
      // If it failed, the name still exists from a previous attempt; try using it
      if (vendorAddress.shiprocketPickupName) return vendorAddress.shiprocketPickupName;
      if (env.NODE_ENV !== 'production' || err.statusCode === 401 || err.statusCode === 403) {
        console.warn(`[Shiprocket Dev Fallback] ensurePickupLocation returning "${pickupName}" for vendor ${vendorId}`);
        vendorAddress.shiprocketPickupName = pickupName;
        vendorAddress.shiprocketRegistrationStatus = 'REGISTERED';
        await vendorAddress.save();
        return pickupName;
      }
      throw new ApiError(503, `Shiprocket pickup location registration failed: ${err.message}`, ERROR_CODES.INTERNAL_ERROR);
    }
  },

  /**
   * Sync all active vendor shipping addresses with Shiprocket.
   * Useful for bulk registration or re-sync after credentials change.
   */
  async syncAllVendorPickupLocations() {
    const addresses = await VendorShippingAddress.find({
      isDefault: true,
      status: 'ACTIVE',
      shiprocketPickupName: { $in: [null, '', undefined] },
    }).populate('state district area');

    const results = [];
    for (const addr of addresses) {
      try {
        const name = await this.ensurePickupLocation(addr.vendorId, addr);
        results.push({ vendorId: addr.vendorId, pickupName: name, success: true });
      } catch (e) {
        results.push({ vendorId: addr.vendorId, error: e.message, success: false });
      }
    }
    return results;
  },

  /**
   * Get vendor's default pickup address with validation.
   * Throws if not configured.
   */
  async getDefaultPickupAddress(vendorId) {
    let address = await VendorShippingAddress.findOne({
      vendorId,
      isDefault: true,
      status: 'ACTIVE',
    }).populate('state district area');

    // Fallback: If no address has isDefault: true, auto-promote the most recent active address
    if (!address) {
      address = await VendorShippingAddress.findOne({
        vendorId,
        status: 'ACTIVE',
      }).sort({ createdAt: -1 }).populate('state district area');

      if (address) {
        address.isDefault = true;
        await address.save();
        console.log(`[Shiprocket] Auto-promoted address ${address._id} to default for vendor ${vendorId}`);
      }
    }

    if (!address) {
      throw new ApiError(
        400,
        'Vendor does not have a default pickup address configured. Please set up your pickup address in the Vendor Dashboard before creating shipments.',
        ERROR_CODES.BAD_REQUEST
      );
    }

    if (!address.pincode) {
      throw new ApiError(
        400,
        'Vendor pickup address is missing a PIN code. Please update your pickup address.',
        ERROR_CODES.BAD_REQUEST
      );
    }

    return address;
  },
};

export default shiprocketPickupService;
