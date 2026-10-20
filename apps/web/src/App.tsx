import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { FeedCard } from "./components/FeedCard";
import { UploadView, type ServerProgressSnapshot } from "./components/UploadView";
import { Home, Plus, Compass, Cpu, CheckCircle2, Ban } from "lucide-react";
import {
  loadUploadDraft,
  clearUploadDraft,
  getActiveUploadIdFromStorage,
  setActiveUploadIdInStorage,
} from "./lib/uploadDraftStore";

const ACTIVE_TAB_SESSION_KEY = "pf_active_tab";

export const App: React.FC = () => {
  const [tab, setTabState] = useState<"feed" | "upload">(() => {
    try {
      return sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY) === "upload" ? "upload" : "feed";
    } catch {
      return "feed";
    }
  });
  const [posts, setPosts] = useState<(Post & { tags: Tag[] })[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [bgUploadSnap, setBgUploadSnap] = useState<ServerProgressSnapshot | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setTab = useCallback((nextTab: "feed" | "upload") => {
    setTabState(nextTab);
    try {
      sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, nextTab);
    } catch {}
  }, []);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed?limit=20");
      const data = await res.json();
      if (data.items) {
        setPosts(data.items);
      }
    } catch (err) {
      console.error("Failed to load feed", err);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // On initial mount (including F5 refresh), check if an upload was in-flight
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadUploadDraft();
      if (cancelled) return;

      let activeServerJob: ServerProgressSnapshot | null = null;
      try {
        const res = await fetch("/api/ingest/active");
        if (res.ok) {
          const data = await res.json();
          if (data?.active) {
            activeServerJob = data.active;
          }
        }
      } catch {}

      if (cancelled) return;

      // If page was refreshed during Phase 1 (network transfer), open UploadView to auto-resume
      if (!activeServerJob && draft && draft.phase === "uploading" && draft.files.length > 0) {
        setTab("upload");
        return;
      }

      if (activeServerJob) {
        setBgUploadSnap(activeServerJob);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setTab]);

  // Poll background server job when user is on the Feed tab so they see live progress & completion
  useEffect(() => {
    if (tab !== "feed") return;

    let active = true;
    const checkBackgroundStatus = async () => {
      try {
        const storedId = getActiveUploadIdFromStorage();
        if (storedId) {
          const res = await fetch(`/api/ingest/status/${encodeURIComponent(storedId)}`);
          if (res.ok) {
            const snap: ServerProgressSnapshot = await res.json();
            if (!active) return;
            if (!snap.notFound) {
              if (snap.stage === "completed") {
                setBgUploadSnap(null);
                await clearUploadDraft();
                fetchFeed();
                setToastMessage("Background upload finished & published to your feed!");
                setTimeout(() => setToastMessage(null), 4000);
                return;
              }
              if (snap.stage === "cancelled" || snap.stage === "error") {
                setBgUploadSnap(null);
                setActiveUploadIdInStorage(null);
                return;
              }
              if (snap.stage !== "receiving") {
                setBgUploadSnap(snap);
                return;
              }
            }
          }
        }

        const activeRes = await fetch("/api/ingest/active");
        if (activeRes.ok) {
          const data = await activeRes.json();
          if (!active) return;
          setBgUploadSnap(data?.active || null);
        }
      } catch {}
    };

    checkBackgroundStatus();
    const timer = setInterval(checkBackgroundStatus, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tab, fetchFeed]);

  const handleCancelBgUpload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bgUploadSnap) return;
    const id = bgUploadSnap.uploadId;
    setBgUploadSnap(null);
    setActiveUploadIdInStorage(null);
    try {
      await fetch(`/api/ingest/cancel/${encodeURIComponent(id)}`, { method: "POST" });
    } catch {}
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollPosition = container.scrollTop;
    const itemHeight = container.clientHeight;
    const newIndex = Math.round(scrollPosition / itemHeight);
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < posts.length) {
      setActiveIndex(newIndex);
    }
  };

  const handleRecordSession = async (
    postId: string,
    stats: {
      duration: number;
      completion: number;
      favorite: boolean;
      skipped: boolean;
      dwellMs?: number;
    }
  ) => {
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          watchDurationSeconds: stats.duration,
          completionRate: stats.completion,
          interactedFavorite: stats.favorite,
          interactedSkipped: stats.skipped,
          interactedDwellMs: stats.dwellMs,
        }),
      });
    } catch (err) {
      console.error("Failed to report telemetry", err);
    }
  };

  const bgMappedPercent = bgUploadSnap
    ? Math.min(99, Math.max(25, 25 + Math.round(bgUploadSnap.overallPercent * 0.74)))
    : 0;

  return (
    <div className="fixed inset-0 w-full h-full bg-black overflow-hidden flex flex-col items-center justify-between">
      {/* Content Area */}
      <div className="relative w-full max-w-md flex-1 h-full overflow-hidden">
        {/* Floating Background Upload Pill (visible on Feed when server is processing) */}
        {tab === "feed" && bgUploadSnap && (
          <div
            onClick={() => setTab("upload")}
            className="absolute top-3 left-3 right-3 z-50 cursor-pointer p-2.5 rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-white/15 shadow-2xl flex flex-col gap-1.5 transition hover:border-white/30"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-3.5 h-3.5 text-pink-400 animate-spin shrink-0" />
                <span className="text-[11px] font-medium text-white truncate">
                  {bgUploadSnap.message || "Processing upload in background..."}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono font-semibold text-cyan-300">
                  {bgMappedPercent}%
                </span>
                <button
                  type="button"
                  onClick={handleCancelBgUpload}
                  title="Cancel upload"
                  className="p-1 rounded-lg bg-white/10 hover:bg-red-500/30 text-zinc-300 hover:text-red-200 transition"
                >
                  <Ban className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-red-500 via-pink-500 to-cyan-400 transition-all duration-300"
                style={{ width: `${bgMappedPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Completion Toast */}
        {tab === "feed" && toastMessage && (
          <div className="absolute top-3 left-3 right-3 z-50 px-3.5 py-2.5 rounded-2xl bg-emerald-950/90 backdrop-blur-2xl border border-emerald-400/30 text-xs text-emerald-100 shadow-2xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {tab === "feed" ? (
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="feed-container w-full h-full overflow-y-scroll overflow-x-hidden relative"
          >
            {posts.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500">
                <Compass className="w-8 h-8 mb-3 opacity-40 animate-pulse" />
                <p className="text-xs">No media discovered yet.</p>
              </div>
            ) : (
              posts.map((post, idx) => (
                <div key={post.id} className="w-full h-full">
                  <FeedCard
                    post={post}
                    isActive={idx === activeIndex}
                    onRecordSession={(stats) => handleRecordSession(post.id, stats)}
                  />
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="w-full h-full">
            <UploadView
              onSuccess={() => {
                setBgUploadSnap(null);
                setTab("feed");
                fetchFeed();
              }}
              onCancel={() => {
                setTab("feed");
              }}
            />
          </div>
        )}
      </div>

      {/* Fixed Solid Bottom Navigation Bar (Hidden when in upload mode for pure immersive TikTok experience) */}
      {tab === "feed" && (
        <nav
          aria-label="Bottom Navigation"
          className="fixed bottom-0 left-0 right-0 h-16 bg-black/95 border-t border-zinc-900/80 flex items-center justify-around max-w-md mx-auto z-50 px-6 backdrop-blur-md"
          style={{
            boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.8)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <button
            onClick={() => setTab("feed")}
            aria-label="Home Feed"
            className="flex flex-col items-center justify-center gap-1 text-white transition"
          >
            <Home className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Feed</span>
          </button>

          {/* Center TikTok Plus Action */}
          <button
            onClick={() => setTab("upload")}
            aria-label="Create Post"
            className="flex items-center justify-center transition-transform active:scale-95"
          >
            <div className="w-12 h-8 rounded-xl bg-gradient-to-r from-cyan-400 via-white to-pink-500 p-[1.5px] shadow-lg shadow-white/10">
              <div className="w-full h-full bg-black rounded-[10px] flex items-center justify-center">
                <Plus className="w-4 h-4 text-white stroke-[2.5]" />
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              fetchFeed();
              if (containerRef.current) {
                containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            aria-label="Discover Refresh"
            className="flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-zinc-300 transition"
          >
            <Compass className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Explore</span>
          </button>
        </nav>
      )}
    </div>
  );
};
