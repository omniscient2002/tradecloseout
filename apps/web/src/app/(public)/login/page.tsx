"use client";

import { INDIAN_STATES } from "../../../lib/presentation";
import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ArrowRight,
  KeyRound,
  Building2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  apiFetch,
  ApiProblemError,
  setCsrfToken,
} from "../../../lib/api-client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [step, setStep] = useState<"IDENTIFIER" | "OTP">("IDENTIFIER");
  const [mode, setMode] = useState<"SIGNIN" | "SIGNUP">("SIGNIN");
  const [identifier, setIdentifier] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        channel: string;
        expiresInSeconds: number;
        devOtpPreview?: string;
        debugOtp?: string;
      }>("/api/v1/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const code = res.devOtpPreview || res.debugOtp;
      setDevOtpHint(null);
      setOtp("");
      if (code) {
        setDevOtpHint(code);
        setOtp(code);
      }
      setStep("OTP");
    } catch (err: any) {
      setError(
        err instanceof ApiProblemError
          ? err.message
          : "Could not send verification code.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        user: any;
        activeOrgId: string;
        csrfToken: string;
      }>("/api/v1/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({
          identifier: identifier.trim(),
          otp: otp.trim(),
          code: otp.trim(),
          ...(mode === "SIGNUP"
            ? { signupProfile: { fullName, orgName, state: stateCode } }
            : {}),
        }),
      });
      setCsrfToken(res.csrfToken);
      router.push(nextPath);
      router.refresh();
    } catch (err: any) {
      setError(
        err instanceof ApiProblemError
          ? err.message
          : "Invalid verification code.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#0B1120] text-slate-100 flex flex-col lg:flex-row font-sans">
      {/* Left Brand & Domain Context Panel */}
      <div className="lg:w-5/12 border-b lg:border-b-0 lg:border-r border-slate-800 p-8 lg:p-12 flex flex-col justify-between bg-gradient-to-b from-[#0F172A] to-[#0B1120]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-md">
              TC
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white">
                TradeCloseout
              </span>
              <span className="ml-2 rounded bg-blue-500/20 border border-blue-400/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                INDIA MEP
              </span>
            </div>
          </div>

          <h1 className="mt-10 text-2xl lg:text-3xl font-bold tracking-tight text-white leading-snug">
            Keep your project handover on track.
          </h1>
          <p className="mt-3 text-xs lg:text-sm text-slate-400 leading-relaxed">
            Bring drawings, test reports, certificates, and approvals together
            so your team can see what is ready and what still needs attention.
          </p>
        </div>

        <div className="mt-10 rounded-xl border border-slate-700 p-5 text-sm text-slate-300">
          <h2 className="font-semibold text-white">Keep handover moving</h2>
          <ul className="mt-4 space-y-3">
            <li>See which documents your project still needs.</li>
            <li>Submit test reports and drawings for review.</li>
            <li>Prepare handover packages from reviewed records.</li>
          </ul>
        </div>
      </div>

      {/* Right Authentication Form (SCR-002 / SCR-003) */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-[#F8FAFC] text-[#0F172A]">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {step === "OTP"
                  ? "Enter verification code"
                  : mode === "SIGNIN"
                    ? "Sign in to your workspace"
                    : "Register contractor organisation"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {step === "OTP"
                  ? devOtpHint
                    ? `Use the code shown below for ${identifier}`
                    : `Enter the 6-digit code sent to ${identifier}`
                  : "Sign in with a verification code sent to your email or mobile."}
              </p>
            </div>
            <KeyRound className="h-5 w-5 text-slate-400" />
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === "IDENTIFIER" ? (
            <form
              onSubmit={handleRequestOtp}
              className="mt-5 space-y-4 text-xs"
            >
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Work email or Indian mobile number (+91)
                </label>
                <input
                  id="login-identifier"
                  autoComplete="username"
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Your work email or +91 mobile number"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              {mode === "SIGNUP" && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Your Full Name (Required)
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Organisation Legal Name (Required)
                    </label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Your organisation’s registered name"
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="company-state"
                      className="block font-semibold text-slate-700 mb-1"
                    >
                      Organisation state or union territory (Required)
                    </label>
                    <select
                      id="company-state"
                      required
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                    >
                      <option value="">
                        Select your state or union territory
                      </option>
                      {INDIAN_STATES.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-[#0F2942] py-2.5 text-xs font-semibold text-white hover:bg-[#163A5F] transition-colors disabled:opacity-60 cursor-pointer"
              >
                <span>
                  {loading ? "Sending code…" : "Send Verification Code"}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>

              <div className="pt-2 text-center text-xs text-slate-600">
                {mode === "SIGNIN" ? (
                  <button
                    type="button"
                    onClick={() => setMode("SIGNUP")}
                    className="font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    New contractor? Register a new organisation
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMode("SIGNIN")}
                    className="font-semibold text-blue-700 hover:underline cursor-pointer"
                  >
                    Already have an account? Sign in
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4 text-xs">
              {devOtpHint && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-950">
                  <div className="font-semibold">
                    Verification code (local preview):
                  </div>
                  <div className="mt-1 font-mono text-base font-bold tracking-widest text-emerald-800">
                    {devOtpHint}
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="login-code"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  6-Digit Verification Code (Required)
                </label>
                <input
                  type="text"
                  required
                  id="login-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="000000"
                  className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-center font-mono text-base font-bold tracking-widest text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-[#0F2942] py-2.5 text-xs font-semibold text-white hover:bg-[#163A5F] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {loading ? "Verifying identity…" : "Verify & Sign In"}
              </button>

              <button
                type="button"
                onClick={() => setStep("IDENTIFIER")}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                ← Use a different email or phone number
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-white">
          Loading...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
