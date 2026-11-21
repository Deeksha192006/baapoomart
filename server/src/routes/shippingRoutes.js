/**
 * Shipping Routes — Production Shiprocket Integration
 *
 * Route summary:
 *
 * PUBLIC (No auth):
 *   POST /shipping/webhook/shiprocket        — Shiprocket webhook (x-api-key auth)
 *   GET  /shipping/serviceability            — Pincode serviceability check for checkout
 *
 * VENDOR routes (require auth + VENDOR role):
 *   GET    /shipping/vendor/addresses                     — List pickup addresses
 *   POST   /shipping/vendor/addresses                     — Add pickup address
 *   PUT    /shipping/vendor/addresses/:id                 — Update pickup address
 *   DELETE /shipping/vendor/addresses/:id                 — Delete pickup address
 *   GET    /shipping/vendor/shipments                     — List vendor shipments
 *   POST   /shipping/vendor/shipments                     — Create shipment for suborder
 *   POST   /shipping/vendor/shipments/:id/awb             — Assign AWB
 *   POST   /shipping/vendor/shipments/:id/pickup          — Schedule pickup
 *   GET    /shipping/vendor/shipments/:id/label           — Generate/get label
 *   GET    /shipping/vendor/shipments/:id/tracking        — Track shipment
 *   POST   /shipping/vendor/shipments/:id/cancel          — Cancel shipment
 *   GET    /shipping/vendor/serviceability/:suborderId    — Check route serviceability
 *
 * CUSTOMER routes (require auth + CUSTOMER role):
 *   GET /shipping/customer/orders/:orderId/shipments     — All shipments for an order
 *   GET /shipping/customer/shipments/:id/tracking        — Track specific shipment
 *
 * SUPER ADMIN routes (require auth + SUPER_ADMIN role):
 *   GET  /shipping/admin/stats               — Dashboard statistics
 *   GET  /shipping/admin/shipments           — All shipments with filters
 *   GET  /shipping/admin/shipments/:id       — Shipment detail
 *   POST /shipping/admin/shipments           — Create shipment (any vendor)
 *   POST /shipping/admin/shipments/:id/awb   — Assign AWB
 *   POST /shipping/admin/shipments/:id/pickup— Schedule pickup
 *   GET  /shipping/admin/shipments/:id/label — Generate label
 *   POST /shipping/admin/shipments/:id/manifest — Generate manifest
 *   POST /shipping/admin/shipments/:id/cancel  — Cancel shipment
 *   POST /shipping/admin/shipments/:id/retry   — Retry failed creation
 *   GET  /shipping/admin/exceptions          — API error logs
 */

import express from 'express';
import {
  // Vendor addresses
  getVendorShippingAddresses,
  addVendorShippingAddress,
  updateVendorShippingAddress,
  deleteVendorShippingAddress,
  registerVendorShippingAddress,
  // Serviceability
  checkServiceability,
  publicServiceabilityCheck,
  // Shipments
  createShipment,
  adminCreateShipment,
  assignAWB,
  requestPickup,
  generateLabel,
  generateManifest,
  getShipmentTracking,
  getOrderShipments,
  getVendorShipments,
  // Admin
  adminGetShipments,
  adminGetShippingStats,
  adminGetShipmentDetail,
  adminCancelShipment,
  adminRetryShipment,
  adminGetShippingExceptions,
  // Cancellation & Returns
  cancelShipment,
  createReturnShipment,
  // Webhook
  handleDelhiveryWebhook,
  handleShiprocketWebhook,
} from '../controllers/shippingController.js';

import { authenticate } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// ─── Webhooks (PUBLIC — Carrier authenticates via signature / token) ─────────
router.post('/webhook/delhivery', handleDelhiveryWebhook);
router.post('/webhook/shiprocket', handleShiprocketWebhook);

// ─── Public Serviceability Check (for checkout page) ─────────────────────────
router.get('/serviceability', publicServiceabilityCheck);

// ─── Authenticated Routes ─────────────────────────────────────────────────────
router.use(authenticate);

// ─── VENDOR: Pickup Addresses ─────────────────────────────────────────────────
router.get('/vendor/addresses', authorize('VENDOR'), getVendorShippingAddresses);
router.post('/vendor/addresses', authorize('VENDOR'), addVendorShippingAddress);
router.put('/vendor/addresses/:id', authorize('VENDOR'), updateVendorShippingAddress);
router.delete('/vendor/addresses/:id', authorize('VENDOR'), deleteVendorShippingAddress);
router.post('/vendor/addresses/:id/register', authorize('VENDOR'), registerVendorShippingAddress);

// ─── VENDOR: Serviceability ───────────────────────────────────────────────────
router.get('/vendor/serviceability/:suborderId', authorize('VENDOR'), checkServiceability);

// ─── VENDOR: Shipment Operations ─────────────────────────────────────────────
router.get('/vendor/shipments', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), getVendorShipments);
router.post('/vendor/shipments', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), createShipment);
router.post('/vendor/shipments/:id/awb', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), assignAWB);
router.post('/vendor/shipments/:id/pickup', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), requestPickup);
router.get('/vendor/shipments/:id/label', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), generateLabel);
router.get('/vendor/shipments/:id/tracking', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN', 'CUSTOMER'), getShipmentTracking);
router.post('/vendor/shipments/:id/cancel', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), cancelShipment);
router.post('/vendor/shipments/:id/return', authorize('VENDOR', 'ADMIN', 'SUPER_ADMIN'), createReturnShipment);

// ─── CUSTOMER: Order Tracking ─────────────────────────────────────────────────
router.get('/customer/orders/:orderId/shipments', authorize('CUSTOMER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'), getOrderShipments);
router.get('/customer/shipments/:id/tracking', authorize('CUSTOMER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'), getShipmentTracking);

// ─── SUPER ADMIN: Full Shipping Management ────────────────────────────────────
router.get('/admin/stats', authorize('SUPER_ADMIN'), adminGetShippingStats);
router.get('/admin/shipments', authorize('SUPER_ADMIN'), adminGetShipments);
router.post('/admin/shipments', authorize('SUPER_ADMIN'), adminCreateShipment);
router.get('/admin/shipments/:id', authorize('SUPER_ADMIN'), adminGetShipmentDetail);
router.post('/admin/shipments/:id/awb', authorize('SUPER_ADMIN'), assignAWB);
router.post('/admin/shipments/:id/pickup', authorize('SUPER_ADMIN'), requestPickup);
router.get('/admin/shipments/:id/label', authorize('SUPER_ADMIN'), generateLabel);
router.post('/admin/shipments/:id/manifest', authorize('SUPER_ADMIN'), generateManifest);
router.post('/admin/shipments/:id/cancel', authorize('SUPER_ADMIN'), adminCancelShipment);
router.post('/admin/shipments/:id/retry', authorize('SUPER_ADMIN'), adminRetryShipment);
router.get('/admin/exceptions', authorize('SUPER_ADMIN'), adminGetShippingExceptions);

export default router;
