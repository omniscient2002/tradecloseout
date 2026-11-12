"use client";

import React, { useState } from "react";
import { X, Check, Shield, User, ArrowRight, RefreshCw, LogOut, KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";

export interface TeamPersona {
  name: string;
  email: string;
  phone: string;
  role: string;
  roleLabel: string;
  avatarColor: string;
  description: string;
}

export const REAL_PERSONAS: TeamPersona[] = [
  {
    name: "Vikramaditya Reddy",
    email: "vikram@deccanmep.in",
    phone: "+919848011101",
    role: "R-OWNER",
    roleLabel: "Managing Director (Owner)",
    avatarColor: "bg-indigo-700",
    description: "Full org authority, final waiver countersigning, financial sign-off",
  },
  {
    name: "Meera Deshmukh",
    email: "meera@deccanmep.in",
    phone: "+919848011102",
    role: "R-PM",
    roleLabel: "Senior Project Manager",
    avatarColor: "bg-emerald-700",
    description: "Project activation, waiver initiation, variation approvals, milestone delivery",
  },
  {
    name: "Karthikeya Sharma",
    email: "karthik@deccanmep.in",
    phone: "+919848011103",
    role: "R-QC",
    roleLabel: "Lead QA/QC Engineer",
    avatarColor: "bg-sky-700",
    description: "Inspection review & sign-off, hydro tests, FAT approvals, snag closure",
  },
  {
    name: "Amit Verma",
    email: "amit@deccanmep.in",
    phone: "+919848011104",
    role: "R-SITE",
    roleLabel: "Site Execution Engineer",
    avatarColor: "bg-amber-700",
    description: "Direct field uploads, test report submission, daily site execution",
  },
  {
    name: "Fatima Shaikh",
    email: "fatima@deccanmep.in",
    phone: "+919848011105",
    role: "R-DOC",
    roleLabel: "Document Controller",
    avatarColor: "bg-purple-700",
    description: "Package compiling, transmittals, contractor dossier archiving",
  },
];

interface LoginSwitchUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail?: string;
  onLoginSuccess: (user: any) => void;
}

export function LoginSwitchUserModal({
  isOpen,
  onClose,
  currentUserEmail,
  onLoginSuccess,
}: LoginSwitchUserModalProps) {
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState("");
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePersonaLogin = async (persona: TeamPersona) => {
    setLoadingEmail(persona.email);
    setErrorMsg(null);
    try {
      const otpRes = await api.auth.requestOtp(persona.email);
      if (otpRes.error || !otpRes.data) {
        throw new Error(otpRes.error || "Failed to send verification code");
      }
      setCustomInput(persona.email);
      setChallengeId(otpRes.data.challengeId);
      setOtpCode("");
      setOtpStep(true);
      setDebugOtp(otpRes.data.debugOtp || null);
      // Never attempt a guessed or fixed OTP; the human must verify access to
      // the chosen destination before the session is replaced.
    } catch (err: any) {
      setErrorMsg(err.message || "Login failed");
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleCustomRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    setLoadingEmail(customInput);
    setErrorMsg(null);
    try {
      const res = await api.auth.requestOtp(customInput.trim());
      if (res.error || !res.data) {
        throw new Error(res.error || "Could not request OTP");
      }
      setChallengeId(res.data.challengeId);
      if (res.data.debugOtp) {
        setDebugOtp(res.data.debugOtp);
        setOtpCode(res.data.debugOtp);
      }
      setOtpStep(true);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to request OTP");
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleCustomVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) return;
    setLoadingEmail("verifying");
    setErrorMsg(null);
    try {
      const res = await api.auth.verifyOtp(challengeId, otpCode.trim(), customInput.trim());
      if (res.error || !res.data) {
        throw new Error(res.error || "Invalid OTP code");
      }
      onLoginSuccess(res.data.user);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to verify OTP");
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleLogout = async () => {
    const result = await api.auth.logout();
    if (result.error) {
      setErrorMsg(result.error);
      return;
    }
    window.location.href = "/login";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">User Identity & Persona Switcher</h3>
              <p className="text-xs text-gray-500">Deccan EnviroTech MEP Pvt Ltd (Live Postgres DB)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Quick Persona Switcher List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Simulated Team Members (WF-01..26)
              </span>
              <span className="text-[11px] text-gray-400 font-mono">Real Sessions</span>
            </div>

            <div className="space-y-2">
              {REAL_PERSONAS.map((p) => {
                const isCurrent = currentUserEmail?.toLowerCase() === p.email.toLowerCase();
                const isLoading = loadingEmail === p.email;

                return (
                  <button
                    key={p.email}
                    onClick={() => handlePersonaLogin(p)}
                    disabled={Boolean(loadingEmail)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between group ${
                      isCurrent
                        ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                        : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50/70"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white font-bold text-xs ${p.avatarColor}`}
                      >
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900 truncate">{p.name}</span>
                          <span className="rounded bg-gray-100 border border-gray-200 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-gray-700">
                            {p.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">{p.roleLabel}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{p.email}</div>
                      </div>
                    </div>

                    <div className="shrink-0 pl-3">
                      {isLoading ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                      ) : isCurrent ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="opacity-0 group-hover:opacity-100 text-xs text-indigo-600 font-medium flex items-center gap-1 transition-opacity">
                          Switch <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-400 font-semibold tracking-wider text-[10px]">
                Or Login with Custom Credential
              </span>
            </div>
          </div>

          {/* Custom OTP login */}
          {!otpStep ? (
            <form onSubmit={handleCustomRequestOtp} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Email Address or Indian Mobile (+91)
                </label>
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="e.g. vikram@deccanmep.in or +919848011101"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <button
                type="submit"
                disabled={!customInput.trim() || Boolean(loadingEmail)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loadingEmail ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                <span>Send 6-Digit OTP</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleCustomVerifyOtp} className="space-y-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Code sent to: <strong className="text-gray-900">{customInput}</strong></span>
                <button
                  type="button"
                  onClick={() => setOtpStep(false)}
                  className="text-indigo-600 hover:underline text-[11px]"
                >
                  Change
                </button>
              </div>

              {debugOtp && (
                <div className="p-2 rounded bg-indigo-50 border border-indigo-200 text-xs text-indigo-800 flex items-center justify-between">
                  <span>Development Debug Code:</span>
                  <span className="font-mono font-bold text-sm tracking-widest">{debugOtp}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Enter 6-Digit Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-center font-mono text-base tracking-widest text-gray-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                />
              </div>

              <button
                type="submit"
                disabled={otpCode.length < 6 || Boolean(loadingEmail)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {loadingEmail === "verifying" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span>Verify & Enter Workspace</span>
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-gray-50/80 px-6 py-3 flex items-center justify-between">
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out Session</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
