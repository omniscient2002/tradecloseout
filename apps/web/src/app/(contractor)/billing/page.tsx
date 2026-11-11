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
  max_active_projects?: number;
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
        apiFetch<SubscriptionDto>("/api/v1/orgs/current/subscription"),
        apiFetch<InvoiceDto[] | { data: InvoiceDto[] }>("/api/v1/billing/invoices"),
      ]);

      setSubscription(subData || null);
      setInvoices(Array.isArray(invData) ? invData : (invData?.data ?? []));
    } catch (err: any) {
      setSubscription(null);
      setInvoices([]);
      setError(err?.message || "Failed to load subscription & billing data. No plan or invoice values can be verified.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingData();
  }, [fetchBillingData]);

  const formatInr = (paise?: number) => {
    if (paise == null || !Number.isFinite(paise)) return "—";
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

  const planName = subscription?.planName ?? subscription?.plan_name ?? null;
  const planTier = subscription?.planTier ?? subscription?.plan_tier ?? null;
  const seatLimit = subscription?.seatLimit ?? subscription?.seat_limit ?? null;
  const maxProjects = subscription?.maxActiveProjects ?? subscription?.max_active_projects ?? null;
  const storageBytes = subscription?.storageQuotaBytes ?? subscription?.storage_quota_bytes ?? null;
  const storageGb = storageBytes == null ? null : Math.round(storageBytes / (1024 * 1024 * 1024));
  const planPricePaise = subscription?.pricePaise ?? subscription?.price_paise ?? null;

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Subscription & Billing Management</h1>
          <p className="text-slate-500 mt-0.5">
            Verified subscription limits and invoices. Unavailable information is shown as unavailable, not estimated.
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
              {planTier ? `${planTier} PLAN` : "PLAN UNVERIFIED"}
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            {planPricePaise == null ? "Price unavailable" : formatInr(planPricePaise)} <span className="text-xs font-normal text-slate-500">/ billing period; tax subject to invoice</span>
          </div>
          <div className="text-slate-600 space-y-1 pt-2 border-t border-slate-100">
            <div>Plan: <strong>{planName ?? "Unavailable"}</strong></div>
            <div>Projects Limit: <strong>{maxProjects ?? "Unavailable"}</strong></div>
            <div>Seats Limit: <strong>{seatLimit ?? "Unavailable"}</strong></div>
            <div>Storage Included: <strong>{storageGb == null ? "Unavailable" : `${storageGb} GiB`}</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="font-bold text-slate-800 text-sm">Tax & Business Profile</div>
          <div className="space-y-1.5 text-slate-700">
            <div>Legal name, GSTIN, PAN and SAC require a verified billing profile.</div>
            <div>No verified tax profile is returned by this screen.</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="font-bold text-slate-800 text-sm">Customer TDS (Section 194J)</div>
          <div className="space-y-1.5 text-slate-600">
            <div>TDS rate and pending certificates are unavailable without reconciled invoice and certificate records.</div>
            <div className="text-[11px] text-slate-500">No TRACES integration or tax status is implied by this display.</div>
          </div>
        </div>
      </div>

      {/* Tax Invoices History */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div className="font-semibold text-slate-800">
            Recorded Billing Invoices
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
                    {inv.invoice_number ?? inv.invoiceNumber ?? "Invoice number unavailable"}
                  </div>
                  <div className="text-slate-500">
                    Date: {formatDate(inv.created_at)} · Place of Supply: {inv.place_of_supply ?? inv.placeOfSupply ?? "Unavailable"}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono">
                    <div className="font-bold text-slate-900">{formatInr(inv.total_paise ?? inv.totalPaise)}</div>
                    <div className="text-[10px] text-slate-500">
                      Tax: {formatInr(inv.tax_paise ?? inv.taxPaise)}
                    </div>
                  </div>

                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    {inv.status ?? "UNKNOWN"}
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
