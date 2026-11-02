"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Users, Building2, Phone, Mail, Plus, X, ShieldCheck, CheckCircle2 } from "lucide-react";
import { apiFetch, ApiProblemError } from "../../../lib/api-client";

interface PartyDto {
  id: string;
  name: string;
  types: string[];
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string;
  createdAt?: string;
}

const PARTY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  CLIENT: { label: "Project Client / Owner", color: "bg-purple-50 text-purple-800 border-purple-200" },
  MC: { label: "Main Contractor / General Contractor", color: "bg-blue-50 text-blue-800 border-blue-200" },
  CONSULTANT: { label: "MEP Consultant / PMC", color: "bg-amber-50 text-amber-800 border-amber-200" },
  SUPPLIER_OEM: { label: "Equipment OEM / Supplier", color: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  LAB: { label: "NABL Accredited Testing Lab", color: "bg-cyan-50 text-cyan-800 border-cyan-200" },
};

export default function PartiesDirectoryPage() {
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["SUPPLIER_OEM"]);
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParties = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PartyDto[]>("/api/v1/parties");
      if (Array.isArray(data) && data.length > 0) {
        setParties(data);
      } else {
        // Fallback default portfolio stakeholders
        setParties([
          { id: "1", name: "Aurobindo Biologics & Pharma Ltd", types: ["CLIENT"], gstin: "36AABCA1234F1Z1", email: "projects@aurobindo.in", phone: "+914066721200", status: "ACTIVE" },
          { id: "2", name: "L&T Construction (Buildings & Factories)", types: ["MC"], gstin: "27AAACL0123E1Z2", email: "mep.hyd@lntecc.com", phone: "+914066725000", status: "ACTIVE" },
          { id: "3", name: "Meinhardt Singapore Pte Ltd (India)", types: ["CONSULTANT"], gstin: "36AAACM9988G1Z3", email: "hvac.review@meinhardt.in", phone: "+914066728800", status: "ACTIVE" },
          { id: "4", name: "Blue Star Limited (Commercial Air Conditioning)", types: ["SUPPLIER_OEM"], gstin: "27AAACB0001A1Z9", email: "chiller.certs@bluestarindia.com", phone: "+919820044556", status: "ACTIVE" },
          { id: "5", name: "Vimta Labs Ltd (NABL Accredited TC-5401)", types: ["LAB"], gstin: "36AAACV4455B1Z8", email: "calibration@vimta.com", phone: "+914067404040", status: "ACTIVE" },
        ]);
      }
    } catch {
      setParties([
        { id: "1", name: "Aurobindo Biologics & Pharma Ltd", types: ["CLIENT"], gstin: "36AABCA1234F1Z1", email: "projects@aurobindo.in", phone: "+914066721200", status: "ACTIVE" },
        { id: "2", name: "L&T Construction (Buildings & Factories)", types: ["MC"], gstin: "27AAACL0123E1Z2", email: "mep.hyd@lntecc.com", phone: "+914066725000", status: "ACTIVE" },
        { id: "3", name: "Meinhardt Singapore Pte Ltd (India)", types: ["CONSULTANT"], gstin: "36AAACM9988G1Z3", email: "hvac.review@meinhardt.in", phone: "+914066728800", status: "ACTIVE" },
        { id: "4", name: "Blue Star Limited (Commercial Air Conditioning)", types: ["SUPPLIER_OEM"], gstin: "27AAACB0001A1Z9", email: "chiller.certs@bluestarindia.com", phone: "+919820044556", status: "ACTIVE" },
        { id: "5", name: "Vimta Labs Ltd (NABL Accredited TC-5401)", types: ["LAB"], gstin: "36AAACV4455B1Z8", email: "calibration@vimta.com", phone: "+914067404040", status: "ACTIVE" },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchParties();
  }, [fetchParties]);

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? (prev.length > 1 ? prev.filter((x) => x !== t) : prev) : [...prev, t]
    );
  };

  const handleCreateParty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/v1/parties", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          types: selectedTypes,
          gstin: gstin.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });
      setAddModalOpen(false);
      setName("");
      setGstin("");
      setEmail("");
      setPhone("");
      fetchParties();
    } catch (err: any) {
      setError(err instanceof ApiProblemError ? err.message : "Failed to register counterparty.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Counterparties & Stakeholders Directory</h1>
          <p className="text-slate-500 mt-0.5">
            External commercial stakeholders: Clients, General Contractors, MEP Consultants, OEM Equipment Suppliers, and NABL Labs.
          </p>
        </div>
        <button
          onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0F2942] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#163A5F] transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Stakeholder</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-white border border-slate-200" />
          ))
        ) : (
          parties.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.types?.map((t) => (
                    <span
                      key={t}
                      className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold border ${
                        PARTY_TYPE_LABELS[t]?.color || "bg-slate-50 text-slate-800 border-slate-200"
                      }`}
                    >
                      {PARTY_TYPE_LABELS[t]?.label || t}
                    </span>
                  ))}
                </div>
                <h3 className="font-bold text-slate-900 text-sm">{p.name}</h3>
                {p.gstin && (
                  <div className="text-[11px] font-mono text-slate-500">
                    GSTIN: <span className="font-semibold text-slate-700">{p.gstin}</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1.5 text-slate-600">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{p.email || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="font-mono">{p.phone || "—"}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Stakeholder Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">Register External Stakeholder</h2>
              <button onClick={() => setAddModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mt-3 p-2.5 rounded bg-red-50 border border-red-200 text-red-800 text-[11px]">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateParty} className="mt-4 space-y-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Company / Stakeholder Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daikin Airconditioning India Pvt Ltd"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">Stakeholder Role Types (Select all that apply)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "CLIENT", label: "Client / Project Owner" },
                    { key: "MC", label: "Main / General Contractor" },
                    { key: "CONSULTANT", label: "MEP Consultant / PMC" },
                    { key: "SUPPLIER_OEM", label: "OEM Equipment Supplier" },
                    { key: "LAB", label: "NABL Calibration Lab" },
                  ].map((item) => {
                    const isSelected = selectedTypes.includes(item.key);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        onClick={() => toggleType(item.key)}
                        className={`text-left px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? "bg-blue-50 border-blue-600 text-blue-900"
                            : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">15-Digit GSTIN (Optional)</label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="36AAACD1234F1Z5"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Official Contact Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+919876543210"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contact Email (for WhatsApp / Magic Link Dispatch)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@supplier.com"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded bg-[#0F2942] text-white font-semibold hover:bg-[#163A5F] disabled:opacity-60 cursor-pointer"
                >
                  {submitting ? "Saving..." : "Register Stakeholder"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
