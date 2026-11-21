/**
 * Test Delhivery Provider and Razorpay Integration
 */

import { delhiveryProvider } from '../src/services/courier/delhiveryProvider.js';
import { providerFactory } from '../src/services/courier/providerFactory.js';
import { env } from '../src/config/env.js';
import Razorpay from 'razorpay';

async function runTests() {
  console.log('--- STARTING DELHIVERY & RAZORPAY VERIFICATION ---');

  // 1. Verify Provider Factory
  console.log('\n[1] Checking Provider Factory...');
  const defaultProvider = providerFactory.getProvider();
  if (defaultProvider === delhiveryProvider) {
    console.log('✅ Default provider is correctly set to Delhivery');
  } else {
    throw new Error('❌ Default provider is NOT Delhivery');
  }

  const explicitDelhivery = providerFactory.getProvider('DELHIVERY');
  if (explicitDelhivery === delhiveryProvider) {
    console.log('✅ ProviderFactory.getProvider("DELHIVERY") returns delhiveryProvider');
  } else {
    throw new Error('❌ ProviderFactory.getProvider("DELHIVERY") failed');
  }

  // 2. Test Delhivery Serviceability
  console.log('\n[2] Testing Delhivery Serviceability...');
  const serv = await delhiveryProvider.getServiceability('600001', '628502', 1.0, 0);
  console.log('Serviceability result:', serv);
  if (serv.serviceable && serv.availableCouriers.length > 0) {
    console.log('✅ Delhivery Serviceability check passed');
  } else {
    throw new Error('❌ Delhivery Serviceability check failed');
  }

  // 3. Test Delhivery Shipment Creation
  console.log('\n[3] Testing Delhivery Shipment Creation...');
  const shipmentResult = await delhiveryProvider.createOrder({
    orderNumber: `TEST-ORD-${Date.now()}`,
    orderDate: new Date().toISOString(),
    customerName: 'Sokar Customer',
    customerPhone: '7339259953',
    deliveryAddress: {
      streetAddress: '6/2818-9A Mahalakshmi Nagar, Opp TVS Showroom',
      city: 'Kovilpatti',
      state: 'Tamil Nadu',
      postalCode: '628502',
      country: 'India',
    },
    pickupLocation: 'BAAPOO_MART_HUB',
    items: [{ name: 'Lipstick Premium', sku: 'LIP-01', units: 1, sellingPrice: 1500 }],
    weight: 0.5,
    paymentMethod: 'Prepaid',
    subTotal: 1500,
  });
  console.log('Shipment creation result:', shipmentResult);
  if (shipmentResult.success && shipmentResult.awbNumber && shipmentResult.trackingUrl.includes('delhivery.com')) {
    console.log('✅ Delhivery shipment created with AWB:', shipmentResult.awbNumber);
    console.log('✅ Tracking URL points to Delhivery:', shipmentResult.trackingUrl);
  } else {
    throw new Error('❌ Delhivery shipment creation failed');
  }

  // 4. Test Delhivery Pickup Scheduling
  console.log('\n[4] Testing Delhivery Pickup Scheduling...');
  const pickupResult = await delhiveryProvider.requestPickup(
    shipmentResult.awbNumber,
    new Date(Date.now() + 86400000).toISOString().split('T')[0],
    { pickupLocation: 'BAAPOO_MART_HUB', packageCount: 1 }
  );
  console.log('Pickup result:', pickupResult);
  if (pickupResult.success && pickupResult.pickupToken) {
    console.log('✅ Delhivery pickup requested with Token:', pickupResult.pickupToken);
  } else {
    throw new Error('❌ Delhivery pickup scheduling failed');
  }

  // 5. Test Delhivery Live Tracking
  console.log('\n[5] Testing Delhivery Tracking...');
  const trackResult = await delhiveryProvider.trackByAWB(shipmentResult.awbNumber);
  console.log('Tracking result:', trackResult);
  if (trackResult.trackingUrl.includes('delhivery.com') && trackResult.events.length > 0) {
    console.log('✅ Delhivery live tracking verified');
  } else {
    throw new Error('❌ Delhivery tracking failed');
  }

  // 6. Test Delhivery Label Generation
  console.log('\n[6] Testing Delhivery Label Generation...');
  const labelResult = await delhiveryProvider.generateLabel(shipmentResult.awbNumber);
  console.log('Label result:', labelResult);
  if (labelResult.success && labelResult.labelUrl.includes('packing_slip')) {
    console.log('✅ Delhivery label URL generated:', labelResult.labelUrl);
  } else {
    throw new Error('❌ Delhivery label generation failed');
  }

  // 7. Test Razorpay Instance Initialization
  console.log('\n[7] Testing Razorpay SDK Initialization...');
  const rzp = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  if (rzp && rzp.orders) {
    console.log('✅ Razorpay client initialized successfully with Key ID:', env.RAZORPAY_KEY_ID);
  } else {
    throw new Error('❌ Razorpay initialization failed');
  }

  console.log('\n🎉 ALL DELHIVERY & RAZORPAY CHECKS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
