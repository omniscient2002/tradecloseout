'use client';

import React, { useState } from 'react';
import { UploadSheet } from '../components/upload-sheet';
import {
  Building2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Package,
  Layers,
  ShieldCheck,
  CreditCard,
  Search,
  Bell,
  ChevronDown,
  UploadCloud,
  FileCheck2,
  Users,
  Settings,
  Flame,
  ArrowUpRight,
  ExternalLink,
  SlidersHorizontal,
  ChevronRight,
  DollarSign,
  DownloadCloud,
} from 'lucide-react';

export default function TradeCloseoutDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'checklist' | 'assets' | 'upload' | 'reviews' | 'packages' | 'billing'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMilestone, setSelectedMilestone] = useState<string>('ALL');

  const milestones = [
    { key: 'DELIVERY', label: 'Material Delivery', total: 24, completed: 24, status: 'COMPLETE' },
    { key: 'INSTALLATION', label: 'Installation & Piping', total: 32, completed: 32, status: 'COMPLETE' },
    { key: 'COMMISSIONING', label: 'Testing & Balancing (TAB)', total: 22, completed: 21, status: 'IN_PROGRESS' },
    { key: 'HANDOVER', label: 'Client Handover Package', total: 12, completed: 10, status: 'ACTIVE' },
    { key: 'FINAL_BILL', label: 'Final Bill & Retention', total: 5, completed: 4, status: 'PENDING' },
    { key: 'DLP_END', label: '12M DLP Signoff', total: 3, completed: 3, status: 'SCHEDULED' },
  ];

  const checklistItems = [
    { id: 'REQ-001', code: 'DOC-HVAC-01', title: 'Chilled Water Piping Hydrostatic Test Certificate (10.5 bar)', milestone: 'COMMISSIONING', status: 'APPROVED', party: 'Cooling Systems Subcontractor', dueDate: '2026-11-05' },
    { id: 'REQ-002', code: 'DOC-HVAC-02', title: 'Air Handling Unit (AHU-01 to AHU-06) Air Balancing (TAB) Report', milestone: 'COMMISSIONING', status: 'IN_REVIEW', party: 'Independent TAB Agency', dueDate: '2026-11-08' },
    { id: 'REQ-003', code: 'DOC-HVAC-03', title: 'Water Cooled Screw Chiller (500 TR) Manufacturer Warranty (5 Year)', milestone: 'HANDOVER', status: 'APPROVED', party: 'OEM Chiller India Pvt Ltd', dueDate: '2026-10-25' },
    { id: 'REQ-004', code: 'DOC-HVAC-04', title: 'BMS DDC Controller Field Integration Signoff & As-Built Points List', milestone: 'HANDOVER', status: 'PENDING_WAIVER', party: 'SmartBuilding Systems', dueDate: '2026-11-12' },
    { id: 'REQ-005', code: 'DOC-HVAC-05', title: 'Chief Fire Officer Statutory NOC & Smoke Spill Damper Test Certificate', milestone: 'HANDOVER', status: 'IN_REVIEW', party: 'Apex MEP Contractors', dueDate: '2026-11-02' },
    { id: 'REQ-006', code: 'DOC-HVAC-06', title: 'Comprehensive O&M Manual & Asset Preventive Maintenance Schedule', milestone: 'HANDOVER', status: 'MISSING', party: 'Apex MEP Contractors', dueDate: '2026-11-15' },
  ];

  const assets = [
    { tag: 'CH-01', name: 'Water-Cooled Centrifugal Chiller (650 TR)', type: 'CHILLER', location: 'Basement 2 Energy Plant', serial: 'CW-2025-9921', status: 'COMMISSIONED', warrantyMonths: 60 },
    { tag: 'AHU-L03-01', name: 'Variable Air Volume AHU (8,500 CFM)', type: 'AHU', location: 'Level 3 Mechanical Room', serial: 'AHU-V-1029', status: 'BALANCED', warrantyMonths: 24 },
    { tag: 'PMP-CHW-01', name: 'Primary Chilled Water Pump (45 kW)', type: 'PUMP', location: 'B2 Pump Station', serial: 'GRN-4421-P', status: 'COMMISSIONED', warrantyMonths: 36 },
    { tag: 'CT-01', name: 'Induced Draft Crossflow Cooling Tower (700 TR)', type: 'COOLING_TOWER', location: 'Rooftop Terrace', serial: 'CT-8832-RF', status: 'TESTED', warrantyMonths: 24 },
  ];

  const filteredChecklist = checklistItems.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || item.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMilestone = selectedMilestone === 'ALL' || item.milestone === selectedMilestone;
    return matchesSearch && matchesMilestone;
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Enterprise Navigation Bar (SCR-005 / Navigation §2.1) */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500 text-white flex items-center justify-center font-bold tracking-wider shadow-sm">
                TC
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight text-white flex items-center gap-2">
                  TradeCloseout <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">Enterprise v0.2.1</span>
                </span>
              </div>
            </div>

            {/* Tenant Selector Dropdown */}
            <div className="hidden md:flex items-center gap-2 pl-6 border-l border-slate-800">
              <Building2 className="w-4 h-4 text-slate-400" />
              <div className="text-left cursor-pointer">
                <p className="text-[11px] font-medium text-slate-400 leading-none">Active Organisation</p>
                <p className="text-xs font-semibold text-slate-200 mt-0.5 flex items-center gap-1">
                  Apex MEP Contractors Pvt Ltd <ChevronDown className="w-3 h-3 text-slate-400" />
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Project Switcher */}
            <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-medium text-slate-300">PRJ-HVAC-2026: Skyview Commercial Towers</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </div>

            <div className="flex items-center gap-3 pl-2">
              <button className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors relative">
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-500"></span>
              </button>

              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-semibold text-xs text-sky-300">
                  AP
                </div>
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-medium text-slate-200 leading-tight">Anil Pillai</p>
                  <p className="text-[10px] text-slate-400">Project Director (R-PM)</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Global Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto gap-1 border-t border-slate-800/60 no-scrollbar">
          {[
            { id: 'overview', label: 'Executive Dashboard', icon: Layers },
            { id: 'checklist', label: 'HVAC Checklist (98)', icon: CheckCircle2 },
            { id: 'assets', label: 'Asset Register (4)', icon: FileText },
            { id: 'upload', label: 'Mobile Upload (SCR-023)', icon: UploadCloud },
            { id: 'reviews', label: 'Review Queue & Waivers', icon: ShieldCheck },
            { id: 'packages', label: 'Handover Packages', icon: Package },
            { id: 'billing', label: 'Rule 46 GST & TDS', icon: CreditCard },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
                  isActive
                    ? 'border-sky-500 text-sky-400 bg-slate-800/40'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Summary Cards (BR-GTM-07 / Section 11 §1.2) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
              <span>Closeout Progress</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">96%</span>
              <span className="text-xs font-medium text-slate-500">94 of 98 approved</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 mt-3">
              <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '96%' }} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
              <span>Retention Rupee-at-Risk</span>
              <DollarSign className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">₹75.0 Lakh</span>
              <span className="text-xs font-medium text-amber-600">4 docs pending</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Weekly Owner Digest: Handover milestone gate blocked
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
              <span>Reviews In SLA</span>
              <Clock className="w-4 h-4 text-sky-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">2 Active</span>
              <span className="text-xs font-medium text-emerald-600">0 overdue</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Consultant review SLA: 48h turnaround active
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
              <span>DLP Defect Liability</span>
              <ShieldCheck className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900">12 Months</span>
              <span className="text-xs font-medium text-slate-500">starts Dec 2026</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              4 OEM warranties registered with active serials
            </p>
          </div>
        </div>

        {/* Tab 1: Executive Dashboard (SCR-010 / SCR-013) */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Milestone Progress Bar */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Project Milestone Gate Tracking</h3>
                  <p className="text-xs text-slate-500">Contractual deliverables grouped by project release milestones</p>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                  Target Handover: 15 Nov 2026
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-2">
                {milestones.map((m, idx) => (
                  <div
                    key={m.key}
                    onClick={() => { setSelectedMilestone(m.key); setActiveTab('checklist'); }}
                    className="p-3 rounded-lg border border-slate-200 hover:border-sky-400 hover:bg-slate-50/50 cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
                      <span>Gate {idx + 1}</span>
                      <span className={m.completed === m.total ? 'text-emerald-600' : 'text-sky-600'}>
                        {m.completed}/{m.total}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-800 truncate">{m.label}</p>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
                      <div
                        className={`h-1.5 rounded-full ${m.completed === m.total ? 'bg-emerald-500' : 'bg-sky-500'}`}
                        style={{ width: `${(m.completed / m.total) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Split View: Action items & Quick Upload */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Blockers Requiring Contractor Action
                  </h3>
                  <button
                    onClick={() => setActiveTab('checklist')}
                    className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1"
                  >
                    View All 98 <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {checklistItems.filter((i) => i.status !== 'APPROVED').map((item) => (
                    <div key={item.id} className="p-3.5 rounded-lg border border-slate-100 hover:bg-slate-50/60 transition-colors flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-slate-600">{item.code}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                            item.status === 'IN_REVIEW'
                              ? 'bg-sky-100 text-sky-800'
                              : item.status === 'PENDING_WAIVER'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {item.status}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800">{item.title}</p>
                        <p className="text-[11px] text-slate-500">Responsible: {item.party} • Due: {item.dueDate}</p>
                      </div>

                      <button
                        onClick={() => setActiveTab('upload')}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-medium shrink-0 flex items-center gap-1.5"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-5 space-y-4">
                <UploadSheet
                  projectId="PRJ-HVAC-2026"
                  requirementId="REQ-006"
                  requirementTitle="O&M Manual & Preventive Maintenance Schedule"
                  onUploadComplete={() => setActiveTab('checklist')}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Checklist (SCR-014) */}
        {activeTab === 'checklist' && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">HVAC Handover Requirements Register</h3>
                <p className="text-xs text-slate-500">Authority template: TPL-HVAC-IN-001 (98 document requirements)</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search documents or codes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                  />
                </div>

                <select
                  value={selectedMilestone}
                  onChange={(e) => setSelectedMilestone(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-medium focus:outline-none"
                >
                  <option value="ALL">All Milestones</option>
                  <option value="DELIVERY">Material Delivery</option>
                  <option value="INSTALLATION">Installation</option>
                  <option value="COMMISSIONING">Testing & TAB</option>
                  <option value="HANDOVER">Handover</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Requirement Title</th>
                    <th className="py-3 px-4">Milestone</th>
                    <th className="py-3 px-4">Party</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredChecklist.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-700">{item.code}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-900 max-w-sm">{item.title}</td>
                      <td className="py-3.5 px-4">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {item.milestone}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 truncate max-w-xs">{item.party}</td>
                      <td className="py-3.5 px-4">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                          item.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.status === 'IN_REVIEW'
                            ? 'bg-sky-100 text-sky-800'
                            : item.status === 'PENDING_WAIVER'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => setActiveTab('upload')}
                          className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-medium"
                        >
                          Upload
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Asset Register (SCR-018) */}
        {activeTab === 'assets' && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">MEP Asset & Equipment Register</h3>
                <p className="text-xs text-slate-500">Tied directly to O&M documents and warranty maintenance countdowns</p>
              </div>
              <button className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Export Asset Schedule
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {assets.map((asset) => (
                <div key={asset.tag} className="p-4 rounded-xl border border-slate-200 hover:shadow-md transition-shadow bg-slate-50/30">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-sky-100 text-sky-800">
                        {asset.tag}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 mt-2">{asset.name}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{asset.location}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {asset.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-200/60 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Serial Number</span>
                      <span className="font-mono font-medium text-slate-700">{asset.serial}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Warranty Period</span>
                      <span className="font-medium text-slate-700">{asset.warrantyMonths} Months Active</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Upload Sheet (SCR-023) */}
        {activeTab === 'upload' && (
          <div className="max-w-xl mx-auto py-4">
            <UploadSheet
              projectId="PRJ-HVAC-2026"
              requirementId="REQ-001"
              requirementTitle="Chilled Water Hydrostatic Test Certificate (10.5 bar)"
              onUploadComplete={() => setActiveTab('checklist')}
            />
          </div>
        )}

        {/* Tab 5: Reviews & Waivers (SCR-026 / SCR-027) */}
        {activeTab === 'reviews' && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Review Queue & Mandatory Waiver Workflow</h3>
              <p className="text-xs text-slate-500">Atomic verification under FOR UPDATE document row locks (API-100 / API-061A)</p>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-sky-100 bg-sky-50/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-900 rounded">
                      DUAL SIGN-OFF WAIVER REQUIRED (API-061)
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-600">REQ-004</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">BMS DDC Controller Field Integration Signoff</h4>
                  <p className="text-xs text-slate-600">Requested by Anil Pillai (PM) • Reason: Client vendor DDC gateway delayed by 3 weeks</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold">
                    Reject Waiver
                  </button>
                  <button className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold">
                    Countersign as R-OWNER
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-sky-100 text-sky-800 rounded">
                      PENDING REVIEW
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-600">DOC-HVAC-02</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">AHU Air Balancing (TAB) Final Field Test Report</h4>
                  <p className="text-xs text-slate-500">Uploaded 4 hours ago by Independent TAB Agency • Revision B</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold">
                    View Sanitised PDF
                  </button>
                  <button className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold">
                    Approve Decision
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Handover Packages (SCR-028) */}
        {activeTab === 'packages' && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Digital Handover Package Generator</h3>
                <p className="text-xs text-slate-500">Pure-Node pdf-lib + pdfmake TOC indexer, Bates page stamping & ZIP compilation</p>
              </div>

              <button className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2">
                <DownloadCloud className="w-4 h-4" /> Generate Full Handover ZIP
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Volume 1</h4>
                <p className="text-sm font-bold text-slate-900">Statutory Approvals & NOCs</p>
                <p className="text-xs text-slate-500">14 documents • Stamped Pages 1–114</p>
                <div className="pt-2">
                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 100% Ready
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Volume 2</h4>
                <p className="text-sm font-bold text-slate-900">Test & Commissioning (TAB) Reports</p>
                <p className="text-xs text-slate-500">22 documents • Stamped Pages 115–480</p>
                <div className="pt-2">
                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 100% Ready
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Volume 3</h4>
                <p className="text-sm font-bold text-slate-900">O&M Manuals & Asset Warranties</p>
                <p className="text-xs text-slate-500">62 documents • Stamped Pages 481–1240</p>
                <div className="pt-2">
                  <span className="text-xs text-amber-600 font-semibold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Pending 2 Items
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 7: Billing & GST Invoices (SCR-044) */}
        {activeTab === 'billing' && (
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-900">Subscription & Statutory Indian Billing</h3>
              <p className="text-xs text-slate-500">Rule 46 GST Compliance (SAC 998315) & Section 194J TDS Tracking</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase">Current Plan</span>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-sky-100 text-sky-800">GROWTH TIER</span>
                </div>
                <div className="text-2xl font-extrabold text-slate-900">₹24,999 <span className="text-xs font-normal text-slate-500">/ project / year</span></div>
                <p className="text-xs text-slate-600">Active project limit: 10 projects (1 used). Includes 500GB S3 storage and unlimited guest reviewer tokens.</p>
              </div>

              <div className="p-5 rounded-xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase">Section 194J TDS Deductions</h4>
                <div className="text-sm font-bold text-slate-800">Form 16A Certificate Status</div>
                <p className="text-xs text-slate-600">
                  Deducted at 10% on payment. Upload quarterly Form 16A PDF from TRACES portal to mark deduction as RECONCILED.
                </p>
                <div className="pt-2">
                  <span className="px-2.5 py-1 rounded bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
                    Q3 FY26: Pending Certificate Upload
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
