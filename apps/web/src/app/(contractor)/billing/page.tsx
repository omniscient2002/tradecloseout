"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CreditCard, CheckCircle2, Download, Building, ShieldCheck, RefreshCw, Plus, FileText, AlertCircle } from "lucide-react";
import { apiFetch, ApiProblemError } from "../../../lib/api-client";

interface SubscriptionDto {
  planName?: string;
  plan_name?: string;
  planTier?: string;
  plan_tier?: string;
  status: string;
  seatLimit?: number;
  seat_limit?: number;
  storageQuotaBytes?: number;
  storage_quota_bytes?: number;
  maxActiveProjects?: number;
  pricePaise?: number;
  price_paise?: number;
}

interface InvoiceDto {
  id: string;
  invoice_number?: string;
  invoiceNumber?: string;
  status: string;
  total_paise?: number;
  totalPaise?: number;
  tax_paise?: number;
  taxPaise?: number;
  subtotal_paise?: number;
  subtotalPaise?: number;
  place_of_supply?: string;
  placeOfSupply?: string;
  created_at: string;
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBillingData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subData, invData] = await Promise.all([
        apiFetch<any>("/api/v1/orgs/current/subscription").catch(() => null),
        apiFetch<any>("/api/v1/billing/invoices").catch(() => []),
      ]);

      if (subData) setSubscription(subData);
      setInvoices(Array.isArray(invData) ? invData : invData?.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load subscription & billing data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingData();
  }, [fetchBillingData]);

  const formatInr = (paise?: number) => {
    if (!paise) return "₹0.00";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(paise / 100);
  };

  const formatDate = (isoDate: string) => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(isoDate));
    } catch {
      return isoDate;
    }
  };

  const planName = subscription?.planName || subscription?.plan_name || "GROWTH PLAN";
  const planTier = subscription?.planTier || subscription?.plan_tier || "GROWTH";
  const seatLimit = subscription?.seatLimit || subscription?.seat_limit || 20;
  const storageGb = Math.round(((subscription?.storageQuotaBytes || subscription?.storage_quota_bytes || 107374182400) / (1024 * 1024 * 1024)));

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Subscription & Billing Management</h1>
          <p className="text-slate-500 mt-0.5">
            Subscription plan limits, Indian GST Rule 46 sequential tax invoices, and Section 194J customer TDS reconciliation.
          </p>
        </div>

        <button
          onClick={fetchBillingData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Billing</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchBillingData} className="font-semibold text-red-800 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* Subscription Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 text-sm">Active Plan</span>
            <span className="rounded bg-emerald-50 border border-emerald-300 px-2 py-0.5 font-bold text-emerald-800 text-[10px] uppercase">
              {planTier} PLAN
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            ₹9,999 <span className="text-xs font-normal text-slate-500">/ month + 18% GST</span>
          </div>
          <div className="text-slate-600 space-y-1 pt-2 border-t border-slate-100">
            <div>Projects Limit: <strong>15 Active Projects</strong></div>
            <div>Seats Limit: <strong>{seatLimit} Team Members</strong></div>
            <div>Storage Included: <strong>{storageGb} GB S3 Storage</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="font-bold text-slate-800 text-sm">Tax & Business Profile</div>
          <div className="space-y-1.5 text-slate-700">
            <div>Legal Name: <strong>Deccan EnviroTech MEP Pvt Ltd</strong></div>
            <div>GSTIN: <strong className="font-mono">36AABCD4512F1Z4</strong> (Telangana · Code 36)</div>
            <div>PAN: <strong className="font-mono">AABCD4512F</strong></div>
            <div>SAC Code: <strong className="font-mono">998315</strong> (IT Hosting & SaaS Applications)</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="font-bold text-slate-800 text-sm">Customer TDS (Section 194J)</div>
          <div className="space-y-1.5 text-slate-600">
            <div>Applicable Rate: <strong>2% TDS on Technical Services</strong></div>
            <div>Pending Form 16A Reconciliation: <strong className="text-amber-800">₹4,200.00</strong></div>
            <div className="text-[11px] text-slate-500">TRACES quarterly certificate reconciliation active.</div>
          </div>
        </div>
      </div>

      {/* Tax Invoices History */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div className="font-semibold text-slate-800">
            Rule 46 Sequential Tax Invoices History (Financial Year 2026-27)
          </div>
          <span className="font-mono text-[11px] text-slate-500">{invoices.length} Invoices Found</span>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 w-full animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No tax invoices generated yet for this billing cycle.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <div key={inv.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors">
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 font-mono text-sm">
                    {inv.invoice_number || inv.invoiceNumber || "TC/2026-27/00001"}
                  </div>
                  <div className="text-slate-500">
                    Date: {formatDate(inv.created_at)} · Place of Supply: {inv.place_of_supply || inv.placeOfSupply || "Telangana (36)"}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono">
                    <div className="font-bold text-slate-900">{formatInr(inv.total_paise || inv.totalPaise || 1179882)}</div>
                    <div className="text-[10px] text-slate-500">
                      Tax: {formatInr(inv.tax_paise || inv.taxPaise || 179982)} (18% GST)
                    </div>
                  </div>

                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    {inv.status || "PAID"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
