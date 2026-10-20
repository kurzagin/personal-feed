import React, { useState, useEffect, useRef } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { FeedCard } from "./components/FeedCard";
import { UploadView } from "./components/UploadView";
import { Home, Plus, Compass } from "lucide-react";

export const App: React.FC = () => {
  const [tab, setTab] = useState<"feed" | "upload">("feed");
  const [posts, setPosts] = useState<(Post & { tags: Tag[] })[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchFeed = async () => {
    try {
      const res = await fetch("/api/feed?limit=20");
      const data = await res.json();
      if (data.items) {
        setPosts(data.items);
      }
    } catch (err) {
      console.error("Failed to load feed", err);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

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

  return (
    <div className="fixed inset-0 w-full h-full bg-black overflow-hidden flex flex-col items-center justify-between">
      {/* Content Area */}
      <div className="relative w-full max-w-md flex-1 h-full overflow-hidden">
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
          <div className="w-full h-full pb-20">
            <UploadView
              onSuccess={() => {
                setTab("feed");
                fetchFeed();
              }}
            />
          </div>
        )}
      </div>

      {/* Fixed Solid Bottom Navigation Bar */}
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
          className={`flex flex-col items-center justify-center gap-1 transition ${
            tab === "feed" ? "text-white" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Home className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium tracking-wider">Feed</span>
        </button>

        {/* Center Minimal Plus Action */}
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
    </div>
  );
};
