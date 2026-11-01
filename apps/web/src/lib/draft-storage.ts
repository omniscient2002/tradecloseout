// apps/web/src/lib/draft-storage.ts
// Offline draft persistence with IndexedDB for intermittent site connectivity (SCR-023, 11 §4.8, RT-012)

import { get, set, del } from 'idb-keyval';

export interface UploadDraft {
  projectId: string;
  requirementId: string;
  revisionCode: string;
  issueDate: string;
  remarks: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  savedAt: number;
}

export const draftStorage = {
  getDraftKey(projectId: string, requirementId: string): string {
    return `draft:${projectId}:${requirementId}`;
  },

  async saveDraft(draft: UploadDraft): Promise<void> {
    const key = this.getDraftKey(draft.projectId, draft.requirementId);
    await set(key, draft);
  },

  async loadDraft(projectId: string, requirementId: string): Promise<UploadDraft | undefined> {
    const key = this.getDraftKey(projectId, requirementId);
    return get<UploadDraft>(key);
  },

  async clearDraft(projectId: string, requirementId: string): Promise<void> {
    const key = this.getDraftKey(projectId, requirementId);
    await del(key);
  },
};
