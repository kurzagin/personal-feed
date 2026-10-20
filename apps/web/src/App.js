import React, { useState, useEffect, useRef } from "react";
import { FeedCard } from "./components/FeedCard";
import { UploadModal } from "./components/UploadModal";
import { PlusCircle, RefreshCw, Compass } from "lucide-react";
export const App = () => {
    const [posts, setPosts] = useState([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const containerRef = useRef(null);
    const fetchFeed = async () => {
        try {
            const res = await fetch("/api/feed?limit=15");
            const data = await res.json();
            if (data.items) {
                setPosts(data.items);
            }
        }
        catch (err) {
            console.error("Failed to load feed", err);
        }
    };
    useEffect(() => {
        fetchFeed();
    }, []);
    // Intersection Observer to detect currently focused feed item during scroll
    const handleScroll = () => {
        if (!containerRef.current)
            return;
        const container = containerRef.current;
        const scrollPosition = container.scrollTop;
        const itemHeight = container.clientHeight;
        const newIndex = Math.round(scrollPosition / itemHeight);
        if (newIndex !== activeIndex && newIndex >= 0 && newIndex < posts.length) {
            setActiveIndex(newIndex);
        }
    };
    const handleRecordSession = async (postId, stats) => {
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
        }
        catch (err) {
            console.error("Failed to report telemetry", err);
        }
    };
    return (<div className="relative w-screen h-screen bg-black overflow-hidden flex justify-center">
      {/* Top Header Floating Controls */}
      <div className="absolute top-4 inset-x-4 max-w-md mx-auto flex items-center justify-between z-30 pointer-events-none">
        <div className="flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 pointer-events-auto">
          <Compass className="w-4 h-4 text-indigo-400 animate-spin-slow"/>
          <span className="text-xs font-semibold tracking-wide text-zinc-200">Algorithmic For You</span>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={fetchFeed} title="Refresh Feed" aria-label="Refresh Feed" className="p-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 text-white hover:bg-white/20 transition">
            <RefreshCw className="w-4 h-4"/>
          </button>
          <button onClick={() => setIsUploadOpen(true)} title="Upload Content" aria-label="Upload Content" className="p-2 bg-indigo-600/80 backdrop-blur-md rounded-full text-white hover:bg-indigo-500 transition shadow-lg">
            <PlusCircle className="w-4 h-4"/>
          </button>
        </div>
      </div>

      {/* Snap Scroll Feed Container (Max width for mobile simulation on desktop) */}
      <div ref={containerRef} onScroll={handleScroll} className="feed-container w-full max-w-md h-full overflow-y-scroll overflow-x-hidden relative">
        {posts.length === 0 ? (<div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-400">
            <p className="mb-4">No content in feed yet.</p>
            <button onClick={() => setIsUploadOpen(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">
              Upload First Media
            </button>
          </div>) : (posts.map((post, idx) => (<div key={post.id} className="w-full h-full">
              <FeedCard post={post} isActive={idx === activeIndex} onRecordSession={(stats) => handleRecordSession(post.id, stats)}/>
            </div>)))}
      </div>

      {/* Ingestion & Tagging Modal */}
      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} onSuccess={fetchFeed}/>
    </div>);
};
//# sourceMappingURL=App.js.map