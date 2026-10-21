import React, { useState, useMemo } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  Search,
  RefreshCw,
  Play,
  Layers,
  Sparkles,
  Film,
  Image as ImageIcon,
  Compass,
  X,
} from "lucide-react";

interface ExploreViewProps {
  posts: (Post & { tags: Tag[] })[];
  onSelectPost: (index: number) => void;
  onRefresh: () => void;
  activeTagFilter: string | null;
  onChangeTagFilter: (tag: string | null) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  posts,
  onSelectPost,
  onRefresh,
  activeTagFilter,
  onChangeTagFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<"all" | "video" | "image">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Extract top tags across loaded posts
  const popularTags = useMemo(() => {
    const counts = new Map<string, { tag: Tag; count: number }>();
    for (const p of posts) {
      for (const t of p.tags || []) {
        const existing = counts.get(t.name);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(t.name, { tag: t, count: 1 });
        }
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 18);
  }, [posts]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts
      .map((post, originalIndex) => ({ post, originalIndex }))
      .filter(({ post }) => {
        if (mediaFilter === "video") {
          const isVid =
            post.media_type === "video" ||
            post.media_type.includes("video") ||
            post.items?.some((i) => i.media_type === "video");
          if (!isVid) return false;
        } else if (mediaFilter === "image") {
          const isImg =
            post.media_type === "image" ||
            post.media_type === "cosplay_set" ||
            post.media_type === "anime_art";
          if (!isImg) return false;
        }

        if (activeTagFilter) {
          const hasTag = (post.tags || []).some(
            (t) => t.name.toLowerCase() === activeTagFilter.toLowerCase()
          );
          if (!hasTag) return false;
        }

        if (q) {
          const matchesTag = (post.tags || []).some((t) =>
            t.name.toLowerCase().includes(q)
          );
          const matchesType = post.media_type.toLowerCase().includes(q);
          if (!matchesTag && !matchesType) return false;
        }

        return true;
      });
  }, [posts, searchQuery, mediaFilter, activeTagFilter]);

  const formatDuration = (secs: number | null) => {
    if (!secs) return null;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    await onRefresh();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  return (
    <div className="w-full h-full bg-zinc-950 text-white flex flex-col overflow-hidden">
      {/* Sticky Header with Search & Filters */}
      <div className="shrink-0 px-4 pt-4 pb-3 md:px-8 md:pt-6 md:pb-4 bg-zinc-950/90 backdrop-blur-xl border-b border-white/10 z-20 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-7xl mx-auto w-full">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                <Compass className="w-5 h-5 text-cyan-400" />
                <span>Explore Vault</span>
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-white/10 text-zinc-300">
                  {filteredEntries.length}
                </span>
              </h1>
              <p className="text-[11px] text-zinc-400 hidden sm:block mt-0.5">
                Browse your encrypted collection by tag, media type, or visual preview
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefreshClick}
              className="sm:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 active:scale-95 transition"
              aria-label="Refresh feed"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xl">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by Danbooru tag (e.g. frieren, 1girl)..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-zinc-900 border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400/50 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Media Type Segmented Control */}
            <div className="flex items-center p-1 rounded-xl bg-zinc-900 border border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setMediaFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                  mediaFilter === "all"
                    ? "bg-white text-black shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setMediaFilter("video")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition ${
                  mediaFilter === "video"
                    ? "bg-white text-black shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Film className="w-3 h-3" />
                <span className="hidden md:inline">Videos</span>
              </button>
              <button
                type="button"
                onClick={() => setMediaFilter("image")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 transition ${
                  mediaFilter === "image"
                    ? "bg-white text-black shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <ImageIcon className="w-3 h-3" />
                <span className="hidden md:inline">Images</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleRefreshClick}
              title="Re-rank & refresh feed"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-200 active:scale-95 transition shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
              <span className="hidden lg:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Popular Tag Pills Row */}
        {popularTags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-7xl mx-auto w-full pt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0 mr-1" />
            {activeTagFilter && (
              <button
                type="button"
                onClick={() => onChangeTagFilter(null)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white text-black flex items-center gap-1 shrink-0 transition"
              >
                <span>All Tags</span>
                <X className="w-3 h-3" />
              </button>
            )}
            {popularTags.map(({ tag, count }) => {
              const colors = TagCategoryColors[tag.category] || TagCategoryColors.general;
              const isSelected = activeTagFilter === tag.name;
              return (
                <button
                  key={tag.id || tag.name}
                  type="button"
                  onClick={() =>
                    onChangeTagFilter(isSelected ? null : tag.name)
                  }
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border flex items-center gap-1.5 shrink-0 transition active:scale-95 ${
                    isSelected
                      ? "bg-cyan-500 text-black border-cyan-400 font-semibold"
                      : `${colors.bg} ${colors.text} ${colors.border} hover:opacity-80`
                  }`}
                >
                  <span>#{tag.name}</span>
                  <span className="text-[9px] opacity-60 font-mono">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Responsive Masonry Grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 pb-24 md:px-8 md:py-6 md:pb-8">
        <div className="max-w-7xl mx-auto w-full">
          {filteredEntries.length === 0 ? (
            <div className="w-full py-24 flex flex-col items-center justify-center text-center text-zinc-500 gap-3">
              <Compass className="w-10 h-10 opacity-30" />
              <p className="text-sm text-zinc-400 font-medium">
                {posts.length === 0
                  ? "Your encrypted vault is empty."
                  : "No posts match your current filter."}
              </p>
              {(activeTagFilter || searchQuery || mediaFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeTagFilter(null);
                    setSearchQuery("");
                    setMediaFilter("all");
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white font-medium transition"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3 md:gap-4 space-y-3 md:space-y-4">
              {filteredEntries.map(({ post, originalIndex }) => {
                const firstItem = post.items && post.items.length > 0 ? post.items[0] : null;
                const activeId = firstItem ? firstItem.id : post.id;
                const isVideo = firstItem
                  ? firstItem.media_type === "video"
                  : post.media_type === "video" || post.media_type.includes("video");
                const itemCount = post.items?.length || post.page_count || 1;
                const duration = firstItem ? firstItem.duration_seconds : post.duration_seconds;
                const rawAspect = firstItem ? firstItem.aspect_ratio : post.aspect_ratio;
                // Clamp aspect ratio to sensible visual bounds so extreme banners or tall strips don't look distorted
                const aspectRatio = rawAspect && !isNaN(rawAspect) && rawAspect > 0
                  ? Math.min(Math.max(rawAspect, 0.45), 2.2)
                  : 3 / 4;

                // Use thumbnail-grid if available or fallback to stream for images
                const thumbUrl = isVideo
                  ? `/api/media/${activeId}/thumbnail-grid`
                  : firstItem
                  ? `/api/media/item/${firstItem.id}/stream`
                  : `/api/media/${post.id}/stream`;

                return (
                  <div
                    key={post.id}
                    onClick={() => onSelectPost(originalIndex)}
                    style={{ aspectRatio: `${aspectRatio}` }}
                    className="break-inside-avoid relative w-full rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 hover:border-cyan-400/50 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-cyan-500/10 group"
                  >
                    <img
                      src={thumbUrl}
                      alt="Post thumbnail"
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />

                    {/* Subtle Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent opacity-80 group-hover:opacity-95 transition-opacity pointer-events-none" />

                    {/* Top Right Badges (Video duration or Multi-item count) */}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 pointer-events-none">
                      {itemCount > 1 && (
                        <div className="px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15 text-[10px] font-mono text-white flex items-center gap-1">
                          <Layers className="w-3 h-3 text-cyan-400" />
                          <span>{itemCount}</span>
                        </div>
                      )}
                      {isVideo && (
                        <div className="px-2 py-0.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15 text-[10px] font-mono text-white flex items-center gap-1">
                          <Play className="w-2.5 h-2.5 fill-white text-white" />
                          {duration ? <span>{formatDuration(duration)}</span> : <span>VID</span>}
                        </div>
                      )}
                    </div>

                    {/* Bottom Tags Preview */}
                    <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1 z-10">
                      {post.tags && post.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-h-11 overflow-hidden">
                          {post.tags.slice(0, 3).map((t) => {
                            const colors =
                              TagCategoryColors[t.category] || TagCategoryColors.general;
                            return (
                              <button
                                key={t.id || t.name}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onChangeTagFilter(
                                    activeTagFilter === t.name ? null : t.name
                                  );
                                }}
                                className={`text-[10px] px-1.5 py-0.5 rounded-md border backdrop-blur-md truncate max-w-[110px] ${colors.bg} ${colors.text} ${colors.border} hover:brightness-125 transition-transform active:scale-95`}
                              >
                                #{t.name}
                              </button>
                            );
                          })}
                          {post.tags.length > 3 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/10 text-zinc-300 font-mono">
                              +{post.tags.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-zinc-400 font-mono">
                          Untagged media
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
