import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { FeedCard } from "./components/FeedCard";
import { UploadView, type ServerProgressSnapshot } from "./components/UploadView";
import { ExploreView } from "./components/ExploreView";
import { EditTagsView } from "./components/EditTagsView";
import { PreferencesView } from "./components/PreferencesView";
import { TagsManagerView } from "./components/TagsManagerView";
import {
  Home,
  Plus,
  Compass,
  Cpu,
  CheckCircle2,
  Ban,
  ChevronUp,
  ChevronDown,
  Lock,
  Sparkles,
  X,
  RefreshCw,
  SlidersHorizontal,
  Tag as TagIcon,
} from "lucide-react";
import {
  loadUploadDraft,
  clearUploadDraft,
  getActiveUploadIdFromStorage,
  setActiveUploadIdInStorage,
} from "./lib/uploadDraftStore";
import {
  type AppTab,
  parseHash,
  formatHash,
} from "./lib/router";

const ACTIVE_TAB_SESSION_KEY = "pf_active_tab";

export const App: React.FC = () => {
  const initialRoute = useMemo(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      return parseHash(window.location.hash);
    }
    try {
      const saved = sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY);
      if (saved === "upload" || saved === "explore" || saved === "preferences" || saved === "tags") {
        return { tab: saved as AppTab, tagFilter: null };
      }
    } catch {}
    return { tab: "feed" as AppTab, tagFilter: null };
  }, []);

  const [tab, setTabState] = useState<AppTab>(initialRoute.tab);
  const [posts, setPosts] = useState<(Post & { tags: Tag[] })[]>([]);
  const [explorePosts, setExplorePosts] = useState<(Post & { tags: Tag[] })[]>([]);
  const [editingPost, setEditingPost] = useState<(Post & { tags: Tag[] }) | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(initialRoute.tagFilter || null);
  const [bgUploadSnap, setBgUploadSnap] = useState<ServerProgressSnapshot | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollIndexRef = useRef<number | null>(null);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedActiveIndexRef = useRef<number | null>(null);

  const navigateTo = useCallback(
    (
      nextTab: AppTab,
      options?: {
        editPostId?: string;
        tagFilter?: string | null;
        replace?: boolean;
      }
    ) => {
      // If we're leaving feed, remember our scroll position before transition
      if (tab === "feed" && containerRef.current) {
        savedScrollTopRef.current = containerRef.current.scrollTop;
        savedActiveIndexRef.current = activeIndex;
      }

      const targetTag =
        options?.tagFilter !== undefined
          ? options.tagFilter
          : nextTab === "feed"
          ? activeTagFilter
          : null;
      const targetHash = formatHash(nextTab, options?.editPostId, targetTag);

      if (window.location.hash !== targetHash) {
        if (options?.replace) {
          window.history.replaceState(null, "", targetHash);
        } else {
          window.history.pushState(null, "", targetHash);
        }
      }

      setTabState(nextTab);
      if (options?.tagFilter !== undefined) {
        setActiveTagFilter(options.tagFilter);
      }
      if (nextTab !== "edit-tags") {
        setEditingPost(null);
        try {
          sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, nextTab);
        } catch {}
      }
    },
    [tab, activeIndex, activeTagFilter]
  );

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigateTo("feed", { replace: true });
    }
  }, [navigateTo]);

  // Synchronize hash on initial load if hash is empty
  useEffect(() => {
    if (typeof window !== "undefined" && !window.location.hash) {
      const initialHash = formatHash(initialRoute.tab, undefined, initialRoute.tagFilter);
      window.history.replaceState(null, "", initialHash);
    }
  }, [initialRoute]);

  // Handle browser back/forward buttons & URL hash changes
  useEffect(() => {
    const handleRouteSync = () => {
      const route = parseHash(window.location.hash);

      setTabState((prevTab) => {
        if (prevTab === "feed" && containerRef.current) {
          savedScrollTopRef.current = containerRef.current.scrollTop;
          savedActiveIndexRef.current = activeIndex;
        }
        return route.tab;
      });

      if (route.tagFilter !== undefined) {
        setActiveTagFilter(route.tagFilter);
      }

      if (route.tab === "edit-tags" && route.editPostId) {
        const match =
          posts.find((p) => String(p.id) === String(route.editPostId)) ||
          explorePosts.find((p) => String(p.id) === String(route.editPostId));
        if (match) {
          setEditingPost(match);
        }
      } else if (route.tab !== "edit-tags") {
        setEditingPost(null);
        try {
          sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, route.tab);
        } catch {}
      }
    };

    window.addEventListener("popstate", handleRouteSync);
    window.addEventListener("hashchange", handleRouteSync);

    return () => {
      window.removeEventListener("popstate", handleRouteSync);
      window.removeEventListener("hashchange", handleRouteSync);
    };
  }, [posts, explorePosts, activeIndex]);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed?limit=40");
      const data = await res.json();
      if (data.items) {
        setPosts(data.items);
      }
    } catch (err) {
      console.error("Failed to load feed", err);
    }
  }, []);

  const fetchExplore = useCallback(async () => {
    try {
      const res = await fetch("/api/explore");
      const data = await res.json();
      if (data.items) {
        setExplorePosts(data.items);
      }
    } catch (err) {
      console.error("Failed to load explore posts", err);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    fetchExplore();
  }, [fetchFeed, fetchExplore]);

  // If page was loaded directly on #/edit-tags/:id, resolve post once posts load
  useEffect(() => {
    if (tab === "edit-tags" && !editingPost && (posts.length > 0 || explorePosts.length > 0)) {
      const route = parseHash(window.location.hash);
      if (route.editPostId) {
        const match =
          posts.find((p) => String(p.id) === String(route.editPostId)) ||
          explorePosts.find((p) => String(p.id) === String(route.editPostId));
        if (match) {
          setEditingPost(match);
        } else {
          navigateTo("feed", { replace: true });
        }
      }
    }
  }, [tab, editingPost, posts, explorePosts, navigateTo]);

  // Filtered feed posts when user clicks a tag pill
  const displayedPosts = useMemo(() => {
    if (!activeTagFilter) return posts;
    return posts.filter((p) =>
      (p.tags || []).some(
        (t) => t.name.toLowerCase() === activeTagFilter.toLowerCase()
      )
    );
  }, [posts, activeTagFilter]);

  const scrollToPostIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      if (!containerRef.current) return;
      const clamped = Math.max(0, Math.min(displayedPosts.length - 1, index));
      const itemHeight = containerRef.current.clientHeight;
      containerRef.current.scrollTo({
        top: clamped * itemHeight,
        behavior,
      });
      setActiveIndex(clamped);
      savedScrollTopRef.current = clamped * itemHeight;
      savedActiveIndexRef.current = clamped;
    },
    [displayedPosts.length]
  );

  // Restore or set scroll position when feed is active
  useEffect(() => {
    if (tab === "feed" && containerRef.current) {
      if (pendingScrollIndexRef.current !== null) {
        const targetIdx = pendingScrollIndexRef.current;
        pendingScrollIndexRef.current = null;
        requestAnimationFrame(() => {
          scrollToPostIndex(targetIdx, "instant");
        });
      } else if (savedScrollTopRef.current !== null) {
        const savedTop = savedScrollTopRef.current;
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = savedTop;
          }
        });
      }
    }
  }, [tab, scrollToPostIndex]);

  // Desktop Keyboard Navigation for Vertical Feed Scrolling (Up/Down or J/K)
  useEffect(() => {
    if (tab !== "feed") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (activeIndex < displayedPosts.length - 1) {
          scrollToPostIndex(activeIndex + 1, "smooth");
        }
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (activeIndex > 0) {
          scrollToPostIndex(activeIndex - 1, "smooth");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, activeIndex, displayedPosts.length, scrollToPostIndex]);

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

      if (!activeServerJob && draft && draft.phase === "uploading" && draft.files.length > 0) {
        navigateTo("upload", { replace: true });
        return;
      }

      if (activeServerJob) {
        setBgUploadSnap(activeServerJob);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigateTo]);

  // Poll background server job when user is on Feed or Explore tabs
  useEffect(() => {
    if (tab === "upload" || tab === "edit-tags") return;

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
    if (tab !== "feed") return;
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollPosition = container.scrollTop;
    const itemHeight = container.clientHeight;
    if (itemHeight <= 0) return;
    const newIndex = Math.round(scrollPosition / itemHeight);
    if (newIndex !== activeIndex && newIndex >= 0 && newIndex < displayedPosts.length) {
      setActiveIndex(newIndex);
    }
    savedScrollTopRef.current = scrollPosition;
    savedActiveIndexRef.current = newIndex;
  };

  const handleRecordSession = async (
    postId: string,
    stats: {
      duration: number;
      completion: number;
      skipped: boolean;
      dwellMs?: number;
      loopCount?: number;
      carouselDepth?: number;
      audioUnmuted?: boolean;
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
          interactedSkipped: stats.skipped,
          interactedDwellMs: stats.dwellMs,
          loopCount: stats.loopCount,
          carouselDepth: stats.carouselDepth,
          audioUnmuted: stats.audioUnmuted,
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
    <div className="fixed inset-0 w-full h-full bg-black text-white overflow-hidden flex flex-col md:flex-row">
      {/* =====================================================================
          DESKTOP LEFT NAVIGATION RAIL / SIDEBAR (`hidden md:flex`)
         ===================================================================== */}
      <aside className="hidden md:flex flex-col justify-between w-20 lg:w-64 h-full bg-zinc-950 border-r border-white/10 px-3 lg:px-5 py-6 shrink-0 z-40 select-none">
        <div className="flex flex-col gap-6">
          {/* Brand Header */}
          <div
            onClick={() => {
              if (tab === "feed") {
                if (activeTagFilter) {
                  setActiveTagFilter(null);
                  navigateTo("feed", { tagFilter: null });
                }
                scrollToPostIndex(0, "smooth");
              } else {
                setActiveTagFilter(null);
                navigateTo("feed", { tagFilter: null });
              }
            }}
            className="flex items-center gap-3 px-2 cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 via-pink-500 to-purple-500 p-[1.5px] shadow-lg shadow-cyan-500/15 shrink-0">
              <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
                <Lock className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <div className="hidden lg:flex flex-col">
              <span className="text-sm font-bold tracking-tight text-white">
                Personal Feed
              </span>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                E2E Encrypted Vault
              </span>
            </div>
          </div>

          {/* Primary Nav Links */}
          <nav aria-label="Desktop Navigation" className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                if (tab === "feed") {
                  if (activeTagFilter) {
                    setActiveTagFilter(null);
                    navigateTo("feed", { tagFilter: null });
                  }
                  scrollToPostIndex(0, "smooth");
                } else {
                  navigateTo("feed");
                }
              }}
              className={`flex items-center justify-center lg:justify-start gap-3.5 px-3.5 py-3 rounded-2xl text-xs font-semibold transition cursor-pointer ${
                tab === "feed"
                  ? "bg-white text-black shadow-lg shadow-white/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Home className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">For You Feed</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo("explore")}
              className={`flex items-center justify-center lg:justify-start gap-3.5 px-3.5 py-3 rounded-2xl text-xs font-semibold transition cursor-pointer ${
                tab === "explore"
                  ? "bg-white text-black shadow-lg shadow-white/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Compass className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">Explore Grid</span>
              {posts.length > 0 && (
                <span
                  className={`hidden lg:inline ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    tab === "explore"
                      ? "bg-black/15 text-black"
                      : "bg-white/10 text-zinc-300"
                  }`}
                >
                  {posts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateTo("tags")}
              className={`flex items-center justify-center lg:justify-start gap-3.5 px-3.5 py-3 rounded-2xl text-xs font-semibold transition cursor-pointer ${
                tab === "tags"
                  ? "bg-white text-black shadow-lg shadow-white/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <TagIcon className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">Active Tags</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo("preferences")}
              className={`flex items-center justify-center lg:justify-start gap-3.5 px-3.5 py-3 rounded-2xl text-xs font-semibold transition cursor-pointer ${
                tab === "preferences"
                  ? "bg-white text-black shadow-lg shadow-white/10"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <SlidersHorizontal className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">Preferences</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo("upload")}
              className={`flex items-center justify-center lg:justify-start gap-3.5 px-3.5 py-3 rounded-2xl text-xs font-semibold transition cursor-pointer mt-2 ${
                tab === "upload"
                  ? "bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-white shadow-lg shadow-pink-500/20"
                  : "bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-white"
              }`}
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">Upload Media</span>
            </button>
          </nav>

          {/* Active Tag Filter Pill in Sidebar */}
          {activeTagFilter && (
            <div className="hidden lg:flex flex-col gap-2 p-3 rounded-2xl bg-cyan-500/10 border border-cyan-400/30">
              <div className="flex items-center justify-between text-[11px] text-cyan-300 font-medium">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Active Tag Filter</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTagFilter(null);
                    setActiveIndex(0);
                    navigateTo("feed", { tagFilter: null });
                  }}
                  className="text-cyan-300 hover:text-white"
                  title="Clear filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-xs font-mono font-semibold text-white truncate">
                #{activeTagFilter}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Section: Background Upload Status + Keyboard Shortcuts Hint */}
        <div className="flex flex-col gap-4">
          {bgUploadSnap && tab !== "upload" && (
            <div
              onClick={() => navigateTo("upload")}
              className="cursor-pointer p-3 rounded-2xl bg-zinc-900/90 border border-white/15 hover:border-cyan-400/40 transition flex flex-col gap-2 shadow-xl"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="w-4 h-4 text-pink-400 animate-spin shrink-0" />
                  <span className="hidden lg:inline text-[11px] font-medium text-white truncate">
                    {bgUploadSnap.message || "Processing..."}
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-cyan-300">
                  {bgMappedPercent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-500 via-pink-500 to-cyan-400 transition-all duration-300"
                  style={{ width: `${bgMappedPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Desktop Shortcut Cheat Sheet */}
          <div className="hidden lg:flex flex-col gap-2 p-3.5 rounded-2xl bg-zinc-900/40 border border-white/5 text-[11px] text-zinc-400">
            <div className="font-semibold text-zinc-300 mb-0.5">
              Keyboard Controls
            </div>
            <div className="flex items-center justify-between">
              <span>Prev / Next Post</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[10px]">
                ↑ / ↓
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Slide / Seek</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[10px]">
                ← / →
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Play / Pause</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[10px]">
                Space
              </kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Mute</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[10px]">
                M
              </kbd>
            </div>
          </div>
        </div>
      </aside>

      {/* =====================================================================
          MAIN STAGE VIEWPORT (Feed, Explore Grid, or Upload Studio)
         ===================================================================== */}
      <main className="relative flex-1 w-full h-full overflow-hidden flex flex-col">
        {/* Mobile Floating Background Upload Pill */}
        {tab !== "upload" && bgUploadSnap && (
          <div
            onClick={() => navigateTo("upload")}
            className="md:hidden absolute top-3 left-3 right-3 z-50 cursor-pointer p-2.5 rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-white/15 shadow-2xl flex flex-col gap-1.5 transition hover:border-white/30"
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

        {/* Active Tag Filter Floating Chip on Feed (Mobile & Tablet) */}
        {tab === "feed" && activeTagFilter && (
          <div className="lg:hidden absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-zinc-950/85 backdrop-blur-xl border border-cyan-400/40 text-xs font-medium text-cyan-300 flex items-center gap-2 shadow-2xl">
            <Sparkles className="w-3.5 h-3.5" />
            <span>#{activeTagFilter}</span>
            <button
              type="button"
              onClick={() => {
                setActiveTagFilter(null);
                setActiveIndex(0);
                navigateTo("feed", { tagFilter: null });
              }}
              className="p-0.5 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Completion Toast */}
        {tab !== "upload" && toastMessage && (
          <div className="absolute top-3 left-3 right-3 md:left-auto md:right-6 md:w-96 z-50 px-3.5 py-2.5 rounded-2xl bg-emerald-950/90 backdrop-blur-2xl border border-emerald-400/30 text-xs text-emerald-100 shadow-2xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* VIEW 1: IMMERSIVE VERTICAL FEED (Kept mounted during edit-tags to preserve scroll & video state) */}
        <div
          className={`relative w-full h-full flex-1 overflow-hidden ${
            tab === "feed" || tab === "edit-tags" ? "block" : "hidden"
          }`}
        >
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="feed-container w-full h-full overflow-y-scroll overflow-x-hidden relative"
          >
            {displayedPosts.length === 0 ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500 gap-3">
                <Compass className="w-10 h-10 opacity-40 animate-pulse text-cyan-400" />
                <p className="text-sm text-zinc-300 font-medium">
                  {activeTagFilter
                    ? `No posts tagged with #${activeTagFilter}`
                    : "No media discovered yet."}
                </p>
                {activeTagFilter ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTagFilter(null);
                      navigateTo("feed", { tagFilter: null });
                    }}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white font-medium transition"
                  >
                    Clear Tag Filter
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigateTo("upload")}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-xs text-white font-semibold shadow-lg transition"
                  >
                    Upload Your First Post
                  </button>
                )}
              </div>
            ) : (
              displayedPosts.map((post, idx) => (
                <div key={post.id} className="w-full h-full">
                  <FeedCard
                    post={post}
                    isActive={tab === "feed" && idx === activeIndex}
                    isMuted={isMuted}
                    onToggleMute={() => setIsMuted((prev) => !prev)}
                    onTagClick={(tagName) => {
                      const nextTag = activeTagFilter === tagName ? null : tagName;
                      setActiveTagFilter(nextTag);
                      setActiveIndex(0);
                      if (containerRef.current) {
                        containerRef.current.scrollTo({ top: 0 });
                      }
                      navigateTo("feed", { tagFilter: nextTag });
                    }}
                    onOpenSettings={() => {
                      setEditingPost(post);
                      navigateTo("edit-tags", { editPostId: post.id });
                    }}
                    onRecordSession={(stats) =>
                      handleRecordSession(post.id, stats)
                    }
                  />
                </div>
              ))
            )}
          </div>

          {/* DESKTOP ONLY: Floating Prev / Next Post & Refresh Controls on Right Edge */}
          {displayedPosts.length > 1 && tab === "feed" && (
            <div className="hidden md:flex flex-col items-center gap-2.5 absolute right-6 top-1/2 -translate-y-1/2 z-30">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={() => scrollToPostIndex(activeIndex - 1, "smooth")}
                title="Previous Post (↑ or K)"
                aria-label="Previous Post"
                className="w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-25 disabled:pointer-events-none shadow-xl cursor-pointer"
              >
                <ChevronUp className="w-5 h-5" />
              </button>

              <div className="px-2 py-1 rounded-full bg-zinc-900/70 border border-white/5 text-[10px] font-mono text-zinc-400">
                {activeIndex + 1}/{displayedPosts.length}
              </div>

              <button
                type="button"
                disabled={activeIndex >= displayedPosts.length - 1}
                onClick={() => scrollToPostIndex(activeIndex + 1, "smooth")}
                title="Next Post (↓ or J)"
                aria-label="Next Post"
                className="w-11 h-11 rounded-full bg-zinc-900/85 hover:bg-zinc-800 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-25 disabled:pointer-events-none shadow-xl cursor-pointer"
              >
                <ChevronDown className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  fetchFeed();
                  scrollToPostIndex(0, "smooth");
                }}
                title="Refresh Ranked Feed"
                aria-label="Refresh Ranked Feed"
                className="mt-2 w-9 h-9 rounded-full bg-zinc-900/60 hover:bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-cyan-300 active:scale-90 transition shadow-lg cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* VIEW 2: EXPLORE BENTO / MASONRY GRID */}
        {tab === "explore" && (
          <ExploreView
            posts={explorePosts}
            activeTagFilter={activeTagFilter}
            onChangeTagFilter={(tag) => {
              setActiveTagFilter(tag);
              navigateTo("explore", { tagFilter: tag });
            }}
            onRefresh={fetchExplore}
            onSelectPost={(selectedPost) => {
              // Clear filter so index matches displayedPosts
              setActiveTagFilter(null);
              // Ensure the selected post is present in feed posts
              setPosts((prevFeedPosts) => {
                const existingIdx = prevFeedPosts.findIndex((p) => p.id === selectedPost.id);
                if (existingIdx !== -1) {
                  pendingScrollIndexRef.current = existingIdx;
                  setActiveIndex(existingIdx);
                  return prevFeedPosts;
                } else {
                  // Prepend the selected post to the feed
                  const newFeed = [selectedPost, ...prevFeedPosts];
                  pendingScrollIndexRef.current = 0;
                  setActiveIndex(0);
                  return newFeed;
                }
              });
              navigateTo("feed", { tagFilter: null });
            }}
          />
        )}

        {/* VIEW 3: UPLOAD STUDIO */}
        {tab === "upload" && (
          <div className="w-full h-full flex-1 overflow-hidden">
            <UploadView
              onSuccess={() => {
                setBgUploadSnap(null);
                navigateTo("feed", { tagFilter: null });
                fetchFeed();
                fetchExplore();
              }}
              onCancel={goBack}
            />
          </div>
        )}

        {/* VIEW 4: FULL-PAGE EDIT TAGS STUDIO (RENDERED AS OVERLAY TO PRESERVE FEED DOM) */}
        {tab === "edit-tags" && editingPost && (
          <div className="absolute inset-0 z-50 w-full h-full overflow-hidden bg-black">
            <EditTagsView
              post={editingPost}
              onSave={(updatedTags) => {
                setPosts((prevPosts) =>
                  prevPosts.map((p) =>
                    p.id === editingPost.id ? { ...p, tags: updatedTags } : p
                  )
                );
                setExplorePosts((prevExplore) =>
                  prevExplore.map((p) =>
                    p.id === editingPost.id ? { ...p, tags: updatedTags } : p
                  )
                );
                setToastMessage("Tags updated successfully");
                setTimeout(() => setToastMessage(null), 3000);
                goBack();
              }}
              onCancel={goBack}
            />
          </div>
        )}

        {/* VIEW 5: PREFERENCES & ALGORITHM RESET */}
        {tab === "preferences" && (
          <div className="w-full h-full flex-1 overflow-hidden">
            <PreferencesView
              onBack={goBack}
              onAlgorithmReset={() => {
                fetchFeed();
                setActiveIndex(0);
              }}
              onOpenTagsManager={() => navigateTo("tags")}
            />
          </div>
        )}

        {/* VIEW 6: TAGS MANAGEMENT FULL PAGE */}
        {tab === "tags" && (
          <div className="w-full h-full flex-1 overflow-hidden">
            <TagsManagerView
              onBack={goBack}
              onNavigateToExplore={(tagName) => {
                navigateTo("explore", { tagFilter: tagName });
              }}
              onTagsUpdated={() => {
                fetchFeed();
                fetchExplore();
              }}
            />
          </div>
        )}
      </main>

      {/* =====================================================================
          MOBILE FIXED BOTTOM NAVIGATION BAR (`md:hidden`)
          (Hidden in Upload mode and Edit Tags mode for full-bleed mobile preview)
         ===================================================================== */}
      {tab !== "upload" && tab !== "edit-tags" && (
        <nav
          aria-label="Bottom Navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-black/95 border-t border-zinc-900/80 flex items-center justify-around z-50 px-4 backdrop-blur-md"
          style={{
            boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.8)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (tab === "feed") {
                if (activeTagFilter) {
                  setActiveTagFilter(null);
                  navigateTo("feed", { tagFilter: null });
                }
                scrollToPostIndex(0, "smooth");
              } else {
                navigateTo("feed");
              }
            }}
            aria-label="Home Feed"
            className={`flex flex-col items-center justify-center gap-1 transition ${
              tab === "feed" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Home className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Feed</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo("explore")}
            aria-label="Explore Grid"
            className={`flex flex-col items-center justify-center gap-1 transition ${
              tab === "explore" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Compass className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Explore</span>
          </button>

          {/* Center TikTok Plus Action */}
          <button
            type="button"
            onClick={() => navigateTo("upload")}
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
            type="button"
            onClick={() => navigateTo("tags")}
            aria-label="Active Tags"
            className={`flex flex-col items-center justify-center gap-1 transition ${
              tab === "tags" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <TagIcon className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Tags</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo("preferences")}
            aria-label="Preferences"
            className={`flex flex-col items-center justify-center gap-1 transition ${
              tab === "preferences" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <SlidersHorizontal className="w-5 h-5 stroke-[2]" />
            <span className="text-[10px] font-medium tracking-wider">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
};
