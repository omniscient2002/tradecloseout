"use client";

import { humanLabel } from "../../lib/presentation";
import React, { useState, useEffect } from "react";
import { Modal } from "../ui/modal";
import {
  PackageCheck,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Receipt,
  FileText,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../lib/api-client";

interface CompileHandoverModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export function CompileHandoverModal({
  open,
  onClose,
  projectId,
  projectName,
}: CompileHandoverModalProps) {
  const [packType, setPackType] = useState<"FULL_HANDOVER" | "RA_BILL">("FULL_HANDOVER");

  // Full Handover States
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<{
    readyWithoutOverride: boolean;
    missingCount: number;
    expiredCount: number;
  }>({
    readyWithoutOverride: false,
    missingCount: 0,
    expiredCount: 0,
  });
  const [readinessAvailable, setReadinessAvailable] = useState(false);

  // RA Bill States
  const [milestoneKey, setMilestoneKey] = useState<string>("");
  const [billNumber, setBillNumber] = useState<string>("");
  const [billAmountInr, setBillAmountInr] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const [compiling, setCompiling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Result States
  const [packageResult, setPackageResult] = useState<{
    packageId: string;
    versionNo?: number;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !packageResult || packageResult.status === "READY" || packageResult.status === "FAILED") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await apiFetch<{ status: string }>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/packages/${encodeURIComponent(packageResult.packageId)}`,
        );
        if (cancelled) return;
        setPackageResult((current) => current ? { ...current, status: latest.status } : current);
        if (latest.status !== "READY" && latest.status !== "FAILED") timer = setTimeout(poll, 2500);
      } catch (pollError: any) {
        if (!cancelled) {
          setError(pollError.message || "Package status could not be refreshed.");
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, projectId, packageResult?.packageId, packageResult?.status]);

  const handleDownload = async () => {
    if (!packageResult || packageResult.status !== "READY") return;
    setDownloading(true);
    setError(null);
    try {
      const result = await apiFetch<{ downloadUrl: string }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/packages/${encodeURIComponent(packageResult.packageId)}/download`,
      );
      window.location.assign(result.downloadUrl);
    } catch (downloadError: any) {
      setError(downloadError.message || "Verified package download is unavailable.");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (open && projectId) {
      setLoadingReadiness(true);
      setError(null);
      setReadinessAvailable(false);
      setPackageResult(null);

      apiFetch<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/handover/readiness`)
        .then((data) => {
          if (data) {
            setReadiness({
              readyWithoutOverride: data.readyWithoutOverride === true,
              missingCount: data.blockers?.missingMandatoryCount ?? 0,
              expiredCount: data.blockers?.expiredMandatoryCount ?? 0,
            });
            setReadinessAvailable(true);
          }
        })
        .catch((err) => {
          console.warn("Readiness check returned:", err);
          setReadiness({ readyWithoutOverride: false, missingCount: 0, expiredCount: 0 });
          setError("Project readiness could not be checked. Retry before requesting a package.");
        })
        .finally(() => setLoadingReadiness(false));
    }
  }, [open, projectId]);

  const handleCompile = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompiling(true);
    setError(null);

    try {
      if (packType === "RA_BILL") {
        const data = await apiFetch<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/handover/ra-bill-pack`, {
          method: "POST",
          body: JSON.stringify({
            milestoneKey,
            billNumber: billNumber.trim(),
            billAmountInr: Number(billAmountInr) || 0,
            description: description.trim() || undefined,
          }),
        });

        setPackageResult({
          packageId: data.packageId,
          versionNo: data.versionNo,
          status: data.status || "QUEUED",
        });
      } else {
        const data = await apiFetch<any>(`/api/v1/projects/${encodeURIComponent(projectId)}/handover/packages`, {
          method: "POST",
          body: JSON.stringify({
          }),
        });

        setPackageResult({
          packageId: data.packageId,
          versionNo: data.versionNo,
          status: data.status || "QUEUED",
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to compile pack.");
    } finally {
      setCompiling(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={packType === "RA_BILL" ? "Prepare running account bill package" : "Prepare handover package"}
      subtitle={`Prepare a document package for ${projectName}`}
      maxWidth="max-w-xl"
    >
      {!packageResult ? (
        <form onSubmit={handleCompile} className="space-y-4 text-xs">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setPackType("FULL_HANDOVER")}
              className={`py-1.5 px-3 rounded-md font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                packType === "FULL_HANDOVER"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              <span>Full handover package</span>
            </button>
            <button
              type="button"
              onClick={() => setPackType("RA_BILL")}
              className={`py-1.5 px-3 rounded-md font-semibold text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                packType === "RA_BILL"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Monthly RA-Bill Pack</span>
            </button>
          </div>

          {packType === "RA_BILL" ? (
            /* RA Bill Mode Form */
            <div className="space-y-3 pt-1">
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-blue-900">
                <div className="font-semibold flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Monthly Progress Billing Annexure</span>
                </div>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  Creates a milestone-scoped evidence package record. It does not certify the bill, issue an invoice, or determine payment eligibility.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Billing Milestone Stage</label>
                  <select
                    required
                    value={milestoneKey}
                    onChange={(e) => setMilestoneKey(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-blue-600"
                  >
                    <option value="">Choose a billing stage</option>
                    <option value="MOBILISATION">Mobilisation Advance Pack</option>
                    <option value="DELIVERY">Material / Equipment Delivery (Factory Tests)</option>
                    <option value="INSTALLATION">Erection & Installation (Pressure Tests)</option>
                    <option value="COMMISSIONING">Testing & Commissioning (TAB / Balancing)</option>
                    <option value="HANDOVER">Interim handover</option>
                    <option value="FINAL_BILL">Final bill / end of defects liability period</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">RA Bill Number</label>
                  <input
                    type="text"
                    required
                    value={billNumber}
                    onChange={(e) => setBillNumber(e.target.value)}
                    placeholder="Your running account bill reference"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Claim amount (₹ INR, informational only)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={billAmountInr}
                    onChange={(e) => setBillAmountInr(e.target.value)}
                    placeholder="Amount claimed in this bill"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cover Note / Remarks (Optional)</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Chiller plant room TAB balancing & water balancing sheets"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Full Handover Mode Form */
            <div className="space-y-3 pt-1">
              {loadingReadiness ? (
                <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                  <span className="text-slate-600">Checking handover requirements…</span>
                </div>
              ) : !readinessAvailable ? (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900">
                  Readiness is unavailable. The package request is disabled until the check succeeds.
                </div>
              ) : readiness.readyWithoutOverride ? (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>The handover readiness check passed. You can prepare the package.</span>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Requirements still need attention</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    {readiness.missingCount} mandatory document(s) missing or {readiness.expiredCount} expired.
                    Resolve blockers or record an authorised waiver/not-applicable decision before requesting the final package.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded bg-red-50 p-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Footer Actions */}
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
              disabled={compiling || (packType === "FULL_HANDOVER" && (!readinessAvailable || !readiness.readyWithoutOverride))}
              className="inline-flex items-center gap-1.5 rounded bg-[#0F2942] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#163A5F] disabled:opacity-50 transition-all cursor-pointer shadow-xs"
            >
              {compiling ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing package…</span>
                </>
              ) : (
                <>
                  <PackageCheck className="w-3.5 h-3.5" />
                  <span>{packType === "RA_BILL" ? "Prepare running account bill package" : "Prepare handover package"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Keep the request visible while the worker builds its immutable artifact. */
        <div className="space-y-4 text-xs">
          <div className={`rounded-lg border p-4 space-y-1 ${packageResult.status === "READY" ? "bg-emerald-50 border-emerald-300 text-emerald-950" : packageResult.status === "FAILED" ? "bg-red-50 border-red-300 text-red-950" : "bg-amber-50 border-amber-300 text-amber-950"}`}>
            <div className="font-bold flex items-center gap-1.5">
              {packageResult.status === "READY" ? <CheckCircle2 className="w-4 h-4 text-emerald-700" /> : packageResult.status === "FAILED" ? <AlertTriangle className="w-4 h-4 text-red-600" /> : <Loader2 className="w-4 h-4 animate-spin text-amber-700" />}
              <span>{packageResult.status === "READY" ? "Handover PDF is ready" : packageResult.status === "FAILED" ? "Package generation failed" : "Generating handover package"}</span>
            </div>
            <p className="text-[11px]">
              {humanLabel(packageResult.status)}. The download becomes available after the package has been prepared and checked.
            </p>
          </div>

          {error && <div className="rounded bg-red-50 p-2.5 text-xs text-red-800">{error}</div>}

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5">
            <div>
              <span className="text-[11px] text-slate-500 block">Handover package{packageResult.versionNo == null ? "" : ` · Version ${packageResult.versionNo}`}</span>

            </div>
          </div>

          <div className="text-right pt-2 border-t border-slate-100">
            {packageResult.status === "READY" && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="mr-2 rounded-md bg-[#0F2942] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#163A5F] disabled:opacity-50"
              >
                {downloading ? "Preparing download…" : "Download verified PDF"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
