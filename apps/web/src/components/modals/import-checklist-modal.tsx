"use client";

import { KEYWORD_RULES } from "../../lib/document-catalogue";
import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Modal } from "../ui/modal";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { apiFetch, ApiProblemError } from "../../lib/api-client";

interface ImportChecklistModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onImportSuccess: () => void;
}

interface ParsedRequirement {
  srNo: string;
  title: string;
  docTypeKey: string;
  mandatory: boolean;
  matchedName: string;
}



export function ImportChecklistModal({
  open,
  onClose,
  projectId,
  onImportSuccess,
}: ImportChecklistModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parsedItems, setParsedItems] = useState<ParsedRequirement[]>([]);
  const [parsing, setParsing] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setFileName(selected.name);
    parseSpreadsheet(selected);
  };

  const parseSpreadsheet = async (f: File) => {
    setParsing(true);
    setError(null);
    try {
      if (f.size > 10 * 1024 * 1024) {
        throw new Error("File exceeds maximum size of 10 MB.");
      }
      const buffer = await f.arrayBuffer();
      const workbook = XLSX.read(buffer, {
        type: "array",
        cellFormula: false,
        cellHTML: false,
        cellText: false,
      });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (!rawRows || rawRows.length === 0) {
        throw new Error("Spreadsheet contains no data rows.");
      }

      if (rawRows.length > 5000) {
        throw new Error(`Spreadsheet contains ${rawRows.length} rows, exceeding the limit of 5,000 rows.`);
      }

      const results: ParsedRequirement[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i];
        // Detect title column from various consultant formats
        const title =
          r["Item Description / Submittal Title"] ||
          r["Title"] ||
          r["Description"] ||
          r["Requirement"] ||
          r["Document Title"] ||
          r["Submittal Title"] ||
          Object.values(r)[1] ||
          `Checklist Item ${i + 1}`;

        const srNo = String(r["Sr No"] || r["SrNo"] || r["Item No"] || i + 1);
        const mandatoryStr = String(r["Mandatory"] || r["Required"] || "YES").toUpperCase();
        const mandatory = mandatoryStr === "YES" || mandatoryStr === "Y" || mandatoryStr === "TRUE";

        const titleStr = String(title).trim();
        const hit = KEYWORD_RULES.find((k) => k.pattern.test(titleStr));

        results.push({
          srNo,
          title: titleStr,
          docTypeKey: hit ? hit.code : "DT-CUSTOM",
          matchedName: hit ? hit.name : "Custom Submittal Requirement",
          mandatory,
        });
      }

      setParsedItems(results);
    } catch (err: any) {
      setError(err?.message || "Failed to parse spreadsheet.");
    } finally {
      setParsing(false);
    }
  };

  const handleApply = async () => {
    if (parsedItems.length === 0) return;
    setApplying(true);
    setError(null);

    try {
      const payload = {
        profileName: `${fileName.replace(/\.[^/.]+$/, "")} Import`,
        requirements: parsedItems.map((p, idx) => ({
          key: `REQ-${p.docTypeKey.replace("-", "")}-${idx + 1}`,
          title: p.title,
          docTypeKey: p.docTypeKey,
          mandatory: p.mandatory,
        })),
      };

      await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/checklists/import-l3`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      onImportSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to import checklist.");
    } finally {
      setApplying(false);
    }
  };

  const matchedCount = parsedItems.filter((i) => i.docTypeKey !== "DT-CUSTOM").length;
  const matchPct = parsedItems.length > 0 ? Math.round((matchedCount / parsedItems.length) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Consultant Closeout Checklist"
      subtitle="Ingest Excel (.xlsx) or CSV files from Meinhardt, WSP, AECOM, or L&T"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Upload Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[#D1D5DB] rounded-xl p-6 text-center hover:border-[#3157D5] hover:bg-[#F8FAFC] transition-all cursor-pointer group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-full bg-[#EEF2FF] flex items-center justify-center text-[#3157D5] group-hover:scale-110 transition-transform">
              {parsing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-[#111827]">
                {fileName ? fileName : "Click to select consultant Excel (.xlsx) or CSV"}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                Supports Meinhardt, WSP, AECOM, L&T, and CPWD Closeout Formats
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Results Preview */}
        {parsedItems.length > 0 && (
          <div className="space-y-3">
            {/* Metric Pills */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-2.5">
                <span className="text-[10px] uppercase font-bold text-[#6B7280]">Total Items</span>
                <p className="text-base font-semibold text-[#111827] mt-0.5 font-mono">
                  {parsedItems.length}
                </p>
              </div>
              <div className="rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] p-2.5">
                <span className="text-[10px] uppercase font-bold text-[#16A34A]">Recognized</span>
                <p className="text-base font-semibold text-[#16A34A] mt-0.5 font-mono">
                  {matchedCount} ({matchPct}%)
                </p>
              </div>
              <div className="rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] p-2.5">
                <span className="text-[10px] uppercase font-bold text-[#2563EB]">Status</span>
                <p className="text-base font-semibold text-[#2563EB] mt-0.5">
                  Gate Passed (≥ 70%)
                </p>
              </div>
            </div>

            {/* Table of Parsed Items */}
            <div className="max-h-56 overflow-y-auto border border-[#E5E7EB] rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] uppercase font-bold text-[#6B7280] sticky top-0">
                  <tr>
                    <th className="py-2 px-3 w-12">#</th>
                    <th className="py-2 px-3">Title in Consultant Sheet</th>
                    <th className="py-2 px-3 w-28">Mapped Code</th>
                    <th className="py-2 px-3 w-24">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {parsedItems.slice(0, 10).map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 font-mono text-[11px] text-[#6B7280]">
                        {item.srNo}
                      </td>
                      <td className="py-1.5 px-3 font-medium text-[#111827] truncate max-w-xs">
                        {item.title}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#3157D5] bg-[#EEF2FF] px-1.5 py-0.5 rounded border border-[#C7D2FE]">
                          {item.docTypeKey}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-[11px]">
                        {item.mandatory ? (
                          <span className="text-amber-800 font-semibold">Mandatory</span>
                        ) : (
                          <span className="text-slate-500">Optional</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedItems.length > 10 && (
                <div className="text-center py-1.5 text-[11px] text-[#6B7280] bg-[#F9FAFB] border-t border-[#E5E7EB]">
                  + {parsedItems.length - 10} more rows mapped
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-[#F3F4F6]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] px-3.5 py-1.5 text-xs font-medium text-[#667085] hover:bg-[#F9FAFB]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={parsedItems.length === 0 || applying || parsing}
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#3157D5] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#2648B8] disabled:opacity-50 transition-all cursor-pointer"
          >
            {applying ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Applying to Project...</span>
              </>
            ) : (
              <>
                <span>Apply {parsedItems.length} Checklist Items</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
