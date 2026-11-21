import React, { useState, useEffect } from 'react';
import {
  IndianRupee,
  TrendingUp,
  Percent,
  CheckCircle2,
  Clock,
  ArrowDownRight,
  Download,
  ShieldCheck,
  Building,
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../services/api';

export const VendorFinance = () => {
  const [statement, setStatement] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchFinanceData();
  }, []);

  const fetchFinanceData = async () => {
    setIsLoading(true);
    try {
      const stmtRes = await api.get('/vendor/finance/statement');
      setStatement(stmtRes.data?.data);
    } catch (err) {
      console.error('Failed to fetch finance data', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-16 text-center text-slate-500 font-medium animate-pulse">
        Loading merchant financial data...
      </div>
    );
  }

  const settlements = statement?.settlements || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-7xl mx-auto"
    >
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Financial Dashboard</h1>
        <p className="text-sm text-slate-600 mt-1">
          Track sales earnings, 5% platform fees, account ledger transactions, and automated payout distributions
        </p>
      </div>

      {/* Summary KPI Cards */}
      {statement && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Gross Sales */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                <TrendingUp className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Gross Sales</p>
            </div>
            <h3 className="text-2xl font-black text-slate-900">
              ₹{(statement.sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </h3>
            <span className="text-[11px] text-slate-400 mt-1 block">Total customer order value</span>
          </div>

          {/* 2. Platform Fee (5%) */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-100">
                <Percent className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">Platform Fee (5%)</p>
            </div>
            <h3 className="text-2xl font-black text-rose-600">
              ₹{(statement.commission || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </h3>
            <span className="text-[11px] text-slate-400 mt-1 block">5% platform fee collected</span>
          </div>

          {/* 3. Distributed Earnings (95%) */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Distributed (95%)</p>
            </div>
            <h3 className="text-2xl font-black text-emerald-600">
              ₹{(statement.payouts || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </h3>
            <span className="text-[11px] text-slate-400 mt-1 block">Net order earnings credited</span>
          </div>

          {/* 4. Available Balance */}
          <div className="bg-white border-2 border-blue-600/30 p-5 rounded-2xl shadow-xs relative overflow-hidden bg-gradient-to-br from-blue-50/50 to-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-xs">
                <IndianRupee className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Available Balance</p>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black text-blue-600">
              ₹{(statement.closingBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </h3>
            <span className="text-[11px] text-blue-600/80 mt-1 block font-medium">Ready for withdrawal</span>
          </div>
        </div>
      )}

      {/* Payout Distributions & Settlements Table */}
      <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-blue-600" />
                <span>Vendor Payout Distributions & Settlements</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Breakdown of 95% net payouts credited directly to your store balance after 5% platform fee deduction
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 self-start sm:self-auto">
              Automated Immediate Distribution Active
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-[11px] text-slate-500 uppercase bg-slate-50 border-b border-slate-100 font-bold">
                <tr>
                  <th className="px-4 py-3">Suborder #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Gross Sale</th>
                  <th className="px-4 py-3 text-right text-rose-600">Platform Fee (5%)</th>
                  <th className="px-4 py-3 text-right text-emerald-700 font-extrabold">Net Distributed (95%)</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3">Payout Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlements.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                      No payout settlements found for this period.
                    </td>
                  </tr>
                ) : (
                  settlements.map((st) => (
                    <tr key={st._id} className="hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3.5 font-mono font-bold text-slate-900">
                        {st.suborderId?.subOrderNumber || 'Order Item'}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        {new Date(st.paidAt || st.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-700">
                        ₹{Number(st.grossAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-rose-600">
                        ₹{Number(st.platformCommission || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-black text-emerald-700 text-sm">
                        ₹{Number(st.netPayable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          {st.status === 'PAID' ? 'Distributed' : st.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600">
                        {st.payoutReference || `SETTLE-${st._id.toString().slice(-6)}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Account Ledger Transactions */}
      <div className="bg-white border border-slate-200/80 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-6">
          {statement && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Account Ledger Transactions</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Immutable double-entry financial audit record</p>
                </div>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3.5 font-bold">Date</th>
                      <th className="px-4 py-3.5 font-bold">Type</th>
                      <th className="px-4 py-3.5 font-bold">Description</th>
                      <th className="px-4 py-3.5 font-bold text-right">Amount</th>
                      <th className="px-4 py-3.5 font-bold text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {!statement.transactions || statement.transactions.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="px-4 py-10 text-center text-slate-400">
                          No transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      statement.transactions.map((tx, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-3.5 text-slate-600">
                            {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              {tx.transactionType}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-800 font-medium">{tx.description}</td>
                          <td
                            className={`px-4 py-3.5 text-right font-black ${
                              tx.credit > 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {tx.credit > 0 ? '+' : '-'}₹{tx.credit > 0 ? tx.credit : tx.debit}
                          </td>
                          <td className="px-4 py-3.5 text-right font-black text-slate-900">
                            ₹{tx.balanceSnapshot}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default VendorFinance;
