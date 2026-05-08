export {
  listSnapshots,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  renameSnapshot,
  exportSnapshot,
  type SnapshotInfo,
} from "@/lib/runtime";

export function generateSnapshotName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
