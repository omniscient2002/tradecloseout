"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "../../../lib/api-client";
import {
  displayDate,
  displayMoney,
  humanLabel,
} from "../../../lib/presentation";

interface Subscription {
  id: string | null;
  planName: string;
  status: string;
  seatLimit?: number;
  storageQuotaBytes?: number;
  maxActiveProjects?: number;
  pricePaise?: number;
  interval?: string;
}
interface Invoice {
  id: string;
  number: string;
  status: string;
  issued_at: string;
  total_paise: string;
  tax_paise: string;
  place_of_supply: string;
  tax_rate_bps: number;
  tds_deductions?: Array<{ amount_paise: string; status: string }>;
}
interface Organisation {
  legal_name: string;
  profile: { gstin?: string; pan?: string } | null;
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plan, bills, org] = await Promise.all([
        apiFetch<Subscription>("/api/v1/orgs/current/subscription"),
        apiFetch<Invoice[]>("/api/v1/billing/invoices"),
        apiFetch<Organisation>("/api/v1/orgs/current"),
      ]);
      setSubscription(plan);
      setInvoices(bills);
      setOrganisation(org);
    } catch {
      setError("We could not load your billing records. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const interval =
    subscription?.interval === "MONTH" ||
    subscription?.interval === "MONTHLY" ||
    subscription?.interval === "month"
      ? "month"
      : subscription?.interval === "YEAR" ||
          subscription?.interval === "ANNUAL" ||
          subscription?.interval === "year"
        ? "year"
        : subscription?.interval === "ONE_TIME_PROJECT"
          ? "project"
          : null;
  const value = (number?: number, suffix = "") =>
    number === undefined || number === null
      ? "Not recorded"
      : `${number}${suffix}`;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your subscription, business details, and invoices.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh billing"
          className="rounded-lg border border-slate-200 bg-white p-2 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          Loading billing records…
        </p>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}{" "}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">Subscription</h2>
              {subscription?.id ? (
                <>
                  <p className="mt-3 text-lg font-bold">
                    {subscription.planName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {humanLabel(subscription.status)}
                  </p>
                  <p className="mt-3 text-lg">
                    {displayMoney(subscription.pricePaise)}
                    {interval ? ` / ${interval}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Taxes are shown on each invoice.
                  </p>
                  <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                    <div className="flex justify-between">
                      <dt>Active project limit</dt>
                      <dd>{value(subscription.maxActiveProjects)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Team member limit</dt>
                      <dd>{value(subscription.seatLimit)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Included file storage</dt>
                      <dd>
                        {subscription.storageQuotaBytes == null
                          ? "Not recorded"
                          : `${Number((subscription.storageQuotaBytes / 1024 ** 3).toFixed(2))} GB`}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No subscription is recorded for your organisation.
                </p>
              )}
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold">Business details</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Registered name</dt>
                  <dd className="mt-1 font-medium">
                    {organisation?.legal_name || "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">GSTIN</dt>
                  <dd className="mt-1">
                    {organisation?.profile?.gstin || "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">PAN</dt>
                  <dd className="mt-1">
                    {organisation?.profile?.pan || "Not recorded"}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold">
                Invoices{" "}
                <span className="font-normal text-slate-500">
                  ({invoices.length})
                </span>
              </h2>
            </div>
            {invoices.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                No invoices have been issued yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {[
                        "Invoice",
                        "Issued",
                        "Place of supply",
                        "Tax",
                        "Total",
                        "Status",
                      ].map((label) => (
                        <th
                          key={label}
                          className="whitespace-nowrap px-5 py-3 font-medium"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-5 py-4 font-medium">
                          {invoice.number || "Number not recorded"}
                        </td>
                        <td className="px-5 py-4">
                          {displayDate(invoice.issued_at)}
                        </td>
                        <td className="px-5 py-4">
                          {invoice.place_of_supply || "Not recorded"}
                        </td>
                        <td className="px-5 py-4">
                          {displayMoney(invoice.tax_paise)}
                        </td>
                        <td className="px-5 py-4">
                          {displayMoney(invoice.total_paise)}
                        </td>
                        <td className="px-5 py-4">
                          {humanLabel(invoice.status)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
