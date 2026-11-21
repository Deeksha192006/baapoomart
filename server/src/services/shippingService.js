/**
 * Complete Shiprocket Shipping Service — Production Implementation
 *
 * Replaces the stub shippingService.js entirely.
 * Handles the full lifecycle:
 *  1. Serviceability check
 *  2. Order/shipment creation in Shiprocket (idempotent)
 *  3. AWB assignment
 *  4. Pickup scheduling
 *  5. Label/Manifest generation
 *  6. Live tracking
 *  7. Webhook processing (with deduplication)
 *  8. Cancellation & returns
 *  9. Master order status roll-up
 *
 * Key invariants:
 *  - Each VendorOrder has exactly ONE Shipment record
 *  - Shiprocket is called only when BAAPOO MART order is paid
 *  - Vendor-specific pickup address is always used (never a global default)
 *  - COD amounts are allocated per-vendor shipment
 *  - No duplicate shipment creation (idempotency enforced)
 */

import { Shipment } from '../models/Shipment.js';
import { VendorOrder } from '../models/VendorOrder.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { ShipmentTrackingEvent } from '../models/ShipmentTrackingEvent.js';
import { ShippingException } from '../models/ShippingException.js';
import { ShiprocketWebhookEvent } from '../models/ShiprocketWebhookEvent.js';
import { VendorShippingAddress } from '../models/VendorShippingAddress.js';
import { delhiveryProvider } from './courier/delhiveryProvider.js';
import { shiprocketProvider } from './courier/shiprocketProvider.js';
import { providerFactory } from './courier/providerFactory.js';
import { shiprocketPickupService } from './shiprocketPickupService.js';
import { ApiError } from '../utils/ApiError.js';
import { ERROR_CODES } from '../constants/responseCodes.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize weight to KG (Shiprocket expects KG).
 * Internal units can be GRAM, KG, LBS, OZ.
 */
function normalizeWeightToKg(weight, unit = 'KG') {
  const w = parseFloat(weight) || 0;
  switch ((unit || 'KG').toUpperCase()) {
    case 'GRAM': return w / 1000;
    case 'LBS':  return w * 0.453592;
    case 'OZ':   return w * 0.0283495;
    default:     return w; // KG or unknown
  }
}

/**
 * Calculate total shipment weight for a vendor suborder's items.
 * Fetches product weights from DB for accuracy.
 */
async function calculateShipmentWeight(items) {
  let totalKg = 0;
  const missingWeight = [];

  for (const item of items) {
    const product = await Product.findById(item.productId).select('weight weightUnit name');
    if (!product || !product.weight || product.weight <= 0) {
      missingWeight.push(item.productNameSnapshot || item.name || item.productId);
      totalKg += 0.5 * item.quantity; // Fallback: 500g per unit
    } else {
      totalKg += normalizeWeightToKg(product.weight, product.weightUnit) * item.quantity;
    }
  }

  return { totalKg: Math.max(totalKg, 0.1), missingWeight };
}

/**
 * Get package dimensions from product data.
 * Returns max dimensions when multiple products are in the shipment.
 */
async function calculateShipmentDimensions(items) {
  let maxLength = 10, maxWidth = 10, maxHeight = 10;

  for (const item of items) {
    const product = await Product.findById(item.productId).select('length width height dimensionUnit');
    if (product && product.length > 0) {
      // Convert to CM if needed
      const factor = (product.dimensionUnit || 'CM').toUpperCase() === 'INCH' ? 2.54 : 1;
      maxLength = Math.max(maxLength, (product.length || 10) * factor);
      maxWidth = Math.max(maxWidth, (product.width || 10) * factor);
      maxHeight = Math.max(maxHeight, (product.height || 10) * factor);
    }
  }

  return {
    length: parseFloat(maxLength.toFixed(2)),
    breadth: parseFloat(maxWidth.toFixed(2)),
    height: parseFloat(maxHeight.toFixed(2)),
  };
}

/**
 * Build Shiprocket order items array from VendorOrder items.
 */
function buildShiprocketItems(items) {
  return items.map((item) => ({
    name: item.productNameSnapshot || item.name,
    sku: item.skuSnapshot || item.variantSku || item.productId.toString(),
    units: item.quantity,
    sellingPrice: item.unitPrice || item.price,
    discount: item.discountSnapshot || 0,
    tax: item.taxSnapshot || 0,
    hsn: '',
  }));
}

/**
 * Extract delivery address from the parent order's deliveryAddressSnapshot.
 */
function extractDeliveryAddress(deliveryAddressSnapshot) {
  const addr = deliveryAddressSnapshot || {};
  return {
    streetAddress: addr.streetAddress || addr.street || addr.addressLine1 || '',
    city: addr.city || '',
    state: addr.state || '',
    postalCode: addr.postalCode || addr.zip || addr.pincode || '',
    country: addr.country || 'India',
    name: addr.name || addr.customerName || '',
    phone: addr.phone || '',
    email: addr.email || '',
  };
}

// ─── Main Service ─────────────────────────────────────────────────────────────

