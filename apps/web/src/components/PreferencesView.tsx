import React, { useState, useEffect, useCallback } from "react";
import {
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  History,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Tag as TagIcon,
  Clock,
  ArrowLeft,
  Flame,
  Info,
} from "lucide-react";

interface TagAffinity {
  tagId: number;
  name: string;
  category: string;
  score: number;
}

interface PreferencesStats {
  sessionCount: number;
  topAffinities: TagAffinity[];
}

interface PreferencesViewProps {
  onBack: () => void;
  onAlgorithmReset: () => void;
}

export const PreferencesView: React.FC<PreferencesViewProps> = ({
  onBack,
  onAlgorithmReset,
}) => {
  const [stats, setStats] = useState<PreferencesStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/preferences/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to load preference stats", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleResetAlgorithm = async () => {
    try {
      setIsResetting(true);
      const res = await fetch("/api/preferences/reset", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowConfirmModal(false);
        setFeedback({
          type: "success",
          text: `Feed algorithm reset! Cleared ${data.clearedSessions} interaction records.`,
        });
        await fetchStats();
        onAlgorithmReset();
      } else {
        setFeedback({
          type: "error",
          text: data.message || "Failed to reset feed algorithm",
        });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: "Network error while attempting to reset algorithm.",
      });
    } finally {
      setIsResetting(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "artist":
        return "text-amber-400 bg-amber-400/10 border-amber-400/20";
      case "character":
        return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
      case "copyright":
        return "text-purple-400 bg-purple-400/10 border-purple-400/20";
      case "meta":
        return "text-pink-400 bg-pink-400/10 border-pink-400/20";
      default:
        return "text-cyan-400 bg-cyan-400/10 border-cyan-400/20";
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 text-white overflow-y-auto pb-24 md:pb-8">
      {/* Top Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8 py-4 bg-zinc-950/80 backdrop-blur-xl border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition"
            aria-label="Go Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
              Feed Preferences
            </h1>
            <p className="text-xs text-zinc-400 hidden sm:block">
              Inspect your learned taste profile and manage your personalized feed algorithm
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl w-full mx-auto p-4 sm:p-8 flex flex-col gap-6">
        {/* Toast Feedback */}
        {feedback && (
          <div
            className={`p-3.5 rounded-2xl flex items-center justify-between gap-3 text-xs border ${
              feedback.type === "success"
                ? "bg-emerald-950/80 border-emerald-400/30 text-emerald-200"
                : "bg-red-950/80 border-red-400/30 text-red-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-zinc-400 hover:text-white font-mono text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Algorithm Overview Card */}
        <div className="p-5 sm:p-6 rounded-2xl bg-zinc-900/60 border border-white/10 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>How Your Personalized Algorithm Works</span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
            The ranking system balances your personal tag affinities with time-decay and fatigue protection.
            When you favorite or loop content, its tags gain positive affinity. Skipped videos receive negative weights.
            Affinity naturally decays with a 7-day half-life to keep your feed discovering new media.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-white/5 flex flex-col gap-1">
              <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-zinc-400" />
                Logged Watch Sessions
              </span>
              <span className="text-xl font-bold font-mono text-white">
                {loading ? "..." : (stats?.sessionCount ?? 0)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-white/5 flex flex-col gap-1">
              <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                Affinity Half-life
              </span>
              <span className="text-xl font-bold font-mono text-cyan-300">
                7 Days
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-white/5 flex flex-col gap-1">
              <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-pink-400" />
                Active Tag Weights
              </span>
              <span className="text-xl font-bold font-mono text-pink-300">
                {loading ? "..." : (stats?.topAffinities.length ?? 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Learned Taste Profile (Tag Affinities) */}
        <div className="p-5 sm:p-6 rounded-2xl bg-zinc-900/60 border border-white/10 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Learned Tag Affinities</span>
            </div>
            <span className="text-[11px] text-zinc-500">
              Ordered by weight
            </span>
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              Loading affinity profile...
            </div>
          ) : stats?.topAffinities && stats.topAffinities.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {stats.topAffinities.map((aff) => {
                const isPositive = aff.score >= 0;
                return (
                  <div
                    key={aff.tagId}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border ${getCategoryColor(
                      aff.category
                    )}`}
                  >
                    <TagIcon className="w-3 h-3 opacity-70" />
                    <span className="font-medium text-white">{aff.name}</span>
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${
                        isPositive
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {isPositive ? `+${aff.score}` : aff.score}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-zinc-950/40 border border-dashed border-white/10 text-center flex flex-col items-center gap-2">
              <Info className="w-5 h-5 text-zinc-500" />
              <p className="text-xs text-zinc-400">
                No affinity data collected yet. Browse, favorite, or watch posts to tune your algorithm.
              </p>
            </div>
          )}
        </div>

        {/* Danger Zone: Reset Algorithm */}
        <div className="p-5 sm:p-6 rounded-2xl bg-red-950/20 border border-red-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-bold text-red-300 flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Reset Algorithm History
            </h2>
            <p className="text-xs text-zinc-400">
              Clears all watch sessions, likes affinity decay, and view fatigue. Your uploaded posts and tags remain untouched.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            className="sm:shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 transition active:scale-95 cursor-pointer"
          >
            Reset Algorithm
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="max-w-md w-full p-6 rounded-2xl bg-zinc-900 border border-white/15 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">Reset Feed Algorithm?</h3>
            </div>

            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              This will erase all <strong className="text-white">watch history and tag affinity scores</strong>. The feed will restart in fresh exploration mode with equal weighting for all content.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={handleResetAlgorithm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 transition flex items-center gap-2 disabled:opacity-50"
              >
                {isResetting ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <span>Yes, Reset Algorithm</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
