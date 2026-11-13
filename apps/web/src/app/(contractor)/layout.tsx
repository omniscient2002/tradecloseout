"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Building2,
  FolderKanban,
  FileText,
  Users,
  ShieldCheck,
  CreditCard,
  LogOut,
  ChevronDown,
  Bell,
  HardHat,
  Search,
  ClipboardList,
  CheckCircle2,
  FileCheck,
  Wrench,
  UploadCloud,
  FileSpreadsheet,
} from "lucide-react";
import { api, apiFetch, setCsrfToken, watchAuthChanges } from "../../lib/api-client";
import { setOfflineActorPartition } from "../../lib/offline-upload-queue";
import {OrganisationDatesProvider} from '../../components/organisation-dates';

const REAL_DECCAN_PERSONAS = [
  {
    id: "vikram",
    name: "Vikramaditya Reddy",
    role: "R-OWNER",
    roleTitle: "Managing Director (Owner)",
    email: "vikram@deccanmep.in",
    dutySummary: "Legal Entity & Billing Authority · Retention Release · 2nd Approver Waivers",
    avatarBg: "bg-indigo-700",
    badgeBg: "bg-indigo-50 border-indigo-200 text-indigo-900",
  },
  {
    id: "meera",
    name: "Meera Deshmukh",
    role: "R-PM",
    roleTitle: "Senior Project Manager",
    email: "meera@deccanmep.in",
    dutySummary: "Project Activation · Supplier Guest Links · Milestone Handover Compilation",
    avatarBg: "bg-emerald-700",
    badgeBg: "bg-emerald-50 border-emerald-200 text-emerald-900",
  },
  {
    id: "karthik",
    name: "Karthikeya Sharma",
    role: "R-QC",
    roleTitle: "Lead QA/QC Engineer",
    email: "karthik@deccanmep.in",
    dutySummary: "Technical Review & Sign-Off · Hydrostatic & Duct Approvals · Class 3 DSC Seals",
    avatarBg: "bg-sky-700",
    badgeBg: "bg-sky-50 border-sky-200 text-sky-900",
  },
  {
    id: "amit",
    name: "Amit Verma",
    role: "R-SITE",
    roleTitle: "Site Execution Engineer",
    email: "amit@deccanmep.in",
    dutySummary: "Field Evidence Capture · Physical Equipment Tagging · Basement Offline Outbox",
    avatarBg: "bg-amber-700",
    badgeBg: "bg-amber-50 border-amber-200 text-amber-900",
  },
];

