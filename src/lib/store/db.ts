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

class RumahStudioDB extends Dexie {
  projects!: Table<StoredProjectRecord, string>;
  snapshots!: Table<ProjectSnapshotRecord, number>;

  constructor() {
    super("rumah-studio-db");
    this.version(1).stores({
      projects: "id, updatedAt",
      snapshots: "++id, projectId, createdAt",
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

export async function loadLatestProject(): Promise<Project | null> {
  if (!db) return null;
  const rows = await db.projects.orderBy("updatedAt").reverse().limit(1).toArray();
  return rows[0]?.data ?? null;
}

export async function saveProjectSnapshot(project: Project, label: string): Promise<void> {
  if (!db) return;
  await db.snapshots.add({
    projectId: project.id,
    label,
    createdAt: new Date().toISOString(),
    data: project,
  });
}

export async function listProjectSnapshots(projectId: string): Promise<ProjectSnapshotRecord[]> {
  if (!db) return [];
  return db.snapshots.where("projectId").equals(projectId).reverse().sortBy("createdAt");
}
