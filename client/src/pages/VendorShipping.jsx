import React, { useState, useEffect } from 'react';
import api from '../services/api';
import {
  Truck, Package, Search, Filter, RefreshCw, Calendar, MapPin,
  ExternalLink, Download, Clock, AlertCircle, CheckCircle2, ChevronRight,
  Loader2, XCircle, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ShipmentTrackingModal from '../components/shipping/ShipmentTrackingModal';

export const VendorShipping = () => {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchAwb, setSearchAwb] = useState('');
  const [selectedTrackingId, setSelectedTrackingId] = useState(null);

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    fetchShipments();
  }, [statusFilter]);

  const fetchShipments = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (searchAwb) params.awbNumber = searchAwb;

      const res = await api.get('/shipping/vendor/shipments', { params });
      if (res.data?.success) {
        setShipments(res.data.data.shipments || []);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to fetch vendor shipments');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchShipments();
  };

  const handleAssignAWB = async (shipmentId) => {
    try {
      setActionLoadingId(shipmentId);
      setActionError(null);
      // Auto-assign best courier or pass company ID
      const res = await api.post(`/shipping/vendor/shipments/${shipmentId}/awb`, {});
      setActionSuccess('AWB generated successfully: ' + (res.data?.data?.shipment?.awbNumber || 'Assigned'));
      await fetchShipments();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to assign AWB');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleSchedulePickup = async (shipmentId) => {
    try {
      setActionLoadingId(shipmentId);
      setActionError(null);
      await api.post(`/shipping/vendor/shipments/${shipmentId}/pickup`, {});
      setActionSuccess('Pickup requested successfully from your registered address!');
      await fetchShipments();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to schedule pickup');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDownloadLabel = async (shipmentId) => {
    try {
      setActionLoadingId(shipmentId);
      const res = await api.get(`/shipping/vendor/shipments/${shipmentId}/label`);
      const labelUrl = res.data?.data?.labelUrl;
      if (labelUrl) {
        window.open(labelUrl, '_blank');
      } else {
        alert('Label URL not ready yet');
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to generate shipping label');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelShipment = async (shipmentId) => {
    if (!window.confirm('Are you sure you want to cancel this courier shipment?')) return;
    try {
      setActionLoadingId(shipmentId);
      await api.post(`/shipping/vendor/shipments/${shipmentId}/cancel`, {
        reason: 'Vendor cancelled shipment'
      });
      setActionSuccess('Shipment cancelled successfully');
      await fetchShipments();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to cancel shipment');
    } finally {
      setActionLoadingId(null);
    }
  };

  const getStatusBadge = (status) => {
    const s = status || 'PENDING';
    if (s === 'DELIVERED') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">DELIVERED</span>;
    }
    if (['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PICKED_UP'].includes(s)) {
      return <span className="px-2.5 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700 border border-blue-200">{s.replace(/_/g, ' ')}</span>;
    }
    if (s === 'AWB_ASSIGNED' || s === 'MANIFEST_GENERATED') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200">{s.replace(/_/g, ' ')}</span>;
    }
    if (['CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED'].includes(s)) {
      return <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-50 text-rose-700 border border-rose-200">{s.replace(/_/g, ' ')}</span>;
    }
    return <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200">{s.replace(/_/g, ' ')}</span>;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Truck className="w-5 h-5" />
            </div>
            <span>Shipping & Logistics</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Official Delhivery Express logistics integration for multi-vendor parcels, labels, and tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchShipments()}
            className="p-3 bg-white hover:bg-slate-50 text-slate-700 rounded-2xl border border-slate-200/80 shadow-xs transition-colors flex items-center gap-2 text-xs font-bold"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-800 text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}
      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-800 text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-700">✕</button>
        </div>
      )}

      {/* Search & Tabs */}
      <div className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Status Tabs */}
          <div className="flex flex-wrap gap-1.5 w-full md:w-auto">
            {[
              { label: 'All Shipments', value: '' },
              { label: 'Pending / Ready', value: 'READY_TO_SHIP' },
              { label: 'In Transit', value: 'IN_TRANSIT' },
              { label: 'Delivered', value: 'DELIVERED' },
              { label: 'Returns & RTO', value: 'RTO_INITIATED' },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  statusFilter === tab.value
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search form */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-72">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchAwb}
                onChange={(e) => setSearchAwb(e.target.value)}
                placeholder="Search AWB / Order #..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Shipment List */}
      {loading ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 bg-white border border-slate-200/80 rounded-3xl shadow-xs">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-slate-500 text-xs font-bold">Loading logistics data...</p>
        </div>
      ) : shipments.length === 0 ? (
        <div className="p-16 text-center bg-white border border-slate-200/80 rounded-3xl shadow-xs space-y-3">
          <Package className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-black text-slate-800">No shipments found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Once orders are confirmed and marked ready to ship, shipments will appear here for courier assignment.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {shipments.map((shipment) => (
            <div
              key={shipment._id}
              className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-xs hover:border-indigo-100 transition-all space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        Shipment #{shipment.shipmentIdNumber || shipment._id.slice(-8).toUpperCase()}
                      </span>
                      {getStatusBadge(shipment.status)}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Order #{shipment.parentOrderId?.orderNumber || shipment.suborderId?.subOrderNumber || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedTrackingId(shipment._id)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Truck className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Track Live</span>
                  </button>
                  {shipment.labelUrl && (
                    <button
                      onClick={() => handleDownloadLabel(shipment._id)}
                      className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Print Label</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wider block">Courier & AWB</span>
                  <div className="mt-1">
                    <p className="font-bold text-slate-900">{shipment.courierName || shipment.courierPartnerName || (shipment.courierCompanyId ? `Courier #${shipment.courierCompanyId}` : 'Delhivery Surface')}</p>
                    <p className="font-mono font-medium text-indigo-600 mt-0.5">{shipment.awbNumber || 'No AWB yet'}</p>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wider block">Delivery Destination</span>
                  <div className="mt-1">
                    <p className="font-bold text-slate-900">{shipment.destinationAddressSnapshot?.name || shipment.deliveryAddress?.fullName || 'Customer'}</p>
                    <p className="text-slate-500 mt-0.5">
                      {[
                        shipment.destinationAddressSnapshot?.city || shipment.deliveryAddress?.city,
                        (shipment.destinationAddressSnapshot?.postalCode || shipment.deliveryAddress?.zipCode)
                          ? `PIN ${shipment.destinationAddressSnapshot?.postalCode || shipment.deliveryAddress?.zipCode}`
                          : null,
                      ].filter(Boolean).join(', ') || 'Address on file'}
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wider block">Package Info</span>
                  <div className="mt-1">
                    <p className="font-bold text-slate-900">{(shipment.packageWeight || shipment.weight || 0.5)} kg</p>
                    <p className="text-slate-500 mt-0.5">
                      {shipment.length || 10}x{shipment.width || shipment.dimensions?.breadth || 10}x{shipment.height || 10} cm
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 font-bold uppercase tracking-wider block">Est. Delivery</span>
                  <div className="mt-1">
                    <p className="font-bold text-slate-900">
                      {shipment.estimatedDeliveryDate
                        ? new Date(shipment.estimatedDeliveryDate).toLocaleDateString()
                        : 'Calculated upon scan'}
                    </p>
                    <p className="text-slate-500 mt-0.5">Pickup: {shipment.pickupAddress?.pincode || 'Registered'}</p>
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {!shipment.awbNumber && ['CREATED', 'PENDING', 'READY_TO_SHIP'].includes(shipment.status) && (
                    <button
                      onClick={() => handleAssignAWB(shipment._id)}
                      disabled={actionLoadingId === shipment._id}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      {actionLoadingId === shipment._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                      <span>Assign Courier & AWB</span>
                    </button>
                  )}

                  {shipment.awbNumber && ['CREATED', 'AWB_ASSIGNED'].includes(shipment.status) && (
                    <button
                      onClick={() => handleSchedulePickup(shipment._id)}
                      disabled={actionLoadingId === shipment._id}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      {actionLoadingId === shipment._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
                      <span>Schedule Carrier Pickup</span>
                    </button>
                  )}

                  {shipment.status === 'PICKUP_SCHEDULED' && (
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Pickup Scheduled — Ready for Courier
                    </span>
                  )}
                </div>

                {!['DELIVERED', 'CANCELLED'].includes(shipment.status) && (
                  <button
                    onClick={() => handleCancelShipment(shipment._id)}
                    disabled={actionLoadingId === shipment._id}
                    className="text-xs text-rose-600 hover:text-rose-800 font-bold transition-colors"
                  >
                    Cancel Shipment
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live Tracking Modal */}
      {selectedTrackingId && (
        <ShipmentTrackingModal
          shipmentId={selectedTrackingId}
          onClose={() => setSelectedTrackingId(null)}
        />
      )}
    </motion.div>
  );
};

export default VendorShipping;