export const shippingService = {

  // ────────────────────────────────────────────────────────────────────────────
  // 1. SERVICEABILITY CHECK
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Check courier serviceability for a vendor suborder.
   * Returns available couriers with rates and ETD.
   */
  async checkServiceability(suborderId, vendorId) {
    const suborder = await VendorOrder.findOne({ _id: suborderId, vendorId });
    if (!suborder) throw new ApiError(404, 'Suborder not found', ERROR_CODES.NOT_FOUND);

    const masterOrder = await Order.findById(suborder.parentOrderId);
    if (!masterOrder) throw new ApiError(404, 'Master order not found', ERROR_CODES.NOT_FOUND);

    const originAddress = await shiprocketPickupService.getDefaultPickupAddress(vendorId);
    const destAddr = extractDeliveryAddress(masterOrder.deliveryAddressSnapshot);

    // Calculate weight
    const { totalKg, missingWeight } = await calculateShipmentWeight(suborder.items);

    const isCOD = masterOrder.paymentMethod === 'COD';

    const courierProv = providerFactory.getProvider('DELHIVERY');
    const serviceability = await courierProv.getServiceability(
      originAddress.pincode,
      destAddr.postalCode,
      totalKg,
      isCOD ? 1 : 0
    );

    return {
      ...serviceability,
      packageWeight: totalKg,
      missingWeightProducts: missingWeight,
      originPincode: originAddress.pincode,
      destinationPincode: destAddr.postalCode,
    };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 2. SHIPMENT CREATION (Idempotent)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Create a Shiprocket shipment for a vendor suborder.
   *
   * @param {string} suborderId - VendorOrder _id
   * @param {string} vendorId - Vendor _id
   * @param {object} options - { courierCompanyId? (preferred courier), forceRecreate? }
   */
  async createShipment(suborderId, vendorId, options = {}) {
    // Validate suborder
    const suborder = await VendorOrder.findOne({ _id: suborderId, vendorId });
    if (!suborder) throw new ApiError(404, 'Suborder not found', ERROR_CODES.NOT_FOUND);

    if (!['READY_TO_SHIP', 'CONFIRMED', 'PROCESSING', 'PACKED'].includes(suborder.status)) {
      throw new ApiError(
        400,
        `Suborder status is "${suborder.status}". Shipment can only be created when status is READY_TO_SHIP, CONFIRMED, PROCESSING, or PACKED.`,
        ERROR_CODES.BAD_REQUEST
      );
    }

    // Idempotency: prevent duplicate shipments
    const existingShipment = await Shipment.findOne({ suborderId });
    if (existingShipment && existingShipment.status !== 'DRAFT') {
      return existingShipment; // Already created — return existing
    }

    // Get master order and verify payment
    const masterOrder = await Order.findById(suborder.parentOrderId);
    if (!masterOrder) throw new ApiError(404, 'Master order not found', ERROR_CODES.NOT_FOUND);

    const isCOD = masterOrder.paymentMethod === 'COD';
    if (!isCOD && masterOrder.paymentStatus !== 'PAID') {
      throw new ApiError(
        400,
        'Cannot create shipment for an unpaid non-COD order. Wait for payment confirmation.',
        ERROR_CODES.BAD_REQUEST
      );
    }

    // Get vendor pickup address
    const originAddress = await shiprocketPickupService.getDefaultPickupAddress(vendorId);

    // Ensure Shiprocket pickup location is registered
    const pickupLocationName = await shiprocketPickupService.ensurePickupLocation(vendorId, originAddress);

    // Calculate package dimensions and weight
    const { totalKg, missingWeight } = await calculateShipmentWeight(suborder.items);
    const dimensions = await calculateShipmentDimensions(suborder.items);

    if (missingWeight.length > 0) {
      console.warn(`[Shipping] Products with missing weight data (using 500g fallback): ${missingWeight.join(', ')}`);
    }

    // Build delivery address from master order
    const deliveryAddr = extractDeliveryAddress(masterOrder.deliveryAddressSnapshot);

    if (!deliveryAddr.postalCode) {
      throw new ApiError(400, 'Customer delivery address is missing a PIN code', ERROR_CODES.BAD_REQUEST);
    }

    // Calculate COD amount for this vendor's portion
    let codAmount = 0;
    if (isCOD) {
      // Allocate COD proportionally to this suborder's grand total
      codAmount = suborder.grandTotal + (suborder.shippingTotal || 0);
    }

    // Build order number for Shiprocket (must be unique per Shiprocket account)
    const srOrderRef = `BM-${suborder.subOrderNumber || suborder.publicSuborderId || suborderId}`;

    // Draft shipment record (local) — prevents race conditions
    let shipment = existingShipment;
    if (!shipment) {
      shipment = await Shipment.create({
        suborderId,
        vendorId,
        parentOrderId: masterOrder._id,
        courierProvider: 'DELHIVERY',
        courierName: 'Delhivery Express',
        courierOrderId: srOrderRef,
        originAddressSnapshot: originAddress.toObject ? originAddress.toObject() : originAddress,
        destinationAddressSnapshot: masterOrder.deliveryAddressSnapshot,
        pickupLocationName,
        packageWeight: totalKg,
        length: dimensions.length,
        width: dimensions.breadth,
        height: dimensions.height,
        shippingCharge: suborder.shippingTotal || 0,
        isCOD,
        codAmount,
        status: 'DRAFT',
      });
    }

    // Track attempts for debugging
    shipment.shiprocketCreationAttempts = (shipment.shiprocketCreationAttempts || 0) + 1;
    shipment.lastCreationAttemptAt = new Date();

    // Call Delhivery Logistics API to create shipment
    try {
      const activeCourier = providerFactory.getProvider('DELHIVERY');
      const srResult = await activeCourier.createOrder({
        orderNumber: srOrderRef,
        orderDate: masterOrder.createdAt?.toISOString()?.split('T')[0] || new Date().toISOString().split('T')[0],
        customerName: deliveryAddr.name || masterOrder.deliveryAddressSnapshot?.name || 'Customer',
        customerEmail: deliveryAddr.email || '',
        customerPhone: deliveryAddr.phone || masterOrder.deliveryAddressSnapshot?.phone || '',
        deliveryAddress: deliveryAddr,
        pickupLocation: pickupLocationName || originAddress.businessName || 'BAAPOO_MART_HUB',
        sellerAddress: originAddress,
        sellerName: originAddress.businessName || 'BAAPOO MART Merchant',
        items: buildShiprocketItems(suborder.items),
        weight: totalKg,
        length: dimensions.length,
        breadth: dimensions.breadth,
        height: dimensions.height,
        paymentMethod: isCOD ? 'COD' : 'Prepaid',
        subTotal: suborder.itemsSubtotal,
        codAmount,
        shippingCharge: suborder.shippingTotal || 0,
      });

      if (!srResult.success) {
        throw new Error(srResult.rawResponse?.message || 'Delhivery shipment creation returned unsuccessful status');
      }

      // Update shipment with Delhivery IDs and Waybill
      shipment.courierProvider = 'DELHIVERY';
      shipment.courierName = srResult.courierName || 'Delhivery Express';
      shipment.courierOrderId = srResult.courierOrderId || srOrderRef;
      if (srResult.awbNumber) {
        shipment.awbNumber = srResult.awbNumber;
        shipment.delhiveryWaybill = srResult.awbNumber;
        shipment.trackingUrl = srResult.trackingUrl || `https://www.delhivery.com/track/package/${srResult.awbNumber}`;
        shipment.status = 'AWB_ASSIGNED';
        suborder.status = 'READY_TO_SHIP';
      } else {
        shipment.status = 'CREATED';
        suborder.status = 'SHIPMENT_CREATED';
      }
      await shipment.save();
      await suborder.save();

      // Auto-assign AWB if not yet assigned and courier was specified
      if (!shipment.awbNumber && options.courierCompanyId) {
        try {
          await this.assignAWB(shipment._id.toString(), vendorId, options.courierCompanyId);
        } catch (awbErr) {
          console.warn('[Shipping] Delhivery AWB auto-assignment failed, will retry manually:', awbErr.message);
        }
      }

      console.log(`[Shipping] Delhivery shipment created for suborder ${suborderId}. AWB: ${shipment.awbNumber || 'Pending'}`);
      return shipment;

    } catch (error) {
      // Log exception without deleting the draft
      await ShippingException.create({
        shipmentId: shipment._id,
        provider: 'DELHIVERY',
        errorCode: error.statusCode?.toString() || 'UNKNOWN',
        errorMessage: error.message || 'Delhivery shipment creation failed',
        requestReference: srOrderRef,
      });

      // Reset status back to DRAFT so retry is possible
      shipment.status = 'DRAFT';
      await shipment.save();

      throw new ApiError(
        502,
        `Failed to create Delhivery shipment: ${error.message}`,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 3. AWB ASSIGNMENT
  // ────────────────────────────────────────────────────────────────────────────

  async assignAWB(shipmentId, vendorId, courierCompanyId = 1) {
    const shipment = await Shipment.findOne({ _id: shipmentId, vendorId });
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    if (shipment.awbNumber) {
      return shipment; // Already assigned
    }

    try {
      const activeCourier = providerFactory.getProvider('DELHIVERY');
      const result = await activeCourier.assignAWB(
        shipment.delhiveryWaybill || shipment.awbNumber || shipment._id.toString(),
        courierCompanyId
      );

      if (!result.success || !result.awbNumber) {
        throw new Error(result.rawResponse?.message || 'Delhivery AWB assignment failed');
      }

      shipment.awbNumber = result.awbNumber;
      shipment.delhiveryWaybill = result.awbNumber;
      shipment.courierProvider = 'DELHIVERY';
      shipment.courierName = result.courierName || 'Delhivery Express';
      shipment.courierCompanyId = courierCompanyId;
      shipment.trackingUrl = result.trackingUrl || `https://www.delhivery.com/track/package/${result.awbNumber}`;
      shipment.status = 'AWB_ASSIGNED';
      await shipment.save();

      // Update suborder status
      const suborder = await VendorOrder.findById(shipment.suborderId);
      if (suborder && ['SHIPMENT_CREATED', 'CREATED', 'DRAFT'].includes(suborder.status)) {
        suborder.status = 'READY_TO_SHIP';
        await suborder.save();
      }

      // Create initial tracking event
      await ShipmentTrackingEvent.create({
        shipmentId: shipment._id,
        provider: 'DELHIVERY',
        providerEventId: `awb_${result.awbNumber}`,
        providerStatus: 'AWB Assigned',
        internalStatus: 'AWB_ASSIGNED',
        location: 'Delhivery Hub',
        description: `AWB ${result.awbNumber} assigned via ${result.courierName}`,
        eventTime: new Date(),
      }).catch(() => {});

      return shipment;
    } catch (error) {
      await ShippingException.create({
        shipmentId: shipment._id,
        provider: 'DELHIVERY',
        errorCode: 'AWB_FAILED',
        errorMessage: error.message,
        requestReference: `shipment:${shipmentId}`,
      });
      throw new ApiError(502, `AWB assignment failed: ${error.message}`, ERROR_CODES.INTERNAL_ERROR);
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 4. PICKUP SCHEDULING
  // ────────────────────────────────────────────────────────────────────────────

  async requestPickup(shipmentId, vendorId, pickupDate) {
    const shipment = await Shipment.findOne({ _id: shipmentId, vendorId });
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    // If pickup is already scheduled, return cleanly without throwing error
    if (['PICKUP_SCHEDULED', 'PICKUP_REQUESTED'].includes(shipment.status)) {
      return shipment;
    }

    if (!['CREATED', 'AWB_ASSIGNED', 'READY_TO_SHIP', 'DRAFT'].includes(shipment.status)) {
      throw new ApiError(
        400,
        `Shipment must be in CREATED or AWB_ASSIGNED status to schedule pickup. Current: ${shipment.status}`,
        ERROR_CODES.BAD_REQUEST
      );
    }

    try {
      const activeCourier = providerFactory.getProvider('DELHIVERY');
      const originAddress = shipment.originAddressSnapshot || {};
      const res = await activeCourier.requestPickup(
        shipment.awbNumber || shipment.delhiveryWaybill || shipment._id.toString(),
        pickupDate,
        {
          pickupLocation: shipment.pickupLocationName || originAddress.businessName || 'BAAPOO_MART_HUB',
          packageCount: shipment.packageCount || 1,
        }
      );

      shipment.status = 'PICKUP_REQUESTED';
      if (res.pickupScheduledDate || res.pickupToken) {
        shipment.pickupScheduledAt = res.pickupScheduledDate ? new Date(res.pickupScheduledDate) : new Date();
        shipment.pickupToken = res.pickupToken || '';
        shipment.delhiveryPickupId = res.pickupToken || '';
        shipment.status = 'PICKUP_SCHEDULED';
      }
      await shipment.save();

      // Update suborder
      const suborder = await VendorOrder.findById(shipment.suborderId);
      if (suborder) {
        suborder.status = 'PICKUP_SCHEDULED';
        await suborder.save();
      }

      await ShipmentTrackingEvent.create({
        shipmentId: shipment._id,
        provider: 'DELHIVERY',
        providerEventId: `pickup_${Date.now()}`,
        providerStatus: 'Pickup Scheduled',
        internalStatus: 'PICKUP_SCHEDULED',
        location: originAddress.city || 'Vendor Warehouse',
        description: `Carrier pickup scheduled with Delhivery Logistics (Token: ${res.pickupToken || 'Active'})`,
        eventTime: new Date(),
      }).catch(() => {});

      return shipment;
    } catch (error) {
      await ShippingException.create({
        shipmentId: shipment._id,
        provider: 'DELHIVERY',
        errorCode: 'PICKUP_FAILED',
        errorMessage: error.message,
        requestReference: `shipment:${shipmentId}`,
      });
      throw new ApiError(502, `Pickup scheduling failed: ${error.message}`, ERROR_CODES.INTERNAL_ERROR);
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 5. LABEL GENERATION
  // ────────────────────────────────────────────────────────────────────────────

  async generateLabel(shipmentId, requestingVendorId = null) {
    const query = { _id: shipmentId };
    if (requestingVendorId) query.vendorId = requestingVendorId;

    const shipment = await Shipment.findOne(query);
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    const activeCourier = providerFactory.getProvider('DELHIVERY');
    const waybill = shipment.awbNumber || shipment.delhiveryWaybill || shipment._id.toString();

    const result = await activeCourier.generateLabel(waybill);

    if (result.labelUrl) {
      shipment.labelUrl = result.labelUrl;
      await shipment.save();
    }

    return { labelUrl: shipment.labelUrl, shipment };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 6. MANIFEST GENERATION (Super Admin)
  // ────────────────────────────────────────────────────────────────────────────

  async generateManifest(shipmentIds) {
    const shipments = await Shipment.find({ _id: { $in: shipmentIds } });
    const waybills = shipments.map((s) => s.awbNumber || s.delhiveryWaybill).filter(Boolean);

    if (waybills.length === 0) {
      throw new ApiError(400, 'No valid Delhivery Waybill / AWB numbers found', ERROR_CODES.BAD_REQUEST);
    }

    const activeCourier = providerFactory.getProvider('DELHIVERY');
    const result = await activeCourier.generateManifest(waybills);

    if (result.manifestUrl) {
      await Shipment.updateMany(
        { _id: { $in: shipmentIds } },
        { $set: { manifestUrl: result.manifestUrl } }
      );
    }

    return result;
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 7. LIVE TRACKING
  // ────────────────────────────────────────────────────────────────────────────

  async trackShipment(shipmentId, requestingUserId = null, requestingRole = null) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    // Role-based access control
    if (requestingRole === 'VENDOR') {
      const { Vendor } = await import('../models/Vendor.js');
      const vendor = await Vendor.findOne({ userId: requestingUserId });
      if (!vendor || shipment.vendorId.toString() !== vendor._id.toString()) {
        throw new ApiError(403, 'Access denied: This shipment belongs to another vendor', ERROR_CODES.FORBIDDEN);
      }
    }

    if (requestingRole === 'CUSTOMER') {
      const suborder = await VendorOrder.findById(shipment.suborderId);
      if (!suborder || suborder.userId.toString() !== requestingUserId.toString()) {
        throw new ApiError(403, 'Access denied: This shipment does not belong to your order', ERROR_CODES.FORBIDDEN);
      }
    }

    // Get stored tracking events
    const storedEvents = await ShipmentTrackingEvent.find({ shipmentId }).sort({ eventTime: -1 });

    // Live tracking if AWB exists
    let liveTracking = null;
    if (shipment.awbNumber) {
      try {
        const activeCourier = providerFactory.getProvider('DELHIVERY');
        liveTracking = await activeCourier.trackByAWB(shipment.awbNumber);

        // Ensure tracking URL always points to Delhivery package tracking
        if (!shipment.trackingUrl || shipment.trackingUrl.includes('shiprocket.co')) {
          shipment.trackingUrl = `https://www.delhivery.com/track/package/${shipment.awbNumber}`;
          await shipment.save();
        }

        // Sync latest status
        if (liveTracking?.currentStatus) {
          const mapped = activeCourier.mapStatus ? activeCourier.mapStatus(liveTracking.currentStatus) : liveTracking.currentStatus;
          const STATUS_PRIORITY = [
            'DRAFT', 'READY', 'CREATED', 'AWB_ASSIGNED', 'PICKUP_REQUESTED',
            'PICKUP_SCHEDULED', 'PICKUP_FAILED', 'PICKED_UP', 'IN_TRANSIT',
            'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED',
            'RETURN_INITIATED', 'RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED',
          ];
          const currentPriority = STATUS_PRIORITY.indexOf(shipment.status);
          const newPriority = STATUS_PRIORITY.indexOf(mapped);
          if (newPriority > currentPriority) {
            shipment.status = mapped;
            if (mapped === 'DELIVERED' && !shipment.deliveredAt) shipment.deliveredAt = new Date();
            if (mapped === 'PICKED_UP' && !shipment.pickedUpAt) shipment.pickedUpAt = new Date();
            await shipment.save();

            // Sync VendorOrder status
            const suborder = await VendorOrder.findById(shipment.suborderId);
            if (suborder) {
              suborder.status = mapped;
              await suborder.save();
              await this.syncMasterOrderStatus(suborder.parentOrderId);
            }
          }
        }
      } catch (e) {
        console.warn('[Shipping] Live tracking fetch failed:', e.message);
      }
    }

    return {
      shipment,
      trackingEvents: storedEvents,
      liveTracking,
    };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 8. WEBHOOK PROCESSING
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Process an incoming Shiprocket webhook event.
   * Validates authenticity via x-api-key header (SHIPROCKET_WEBHOOK_SECRET).
   * Deduplicates events via eventKey.
   */
  async handleWebhook(payload, providedApiKey) {
    // Validate webhook secret (if configured)
    const expectedSecret = env.SHIPROCKET_WEBHOOK_SECRET;
    if (expectedSecret && expectedSecret !== 'sr_webhook_demo') {
      if (providedApiKey !== expectedSecret) {
        console.warn('[Shiprocket Webhook] Invalid x-api-key received');
        throw new ApiError(401, 'Webhook authentication failed', ERROR_CODES.UNAUTHORIZED);
      }
    }

    const {
      awb,
      courier_name,
      current_status,
      current_status_id,
      shipment_status,
      shipment_status_id,
      current_timestamp,
      order_id,
      sr_order_id,
      is_return,
      scans,
    } = payload;

    if (!awb) {
      console.warn('[Shiprocket Webhook] Missing AWB in payload');
      return { success: false, reason: 'missing_awb' };
    }

    // Build deduplication key
    const eventKey = crypto
      .createHash('sha256')
      .update(`${awb}:${current_status_id}:${current_timestamp || ''}`)
      .digest('hex');

    // Create webhook record (will fail on duplicate due to unique index)
    let webhookEvent;
    try {
      webhookEvent = await ShiprocketWebhookEvent.create({
        eventKey,
        awbNumber: awb,
        shiprocketOrderId: sr_order_id?.toString() || '',
        channelOrderId: order_id?.toString() || '',
        courierName: courier_name || '',
        currentStatus: current_status || '',
        currentStatusId: parseInt(current_status_id) || null,
        shipmentStatus: shipment_status || '',
        shipmentStatusId: parseInt(shipment_status_id) || null,
        eventTimestamp: current_timestamp || '',
        isReturn: !!is_return,
        scansPayload: scans || [],
        rawPayload: payload,
      });
    } catch (e) {
      if (e.code === 11000) {
        // Duplicate — already processed
        console.log(`[Shiprocket Webhook] Duplicate event for AWB ${awb}, skipping.`);
        return { success: true, reason: 'duplicate_skipped' };
      }
      throw e;
    }

    // Find the internal shipment
    const shipment = await Shipment.findOne({ awbNumber: awb });
    if (!shipment) {
      await ShiprocketWebhookEvent.findByIdAndUpdate(webhookEvent._id, {
        processingStatus: 'SKIPPED',
        processingError: 'No matching shipment found for AWB',
        processedAt: new Date(),
      });
      console.warn(`[Shiprocket Webhook] No shipment found for AWB ${awb}`);
      return { success: false, reason: 'shipment_not_found' };
    }

    const internalStatus = shiprocketProvider.mapStatus(current_status, current_status_id);

    try {
      // Store individual scan events
      if (Array.isArray(scans) && scans.length > 0) {
        for (const scan of scans) {
          try {
            const scanEventId = crypto
              .createHash('sha256')
              .update(`${awb}:${scan.date}:${scan.status}`)
              .digest('hex');

            await ShipmentTrackingEvent.create({
              shipmentId: shipment._id,
              provider: 'SHIPROCKET',
              providerEventId: scanEventId,
              providerStatus: scan['sr-status-label'] || scan.status || current_status,
              internalStatus: shiprocketProvider.mapStatus(scan['sr-status-label'] || scan.status, scan['sr-status']),
              location: scan.location || '',
              description: scan.activity || '',
              eventTime: new Date(scan.date) || new Date(),
            });
          } catch (dupErr) {
            if (dupErr.code !== 11000) console.warn('[Webhook] Scan event insert error:', dupErr.message);
          }
        }
      } else {
        // Fallback: create single event from top-level status
        try {
          await ShipmentTrackingEvent.create({
            shipmentId: shipment._id,
            provider: 'SHIPROCKET',
            providerEventId: eventKey,
            providerStatus: current_status || shipment_status,
            internalStatus,
            location: '',
            description: current_status || '',
            eventTime: current_timestamp ? new Date(current_timestamp) : new Date(),
          });
        } catch (dupErr) {
          if (dupErr.code !== 11000) console.warn('[Webhook] Event insert error:', dupErr.message);
        }
      }

      // Update shipment status (only progress forward, never regress)
      const STATUS_PRIORITY = [
        'DRAFT', 'READY', 'CREATED', 'AWB_ASSIGNED', 'PICKUP_REQUESTED',
        'PICKUP_SCHEDULED', 'PICKUP_FAILED', 'PICKED_UP', 'IN_TRANSIT',
        'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED',
        'RETURN_INITIATED', 'RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED',
      ];

      const currentPriority = STATUS_PRIORITY.indexOf(shipment.status);
      const newPriority = STATUS_PRIORITY.indexOf(internalStatus);

      if (newPriority >= currentPriority) {
        shipment.status = internalStatus;
        if (internalStatus === 'PICKED_UP' && !shipment.pickedUpAt) {
          shipment.pickedUpAt = new Date();
        }
        if (internalStatus === 'DELIVERED' && !shipment.deliveredAt) {
          shipment.deliveredAt = new Date();
        }
        await shipment.save();

        // Sync VendorOrder status
        const suborder = await VendorOrder.findById(shipment.suborderId);
        if (suborder) {
          suborder.status = internalStatus;
          if (internalStatus === 'DELIVERED') {
            suborder.deliveredAt = new Date();
            suborder.settlementStatus = 'ELIGIBLE';
          }
          await suborder.save();

          // Roll up to master order
          await this.syncMasterOrderStatus(suborder.parentOrderId);
        }
      }

      // Mark webhook event as processed
      await ShiprocketWebhookEvent.findByIdAndUpdate(webhookEvent._id, {
        processingStatus: 'PROCESSED',
        processedAt: new Date(),
        shipmentId: shipment._id,
      });

      return { success: true };

    } catch (error) {
      await ShiprocketWebhookEvent.findByIdAndUpdate(webhookEvent._id, {
        processingStatus: 'FAILED',
        processingError: error.message,
        processedAt: new Date(),
      });
      console.error('[Shiprocket Webhook] Processing error:', error);
      throw error;
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 9. MASTER ORDER STATUS ROLL-UP
  // ────────────────────────────────────────────────────────────────────────────

  async syncMasterOrderStatus(masterOrderId) {
    const suborders = await VendorOrder.find({ parentOrderId: masterOrderId });
    if (suborders.length === 0) return;

    const statuses = suborders.map((s) => s.status);
    const isAllDelivered = statuses.every((s) => s === 'DELIVERED');
    const isAnyDelivered = statuses.some((s) => s === 'DELIVERED');
    const isAllCancelled = statuses.every((s) => s === 'CANCELLED');
    const isAnyInTransit = statuses.some((s) => ['IN_TRANSIT', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(s));

    let newStatus = null;
    if (isAllDelivered) {
      newStatus = 'DELIVERED';
    } else if (isAnyDelivered) {
      newStatus = 'PARTIALLY_DELIVERED';
    } else if (isAllCancelled) {
      newStatus = 'CANCELLED';
    } else if (isAnyInTransit) {
      newStatus = 'IN_TRANSIT';
    }

    if (newStatus) {
      const masterOrder = await Order.findById(masterOrderId);
      if (masterOrder && masterOrder.orderStatus !== newStatus) {
        masterOrder.orderStatus = newStatus;
        await masterOrder.save();
      }
    }
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 10. CANCELLATION
  // ────────────────────────────────────────────────────────────────────────────

  async cancelShipment(shipmentId, reason = 'Cancelled by admin') {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    const nonCancellableStatuses = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
    if (nonCancellableStatuses.includes(shipment.status)) {
      throw new ApiError(
        400,
        `Cannot cancel shipment in "${shipment.status}" status`,
        ERROR_CODES.BAD_REQUEST
      );
    }

    // Cancel in courier (Delhivery) if waybill or order ID exists
    if (shipment.awbNumber || shipment.delhiveryWaybill) {
      try {
        const waybill = shipment.awbNumber || shipment.delhiveryWaybill;
        const activeCourier = providerFactory.getProvider(shipment.courierProvider || 'DELHIVERY');
        await activeCourier.cancelOrder(waybill);
      } catch (e) {
        console.warn('[Shipping] Delhivery cancellation API error (proceeding locally):', e.message);
      }
    } else if (shipment.shiprocketOrderId) {
      try {
        await shiprocketProvider.cancelOrder([shipment.shiprocketOrderId]);
      } catch (e) {
        console.warn('[Shipping] Legacy cancellation API error:', e.message);
      }
    }

    shipment.status = 'CANCELLED';
    shipment.cancellationReason = reason;
    shipment.cancelledAt = new Date();
    await shipment.save();

    const suborder = await VendorOrder.findById(shipment.suborderId);
    if (suborder) {
      suborder.status = 'CANCELLED';
      await suborder.save();
      await this.syncMasterOrderStatus(suborder.parentOrderId);
    }

    return shipment;
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 11. RETURN SHIPMENT
  // ────────────────────────────────────────────────────────────────────────────

  async createReturnShipment(shipmentId, returnPayload) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    if (shipment.status !== 'DELIVERED') {
      throw new ApiError(400, 'Return shipment can only be created for delivered shipments', ERROR_CODES.BAD_REQUEST);
    }

    if (shipment.returnShipmentId) {
      throw new ApiError(400, 'A return shipment already exists for this shipment', ERROR_CODES.BAD_REQUEST);
    }

    const activeCourier = providerFactory.getProvider('DELHIVERY');
    const result = await activeCourier.createReturnOrder({
      orderNumber: `RET-${shipment.courierOrderId || shipment._id}`,
      orderDate: new Date().toISOString().split('T')[0],
      customerName: returnPayload.pickupName || 'Customer',
      customerPhone: returnPayload.pickupPhone || '',
      deliveryAddress: {
        streetAddress: shipment.originAddressSnapshot?.addressLine1 || '',
        city: shipment.originAddressSnapshot?.district?.name || shipment.originAddressSnapshot?.city || '',
        state: shipment.originAddressSnapshot?.state?.name || shipment.originAddressSnapshot?.state || '',
        postalCode: shipment.originAddressSnapshot?.pincode || '',
        country: 'India',
      },
      sellerAddress: {
        addressLine1: returnPayload.pickupAddress || shipment.destinationAddressSnapshot?.streetAddress || '',
        city: returnPayload.pickupCity || shipment.destinationAddressSnapshot?.city || '',
        state: returnPayload.pickupState || shipment.destinationAddressSnapshot?.state || '',
        pincode: returnPayload.pickupPincode || shipment.destinationAddressSnapshot?.postalCode || '',
        phone: returnPayload.pickupPhone || '',
      },
      items: returnPayload.items || [],
      subTotal: returnPayload.subTotal || 0,
      length: shipment.length,
      breadth: shipment.width,
      height: shipment.height,
      weight: shipment.packageWeight,
    });

    if (result.success) {
      shipment.returnShipmentId = result.returnOrderId?.toString() || result.returnShipmentId?.toString();
      shipment.status = 'RETURN_INITIATED';
      await shipment.save();
    }

    return { shipment, result };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 12. ADMIN: GET ALL SHIPMENTS WITH FILTERS
  // ────────────────────────────────────────────────────────────────────────────

  async getShipments(filters = {}, page = 1, limit = 20) {
    const query = {};

    if (filters.vendorId) query.vendorId = filters.vendorId;
    if (filters.suborderId) query.suborderId = filters.suborderId;
    if (filters.status) query.status = filters.status;
    if (filters.awbNumber) query.awbNumber = { $regex: filters.awbNumber, $options: 'i' };
    if (filters.courierName) query.courierName = { $regex: filters.courierName, $options: 'i' };
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.createdAt.$lte = new Date(filters.dateTo);
    }

    const [shipments, total] = await Promise.all([
      Shipment.find(query)
        .populate('vendorId', 'storeName email')
        .populate('suborderId', 'subOrderNumber publicSuborderId grandTotal')
        .populate('parentOrderId', 'orderNumber publicOrderId')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Shipment.countDocuments(query),
    ]);

    return { shipments, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 13. VENDOR: GET MY SHIPMENTS
  // ────────────────────────────────────────────────────────────────────────────

  async getVendorShipments(vendorId, filters = {}, page = 1, limit = 20) {
    return this.getShipments({ ...filters, vendorId }, page, limit);
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 14. CUSTOMER: GET SHIPMENTS FOR ORDER
  // ────────────────────────────────────────────────────────────────────────────

  async getOrderShipments(masterOrderId, userId) {
    // Validate the order belongs to this user
    const masterOrder = await Order.findOne({ _id: masterOrderId, userId });
    if (!masterOrder) throw new ApiError(404, 'Order not found', ERROR_CODES.NOT_FOUND);

    const suborders = await VendorOrder.find({ parentOrderId: masterOrderId });
    const suborderIds = suborders.map((s) => s._id);

    const shipments = await Shipment.find({ suborderId: { $in: suborderIds } })
      .populate('vendorId', 'storeName')
      .populate('suborderId', 'subOrderNumber vendorNameSnapshot items grandTotal');

    // Attach tracking events
    const shipmentsWithEvents = await Promise.all(
      shipments.map(async (s) => {
        const events = await ShipmentTrackingEvent.find({ shipmentId: s._id })
          .sort({ eventTime: -1 })
          .limit(20);
        return { ...s.toObject(), trackingEvents: events };
      })
    );

    return { masterOrder, shipments: shipmentsWithEvents };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 15. ADMIN: SHIPPING DASHBOARD STATS
  // ────────────────────────────────────────────────────────────────────────────

  async getShippingStats() {
    const { Order } = await import('../models/Order.js');
    const { ReturnRequest } = await import('../models/ReturnRequest.js');

    const [
      totalOrders,
      totalShipments,
      pendingShipments,
      readyForPickup,
      pickedUp,
      inTransit,
      delivered,
      delayedShipments,
      cancelledShipments,
      returnRequests,
      approvedReturns,
      rejectedReturns,
      pendingRefunds,
      completedRefunds,
      failedRefunds,
      rtoShipments,
    ] = await Promise.all([
      Order.countDocuments().catch(() => 0),
      Shipment.countDocuments().catch(() => 0),
      Shipment.countDocuments({ status: { $in: ['DRAFT', 'READY', 'CREATED'] } }).catch(() => 0),
      Shipment.countDocuments({ status: { $in: ['AWB_ASSIGNED', 'PICKUP_REQUESTED', 'PICKUP_SCHEDULED'] } }).catch(() => 0),
      Shipment.countDocuments({ status: 'PICKED_UP' }).catch(() => 0),
      Shipment.countDocuments({ status: { $in: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'SHIPPED'] } }).catch(() => 0),
      Shipment.countDocuments({ status: 'DELIVERED' }).catch(() => 0),
      Shipment.countDocuments({
        status: { $in: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'SHIPPED'] },
        estimatedDeliveryDate: { $lt: new Date() },
      }).catch(() => 0),
      Shipment.countDocuments({ status: 'CANCELLED' }).catch(() => 0),
      ReturnRequest.countDocuments().catch(() => 0),
      ReturnRequest.countDocuments({ status: { $in: ['APPROVED', 'COMPLETED'] }, requestType: { $in: ['RETURN', 'REPLACEMENT'] } }).catch(() => 0),
      ReturnRequest.countDocuments({ status: 'REJECTED' }).catch(() => 0),
      ReturnRequest.countDocuments({ 'refundDetails.refundStatus': { $in: ['PENDING', 'PROCESSING'] } }).catch(() => 0),
      ReturnRequest.countDocuments({ 'refundDetails.refundStatus': 'COMPLETED' }).catch(() => 0),
      ReturnRequest.countDocuments({ 'refundDetails.refundStatus': 'FAILED' }).catch(() => 0),
      Shipment.countDocuments({ status: { $in: ['DELIVERY_FAILED', 'RETURN_INITIATED', 'RETURN_IN_TRANSIT', 'RETURNED'] } }).catch(() => 0),
    ]);

    return {
      totalOrders,
      totalShipments,
      pendingShipments,
      readyForPickup,
      pickedUp,
      inTransit,
      delivered,
      delayedShipments,
      cancelledShipments,
      returnRequests,
      approvedReturns,
      rejectedReturns,
      pendingRefunds,
      completedRefunds,
      failedRefunds,
      rtoShipments,
      // Status counters for backwards compatibility
      total: totalShipments,
      PENDING: pendingShipments,
      READY_FOR_PICKUP: readyForPickup,
      IN_TRANSIT: inTransit,
      DELIVERED: delivered,
      CANCELLED: cancelledShipments,
    };
  },

  // ────────────────────────────────────────────────────────────────────────────
  // 16. RETRY FAILED SHIPMENT CREATION
  // ────────────────────────────────────────────────────────────────────────────

  async retryShipmentCreation(shipmentId, adminUserId) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new ApiError(404, 'Shipment not found', ERROR_CODES.NOT_FOUND);

    if (!['DRAFT'].includes(shipment.status)) {
      throw new ApiError(400, 'Only DRAFT shipments can be retried', ERROR_CODES.BAD_REQUEST);
    }

    // Retry by calling createShipment again
    return this.createShipment(shipment.suborderId, shipment.vendorId, {});
  },
};

export default shippingService;
