import Dexie, { type Table } from "dexie";
import type { Project } from "@/lib/model/types";

export interface StoredProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  data: Project;
}

export interface ProjectSnapshotRecord {
  id?: number;
  projectId: string;
  label: string;
  createdAt: string;
  data: Project;
}

export interface QuarantinedBackupRecord {
  id?: number;
  reason: string;
  createdAt: string;
  rawData: unknown;
}

const MAX_SNAPSHOTS_PER_PROJECT = 20;

class RumahStudioDB extends Dexie {
  projects!: Table<StoredProjectRecord, string>;
  snapshots!: Table<ProjectSnapshotRecord, number>;
  backups!: Table<QuarantinedBackupRecord, number>;

  constructor() {
    super("rumah-studio-db");
    this.version(1).stores({
      projects: "id, updatedAt",
      snapshots: "++id, projectId, createdAt",
    });
    this.version(2).stores({
      projects: "id, updatedAt",
      snapshots: "++id, projectId, createdAt",
      backups: "++id, createdAt",
    });
  }
}

export const db = typeof window !== "undefined" ? new RumahStudioDB() : null;

export async function saveAutosaveProject(project: Project): Promise<void> {
  if (!db) return;
  await db.projects.put({
    id: project.id,
    name: project.name,
    updatedAt: new Date().toISOString(),
    data: project,
  });
}

export async function loadLatestProject(): Promise<unknown> {
  if (!db) return null;
  const rows = await db.projects.orderBy("updatedAt").reverse().limit(1).toArray();
  return rows[0]?.data ?? null;
}

export async function quarantineCorruptSave(reason: string, rawData: unknown): Promise<void> {
  if (!db) return;
  try {
    await db.backups.add({
      reason,
      createdAt: new Date().toISOString(),
      rawData,
    });
  } catch {
    // Ignore IndexedDB quota/serialization errors during quarantine
  }
}

export async function listQuarantinedBackups(): Promise<QuarantinedBackupRecord[]> {
  if (!db) return [];
  return db.backups.orderBy("createdAt").reverse().limit(5).toArray();
}

export async function saveProjectSnapshot(project: Project, label: string): Promise<void> {
  if (!db) return;
  await db.snapshots.add({
    projectId: project.id,
    label,
    createdAt: new Date().toISOString(),
    data: project,
  });
  const all = await db.snapshots.where("projectId").equals(project.id).sortBy("createdAt");
  if (all.length > MAX_SNAPSHOTS_PER_PROJECT) {
    const excess = all.slice(0, all.length - MAX_SNAPSHOTS_PER_PROJECT);
    await Promise.all(
      excess.map((rec) => (rec.id !== undefined ? db!.snapshots.delete(rec.id) : Promise.resolve())),
    );
  }
}

export async function deleteProjectSnapshot(id: number): Promise<void> {
  if (!db) return;
  await db.snapshots.delete(id);
}

export async function listProjectSnapshots(projectId: string): Promise<ProjectSnapshotRecord[]> {
  if (!db) return [];
  return db.snapshots.where("projectId").equals(projectId).reverse().sortBy("createdAt");
}
