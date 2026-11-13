"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FolderKanban,
  Users,
  ClipboardList,
  CreditCard,
  LogOut,
} from "lucide-react";
import { hasPermission } from "@tradecloseout/shared";
import { apiFetch, setCsrfToken } from "../../lib/api-client";
import { setOfflineActorPartition } from "../../lib/offline-upload-queue";
import { roleLabel } from "../../lib/presentation";

interface SessionUser {
  userId: string;
  name: string;
  orgRole: string;
  activeOrgId: string;
  activeOrg: { display_name: string | null; legal_name: string } | null;
}

export default function ContractorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch<SessionUser>("/api/v1/auth/me")
      .then((data) => {
        if (!active) return;
        setUser(data);
        setOfflineActorPartition(`member:${data.activeOrgId}:${data.userId}`);
      })
      .catch(() => {
        if (active)
          setError(
            "We could not load your account. Refresh the page to try again.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST" });
      setCsrfToken(null);
      setOfflineActorPartition(null);
      window.location.href = "/login";
    } catch {
      setError("We could not sign you out. Please try again.");
      setSigningOut(false);
    }
  };
  const links = [
    {
      label: "Overview",
      href: "/dashboard",
      icon: Building2,
      permission: "project.read",
    },
    {
      label: "Projects",
      href: "/projects",
      icon: FolderKanban,
      permission: "project.read",
    },
    {
      label: "Contacts",
      href: "/parties",
      icon: Users,
      permission: "party.read",
    },
    {
      label: "Activity",
      href: "/audit",
      icon: ClipboardList,
      permission: "audit.read",
    },
    {
      label: "Billing",
      href: "/billing",
      icon: CreditCard,
      permission: "billing.manage",
    },
  ].filter(
    (link) =>
      user && hasPermission({ orgRole: user.orgRole }, link.permission).allowed,
  );
  const orgName = user?.activeOrg?.display_name || user?.activeOrg?.legal_name;
  const initials = user?.name
    ?.split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              TC
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">TradeCloseout</span>
              <span className="block truncate text-xs text-slate-500">
                {orgName || "Your workspace"}
              </span>
            </span>
          </Link>
          <div className="relative">
            <button
              type="button"
              aria-expanded={accountOpen}
              aria-controls="account-menu"
              onClick={() => setAccountOpen(!accountOpen)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-800">
                {initials || "…"}
              </span>
              <span>
                <span className="block font-semibold">
                  {user?.name || "Loading account…"}
                </span>
                <span className="text-slate-500">
                  {roleLabel(user?.orgRole)}
                </span>
              </span>
            </button>
            {accountOpen && (
              <div
                id="account-menu"
                className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-4 text-xs shadow-lg"
              >
                <p className="font-semibold">{user?.name}</p>
                <p className="mt-1 break-words text-slate-500">{orgName}</p>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={logout}
                  className="mt-4 flex items-center gap-2 text-red-700 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </div>
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6"
        >
          {links.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href || pathname.startsWith(`${href}/`)
                  ? "page"
                  : undefined
              }
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${pathname === href || pathname.startsWith(`${href}/`) ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {error && (
        <div
          role="alert"
          className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
