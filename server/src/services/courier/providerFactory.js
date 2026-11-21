import { delhiveryProvider } from './delhiveryProvider.js';
import { shiprocketProvider } from './shiprocketProvider.js';

export const providerFactory = {
  getProvider(providerName) {
    switch (providerName?.toUpperCase()) {
      case 'DELHIVERY':
        return delhiveryProvider;
      case 'SHIPROCKET':
        return shiprocketProvider;
      default:
        // Default to Delhivery as the sole/primary logistics provider
        return delhiveryProvider;
    }
  }
};

export default providerFactory;
