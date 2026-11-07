"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "../ui/modal";
import {
  Send,
  Copy,
  Check,
  KeyRound,
  ExternalLink,
  MessageSquare,
  Loader2,
  AlertCircle,
  Building2,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../lib/api-client";

interface ShareSupplierLinkModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  requirementId?: string;
  requirementTitle?: string;
}

export function ShareSupplierLinkModal({
  open,
  onClose,
  projectId,
  requirementId,
  requirementTitle,
}: ShareSupplierLinkModalProps) {
  const [parties, setParties] = useState<any[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [supplierName, setSupplierName] = useState("Blue Star Representative");
  const [phone, setPhone] = useState("+919848011100");
  const [generating, setGenerating] = useState(false);
  const [loadingParties, setLoadingParties] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [generatedResult, setGeneratedResult] = useState<{
    guestUrl: string;
    whatsappDeepLink: string;
    projectPin: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setLoadingParties(true);
      setError(null);
      setGeneratedResult(null);

      apiFetch<any[]>("/api/v1/parties")
        .then((data) => {
          const list = Array.isArray(data) ? data : (data as any)?.data || [];
          setParties(list);
          const supplier = list.find((p: any) =>
            Array.isArray(p.types) ? p.types.includes("SUPPLIER_OEM") : p.type === "SUPPLIER_OEM"
          ) || list[0];
          if (supplier) {
            setSelectedPartyId(supplier.id);
            setSupplierName(supplier.name);
            if (supplier.phone) setPhone(supplier.phone);
          }
        })
        .catch((err) => {
          console.warn("Could not load parties:", err);
        })
        .finally(() => setLoadingParties(false));
    }
  }, [open]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirementId) {
      setError("No requirement selected.");
      return;
    }
    if (!selectedPartyId) {
      setError("Please select a supplier party.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const data = await apiFetch<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/supplier-links`, {
        method: "POST",
        body: JSON.stringify({
          supplierPartyId: selectedPartyId,
          requirementIds: [requirementId],
          expiresInDays: 30,
          otpRequired: true,
        }),
      });

      const messageText = `Hi ${supplierName}, please upload the requested technical certificate/warranty on TradeCloseout: ${data.guestUrl}. A one-time verification code will be sent to the registered contact.`;
      setGeneratedResult({
        guestUrl: data.guestUrl,
        whatsappDeepLink: phone
          ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(messageText)}`
          : data.whatsappDeepLink || `https://wa.me/?text=${encodeURIComponent(messageText)}`,
        projectPin: data.projectPin,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to generate supplier upload link.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!generatedResult) return;
    navigator.clipboard.writeText(generatedResult.guestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate Supplier WhatsApp Magic Link"
      subtitle="Invite equipment OEMs (Daikin, Blue Star, Grundfos) to upload evidence directly from their phone"
      maxWidth="max-w-lg"
    >
      {!generatedResult ? (
        <form onSubmit={handleGenerate} className="space-y-4">
          {requirementTitle && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
              <span className="font-semibold block truncate">Scope: {requirementTitle}</span>
              <span className="text-[11px] text-blue-700 block mt-0.5">
                The supplier will only see this assigned requirement and cannot access project pricing.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Supplier / OEM Organization
            </label>
            {loadingParties ? (
              <div className="h-9 w-full animate-pulse rounded bg-slate-100" />
            ) : (
              <select
                value={selectedPartyId}
                onChange={(e) => {
                  setSelectedPartyId(e.target.value);
                  const p = parties.find((item) => item.id === e.target.value);
                  if (p) {
                    setSupplierName(p.name);
                    if (p.phone) setPhone(p.phone);
                  }
                }}
                required
                className="w-full rounded border border-slate-300 p-2 text-xs bg-white focus:border-blue-600 focus:outline-none"
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({Array.isArray(p.types) ? p.types.join(", ") : p.type || "SUPPLIER"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Contact Person / Representative Name
            </label>
            <input
              type="text"
              required
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. Naveen Kumar (Blue Star Service)"
              className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Supplier Mobile Number (WhatsApp)
            </label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919848011100"
              className="w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-600 focus:outline-none"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              Used to generate a direct 1-click WhatsApp message deep link.
            </span>
          </div>

          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-[11px] text-emerald-900 flex items-start gap-2">
            <KeyRound className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Zero Password Friction:</strong> The supplier receives a 4-digit PIN. They do not need to register an account or install any app.
            </span>
          </div>

          {error && (
            <div className="rounded bg-red-50 p-2 text-xs text-red-800 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={generating || !selectedPartyId}
              className="inline-flex items-center gap-1.5 rounded bg-[#16A34A] px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating Link...</span>
                </>
              ) : (
                <>
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Generate WhatsApp Link</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {/* Success Banner */}
          <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-3.5 text-xs text-emerald-950 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Supplier Magic Link Ready!</span>
            </div>
            <p className="text-[11px] text-emerald-800">
              Deliver this link to <strong>{supplierName}</strong>. Any files uploaded will be quarantined until verified by your QC team.
            </p>
          </div>

          {/* Generated URL & PIN */}
          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Direct Guest Link
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={generatedResult.guestUrl}
                  className="w-full rounded border border-slate-300 bg-slate-50 p-2 text-xs font-mono text-slate-800 select-all"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded border border-slate-300 bg-white p-2 hover:bg-slate-50 cursor-pointer text-slate-700"
                  title="Copy Link"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase font-bold text-slate-500 block">Supplier verification</span>
                <span className="text-sm font-semibold text-slate-900">One-time code required</span>
              </div>
              <span className="text-[11px] text-slate-500">Valid for 30 days</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <a
              href={generatedResult.whatsappDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-[#25D366] py-2.5 text-xs font-bold text-white hover:bg-emerald-600 transition-all cursor-pointer shadow-xs text-center"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Send via WhatsApp</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