export default function ContractorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{
    id?: string; name: string; orgRole: string; activeOrgId: string;
    activeOrg?: { display_name?: string; legal_name?: string };
  } | null>(null);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const unwatch = watchAuthChanges(() => {
      setOfflineActorPartition(null);
      setUser(null);
      setSessionConfirmed(false);
      window.location.reload();
    });
    apiFetch<any>("/api/v1/auth/me")
      .then((data) => {
        if (data.mfaRequired && !data.mfaVerified) {
          setOfflineActorPartition(null);
          router.push('/mfa');
          return;
        }
        if (!data.userId && !data.user_id) {
          setUser(null);
          setSessionConfirmed(false);
          setOfflineActorPartition(null);
          router.replace('/login');
          return;
        }
        setUser(data);
        setOfflineActorPartition(`member:${data.activeOrgId || data.active_org_id}:${data.userId || data.user_id}`);
        setSessionConfirmed(true);
      })
      .catch(() => {
        setUser(null);
        setSessionConfirmed(false);
        setOfflineActorPartition(null);
        router.replace('/login');
      });
    return unwatch;
  }, []);

  const handleLogout = async () => {
    setLogoutError(null);
    const result=await api.auth.logout();
    if(result.error){
      setLogoutError(result.error);
      return;
    }
    setOfflineActorPartition(null);
    window.location.href = "/login";
  };

  const handleQuickSwitch = async (_persona: (typeof REAL_DECCAN_PERSONAS)[0]) => {
    // Selecting a demo persona can never supply authentication evidence.
    // Sign-in requires the actual OTP at the verified destination.
    setOfflineActorPartition(null);
    router.push("/login");
  };

  // Demo information may not be used to describe a real authenticated user.
  const currentPersona = process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_ENABLE_DEV_PERSONAS === 'true'
    ? REAL_DECCAN_PERSONAS.find((p) => user?.name === p.name)
    : undefined;
  const organisationName = user?.activeOrg?.display_name ||
    user?.activeOrg?.legal_name || 'Your organisation';

  // Dynamic role-based navigation links per 05 §4
  const getNavLinks = () => {
    const role = user?.orgRole;
    if (!role) return [];

    if (role === "R-SITE") {
      return [
        { label: "Site Dashboard", href: "/dashboard", icon: HardHat },
        { label: "Projects", href: "/projects", icon: FolderKanban },
        { label: "Parties", href: "/parties", icon: Users },
      ];
    }

    if (role === "R-QC") {
      return [
        { label: "QC Station", href: "/dashboard", icon: ShieldCheck },
        { label: "Projects", href: "/projects", icon: FolderKanban },
        { label: "Parties", href: "/parties", icon: Users },
      ];
    }

    if (role === "R-OWNER" || role === "R-ADMIN") {
      return [
        { label: "Executive Dashboard", href: "/dashboard", icon: Building2 },
        { label: "Projects", href: "/projects", icon: FolderKanban },
        { label: "Parties", href: "/parties", icon: Users },
        { label: "Audit Log", href: "/audit", icon: ShieldCheck },
        { label: "Billing & GST", href: "/billing", icon: CreditCard },
      ];
    }

    if (role !== "R-PM") {
      // Unknown or newly introduced roles must not inherit PM navigation.
      return [{ label: "Projects", href: "/projects", icon: FolderKanban }];
    }
    return [
      { label: "PM Dashboard", href: "/dashboard", icon: Building2 },
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Parties", href: "/parties", icon: Users },
      { label: "Audit Log", href: "/audit", icon: ShieldCheck },
    ];
  };

  const navLinks = [...getNavLinks(), {label:'Notifications',href:'/notifications',icon:Bell},
    {label:'Settings',href:'/settings',icon:Users},
    ...(['R-OWNER','R-ADMIN'].includes(user?.orgRole??'')?[
      {label:'Setup',href:'/onboarding',icon:ClipboardList},
      {label:'Configuration',href:'/configuration',icon:FileText},
    ]:[])];

  if (!sessionConfirmed || !user) {
    return (
      <div role="status" aria-live="polite"
        className="min-h-screen bg-[#F8FAFC] text-slate-700 flex items-center justify-center text-sm">
        Verifying your workspace session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans">
      {/* Enterprise Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-2xs">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <div
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 cursor-pointer"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F2942] font-bold text-white text-xs">
                TC
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-slate-900 leading-tight">
                  TradeCloseout
                </span>
                <span className="text-[10px] font-semibold text-blue-700 tracking-wider">
                  {organisationName}
                </span>
              </div>
            </div>

            <nav className="hidden md:flex items-center gap-1 text-xs font-semibold">
              {navLinks.map((link) => {
                const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
                const Icon = link.icon;
                return (
                  <button
                    key={link.href}
                    onClick={() => router.push(link.href)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                      isActive
                        ? "bg-slate-100 text-blue-900 font-bold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{link.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Tax identifiers are displayed only when returned by the authorised organisation API. */}

            <button
              onClick={() => {
                window.location.href = "/login";
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold text-blue-900 hover:bg-blue-100 transition-colors cursor-pointer"
              title="Authenticate as a different account using a fresh OTP"
            >
              <Users className="h-3.5 w-3.5 text-blue-700" />
              <span className="hidden sm:inline">Switch account</span>
            </button>

            {user && (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${currentPersona?.avatarBg || 'bg-slate-700'}`}>
                    {user.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="font-semibold text-slate-800 leading-none">{user.name}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">{user.orgRole}</div>
                  </div>
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg z-50 text-xs">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="font-bold text-slate-900">{user.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{user.orgRole} · {currentPersona?.roleTitle || 'Authenticated member'}</div>
                      <div className="text-[10px] text-blue-700 font-medium mt-1">{organisationName}</div>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        router.push("/login");
                      }}
                      className="w-full text-left px-3 py-2 mt-1 rounded-md text-slate-700 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                    >
                      <span>Switch account with OTP</span>
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 rounded-md text-red-700 hover:bg-red-50 flex items-center justify-between cursor-pointer"
                    >
                      <span>Sign Out Session</span>
                      <LogOut className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 1-Click Interactive Enterprise Persona Dock (Gated in production - TC2-033) */}
        {(process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ENABLE_DEV_PERSONAS === 'true') && (
          <div className="bg-slate-900 text-white px-4 py-2 border-t border-slate-800 text-xs flex flex-wrap items-center justify-between gap-2 shadow-inner">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Active Persona (Dev 1-Click Switch):
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {REAL_DECCAN_PERSONAS.map((p) => {
                  const isCurrent = user?.name === p.name;
                  const isBusy = switching === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleQuickSwitch(p)}
                      disabled={Boolean(switching)}
                      title={`Switch immediately to ${p.name} (${p.roleTitle})`}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium cursor-pointer ${
                        isCurrent
                          ? "bg-blue-600 text-white font-bold ring-2 ring-blue-400 ring-offset-1 ring-offset-slate-900 shadow-sm"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                      } ${isBusy ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isCurrent ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                        }`}
                      />
                      <span>{p.name.split(" ")[0]}</span>
                      <span className="font-mono text-[10px] opacity-75">({p.role})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {currentPersona && (
              <div className="hidden lg:flex items-center gap-2 text-[11px] text-slate-300">
                <span className="font-semibold text-emerald-400">Duty & Authority:</span>
                <span className="text-slate-300">{currentPersona.dutySummary}</span>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1">
        {logoutError && (
          <div role="alert" className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {logoutError}
          </div>
        )}
        <OrganisationDatesProvider key={user?.activeOrgId}>{children}</OrganisationDatesProvider>
      </main>
    </div>
  );
}
