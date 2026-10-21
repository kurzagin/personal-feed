import React, { useState, useEffect, useCallback } from "react";
import {
  HardDrive,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileQuestion,
  Database,
  Trash2,
  Wrench,
  Loader2,
  ExternalLink,
} from "lucide-react";

export interface AuditIssue {
  type: "missing_in_r2" | "zero_byte_r2" | "orphaned_r2" | "video_missing_hls";
  severity: "error" | "warning";
  key?: string;
  postId?: string;
  itemId?: string;
  mediaType?: string;
  size?: number;
  message: string;
}

export interface AuditReport {
  timestamp: number;
  totalPosts: number;
  totalPostItems: number;
  totalR2Objects: number;
  zeroByteCount: number;
  missingInR2Count: number;
  orphanedR2Count: number;
  unprocessedVideosCount: number;
  issues: AuditIssue[];
}

export const StorageAuditCard: React.FC = () => {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [repairingPostId, setRepairingPostId] = useState<string | null>(null);
  const [cleaningOrphans, setCleaningOrphans] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchAudit = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/storage/audit");
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      } else {
        setActionMessage({ type: "error", text: "Failed to fetch storage audit report" });
      }
    } catch (err: any) {
      setActionMessage({ type: "error", text: err?.message || "Storage audit request failed" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const handleRepairVideo = async (postId: string) => {
    try {
      setRepairingPostId(postId);
      setActionMessage({ type: "success", text: `Transcoding video & generating thumbnails for post ${postId}... This may take 1-2 minutes.` });
      const res = await fetch("/api/storage/repair-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: "success", text: `Post ${postId} repaired! Generated ${data.segments} HLS segments & preview grid.` });
        await fetchAudit();
      } else {
        setActionMessage({ type: "error", text: data.message || "Failed to repair video" });
      }
    } catch (err: any) {
      setActionMessage({ type: "error", text: err?.message || "Error running video repair" });
    } finally {
      setRepairingPostId(null);
    }
  };

  const handleCleanupOrphans = async () => {
    if (!report) return;
    const orphanKeys = report.issues.filter((i) => i.type === "orphaned_r2" && i.key).map((i) => i.key!);
    if (orphanKeys.length === 0) return;

    if (!confirm(`Are you sure you want to permanently delete ${orphanKeys.length} unreferenced ghost files from R2?`)) {
      return;
    }

    try {
      setCleaningOrphans(true);
      const res = await fetch("/api/storage/cleanup-orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: orphanKeys }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: "success", text: `Pruned ${data.count} orphaned files from R2 storage.` });
        await fetchAudit();
      } else {
        setActionMessage({ type: "error", text: data.message || "Failed to prune orphans" });
      }
    } catch (err: any) {
      setActionMessage({ type: "error", text: err?.message || "Error cleaning orphaned files" });
    } finally {
      setCleaningOrphans(false);
    }
  };

  const totalAnomalies =
    (report?.missingInR2Count || 0) +
    (report?.zeroByteCount || 0) +
    (report?.orphanedR2Count || 0) +
    (report?.unprocessedVideosCount || 0);

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-zinc-900/60 border border-white/10 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Cloudflare R2 & Storage Audit
            </h2>
            <p className="text-xs text-zinc-400">
              Verify database integrity, identify ghost/empty files in R2, and repair un-transcoded videos.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={fetchAudit}
          className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-zinc-200 border border-white/10 transition active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          <span>{loading ? "Auditing..." : "Run Audit"}</span>
        </button>
      </div>

      {actionMessage && (
        <div
          className={`p-3 rounded-xl flex items-center gap-2 text-xs border ${
            actionMessage.type === "success"
              ? "bg-emerald-950/70 border-emerald-500/30 text-emerald-200"
              : "bg-red-950/70 border-red-500/30 text-red-200"
          }`}
        >
          {actionMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Metrics Row */}
      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-zinc-500" />
              SQLite Posts
            </span>
            <span className="text-lg font-bold font-mono text-white">
              {report.totalPosts}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              R2 Objects
            </span>
            <span className="text-lg font-bold font-mono text-cyan-300">
              {report.totalR2Objects}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Ghost / Missing
            </span>
            <span className={`text-lg font-bold font-mono ${report.missingInR2Count > 0 ? "text-red-400" : "text-zinc-200"}`}>
              {report.missingInR2Count + report.zeroByteCount}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-white/5 flex flex-col gap-1">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <FileQuestion className="w-3.5 h-3.5 text-pink-400" />
              Untranscoded VIDs
            </span>
            <span className={`text-lg font-bold font-mono ${report.unprocessedVideosCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {report.unprocessedVideosCount}
            </span>
          </div>
        </div>
      )}

      {/* Issues / Anomalies List */}
      {report && report.issues.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold text-zinc-300">Detected Issues ({report.issues.length})</span>
            {report.orphanedR2Count > 0 && (
              <button
                type="button"
                disabled={cleaningOrphans}
                onClick={handleCleanupOrphans}
                className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 underline underline-offset-4 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete {report.orphanedR2Count} R2 Orphans</span>
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
            {report.issues.map((issue, idx) => {
              const isVideoRepair = issue.type === "video_missing_hls" && issue.postId;
              return (
                <div
                  key={`${issue.type}-${idx}`}
                  className="p-3 rounded-xl bg-zinc-950/70 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 uppercase ${
                        issue.severity === "error"
                          ? "bg-red-500/20 text-red-300 border border-red-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}
                    >
                      {issue.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-zinc-300 truncate" title={issue.message}>
                      {issue.message}
                    </span>
                  </div>

                  {isVideoRepair && (
                    <button
                      type="button"
                      disabled={repairingPostId === issue.postId}
                      onClick={() => handleRepairVideo(issue.postId!)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition disabled:opacity-50"
                    >
                      {repairingPostId === issue.postId ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Transcoding...</span>
                        </>
                      ) : (
                        <>
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Transcode & Fix</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : report ? (
        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex items-center gap-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Storage and database are completely healthy! No ghost files or missing HLS assets detected.</span>
        </div>
      ) : null}
    </div>
  );
};
