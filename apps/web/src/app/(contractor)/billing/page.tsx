"use client";

import React from "react";
import { CreditCard, CheckCircle2, Download, Building, ShieldCheck } from "lucide-react";

export default function BillingPage() {
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Subscription & Billing Management</h1>
        <p className="text-slate-500 mt-0.5">Plan limits, Indian GST Rule 46 invoices, and Section 194J customer TDS reconciliation.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 text-sm">Active Plan</span>
            <span className="rounded bg-emerald-50 border border-emerald-300 px-2 py-0.5 font-bold text-emerald-800 text-[10px]">
              GROWTH PLAN
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            ₹9,999 <span className="text-xs font-normal text-slate-500">/ month + 18% GST</span>
          </div>
          <div className="text-slate-600 space-y-1 pt-2 border-t border-slate-100">
            <div>Projects Limit: <strong>15 Active Projects</strong></div>
            <div>Seats Limit: <strong>20 Team Members</strong></div>
            <div>Storage Included: <strong>100 GB S3 Storage</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="font-bold text-slate-800 text-sm">Tax & Business Profile</div>
          <div className="space-y-1.5 text-slate-700">
            <div>Legal Name: <strong>Deccan EnviroTech MEP Pvt Ltd</strong></div>
            <div>GSTIN: <strong className="font-mono">36AABCD4512F1Z4</strong> (Telangana)</div>
            <div>PAN: <strong className="font-mono">AABCD4512F</strong></div>
            <div>SAC Code: <strong className="font-mono">998315</strong> (IT Hosting & SaaS)</div>
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
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 font-semibold text-slate-700">
          GST Invoices History (Rule 46 Compliant)
        </div>
        <div className="divide-y divide-slate-100">
          <div className="p-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="font-bold text-slate-900">Invoice #TC-INV-2026-11-001</div>
              <div className="text-slate-500">Period: 01 Nov 2026 – 30 Nov 2026 · Paid via Razorpay UPI</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right font-mono">
                <div className="font-bold text-slate-900">₹11,798.82</div>
                <div className="text-[10px] text-slate-500">Inc. 18% CGST/SGST (₹1,799.82)</div>
              </div>
              <button className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer">
                <Download className="h-3.5 w-3.5" />
                <span>Download Invoice</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
