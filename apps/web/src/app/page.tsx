'use client';

import React from 'react';
import { UploadSheet } from '../components/upload-sheet';

export default function HomePage() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold text-slate-900">TradeCloseout</h1>
        <p className="text-slate-600 mt-1">Enterprise MEP Closeout & Digital Handover Platform</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="bg-white p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-4">Project Handover Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Active Project:</span>
              <span className="font-medium">PRJ-HVAC-2026</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Milestone:</span>
              <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 font-semibold">HANDOVER</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600">Mandatory Items:</span>
              <span className="font-medium">94 / 98 Completed</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 mt-2">
              <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '96%' }} />
            </div>
          </div>
        </section>

        <section>
          <UploadSheet
            projectId="prj_demo_01"
            requirementId="req_demo_01"
            onUploadComplete={(versionId) => {
              console.log('Upload completed:', versionId);
            }}
          />
        </section>
      </div>
    </main>
  );
}
