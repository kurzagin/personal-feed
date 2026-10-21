import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Post, Tag, TagCategory } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  ArrowLeft,
  Sparkles,
  X,
  Check,
  Play,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Loader2,
} from "lucide-react";

interface TagSuggestion {
  id: number;
  name: string;
  category: TagCategory;
  post_count?: number;
}

interface EditTagsViewProps {
  post: Post & { tags: Tag[] };
  onSave: (updatedTags: Tag[]) => void;
  onCancel: () => void;
}

export const EditTagsView: React.FC<EditTagsViewProps> = ({
  post,
  onSave,
  onCancel,
}) => {
  const [activeItemIndex, setActiveItemIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [tagInput, setTagInput] = useState<string>("");
  const [tags, setTags] = useState<Array<{ name: string; category: TagCategory }>>(() => {
    return (post.tags || []).map((t) => ({
      name: t.name,
      category: (t.category as TagCategory) || "general",
    }));
  });

  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const hasMultipleItems = Boolean(post.items && post.items.length > 1);
  const totalItemsCount = post.items?.length || 1;
  const currentItem = hasMultipleItems ? post.items![activeItemIndex] : null;

  const isVideo = currentItem
    ? currentItem.media_type === "video"
    : post.media_type === "video" || post.media_type.includes("video");

  const aspectRatio =
    (currentItem ? currentItem.aspect_ratio : post.aspect_ratio) || 0.5625;
  const isHorizontal = aspectRatio > 1.05;

  const streamFallbackUrl = currentItem
    ? `/api/media/item/${currentItem.id}/stream`
    : `/api/media/${post.id}/stream`;

  // Autocomplete search against /api/tags?q=...
  useEffect(() => {
    const q = tagInput.trim().toLowerCase();
    if (q.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.tags || []);
          setShowSuggestions(true);
          setSelectedIndex(-1);
        }
      } catch {
        // Ignore network errors during debounce
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [tagInput]);

  const handleSelectSuggestion = (s: TagSuggestion) => {
    if (isSaving) return;
    if (!tags.some((t) => t.name === s.name)) {
      setTags((prev) => [...prev, { name: s.name, category: s.category }]);
    }
    setTagInput("");
    setShowSuggestions(false);
  };

  const handleAddTag = (rawName?: string) => {
    if (isSaving) return;
    const inputVal = (rawName ?? tagInput).trim();
    if (!inputVal) return;

    // Support comma or space separated batch entry
    const entries = inputVal
      .split(/[,\s]+/)
      .map((n) => n.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "_"))
      .filter(Boolean);

    if (entries.length === 0) return;

    setTags((prev) => {
      const next = [...prev];
      for (const val of entries) {
        if (!next.some((t) => t.name === val)) {
          const matched = suggestions.find((s) => s.name.toLowerCase() === val);
          const category: TagCategory = matched?.category || "general";
          next.push({ name: val, category });
        }
      }
      return next;
    });

    setTagInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleRemoveTag = (name: string) => {
    if (isSaving) return;
    setTags((prev) => prev.filter((t) => t.name !== name));
  };

  const toggleVideoPlayback = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/posts/${post.id}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update tags");
      }

      const result = await res.json();
      setSuccessBanner("Tags saved successfully!");
      setTimeout(() => {
        onSave(result.tags);
      }, 350);
    } catch (err: any) {
      setErrorMessage(err?.message || "An error occurred while saving tags");
      setIsSaving(false);
    }
  };

  const renderInspectorControls = () => {
    return (
      <>
        {/* Danbooru Dropdown Suggestions */}
        {!isSaving && showSuggestions && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="max-h-48 overflow-y-auto custom-scrollbar bg-zinc-950/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl divide-y divide-white/5"
          >
            {suggestions.map((s, index) => {
              const colors = TagCategoryColors[s.category] || TagCategoryColors.general;
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSuggestion(s);
                  }}
                  className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between transition text-xs ${
                    isSelected ? "bg-white/20" : "hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
                    >
                      {s.category}
                    </span>
                    <span className="font-medium text-white truncate">{s.name}</span>
                  </div>
                  {s.post_count !== undefined && (
                    <span className="text-[10px] text-zinc-400 font-mono ml-2 shrink-0">
                      {s.post_count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-center justify-between gap-2 p-3.5 rounded-2xl bg-red-950/85 backdrop-blur-2xl border border-red-500/40 text-xs text-red-100 shadow-2xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-300 hover:text-white p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Success message */}
        {successBanner && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-emerald-950/80 backdrop-blur-2xl border border-emerald-500/40 text-xs text-emerald-200 shadow-xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successBanner}</span>
            </div>
          </div>
        )}

        {/* Unified Tag Label Input Capsule */}
        <div
          className={`flex flex-wrap items-center gap-1.5 bg-black/65 md:bg-zinc-900 backdrop-blur-2xl border border-white/15 rounded-2xl p-2.5 shadow-2xl focus-within:border-cyan-400/50 transition ${
            isSaving ? "opacity-60 pointer-events-none" : ""
          }`}
        >
          <Sparkles className="w-4 h-4 text-purple-400 shrink-0 ml-1 mr-0.5" />

          {tags.map((t) => {
            const colors = TagCategoryColors[t.category] || TagCategoryColors.general;
            return (
              <span
                key={t.name}
                onClick={() => handleRemoveTag(t.name)}
                className={`cursor-pointer text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 border backdrop-blur-xl transition shadow-sm ${colors.bg} ${colors.text} ${colors.border} hover:opacity-80 active:scale-95 shrink-0`}
              >
                <span>#{t.name}</span>
                <X className="w-3 h-3 opacity-60 hover:opacity-100" />
              </span>
            );
          })}

          <input
            type="text"
            disabled={isSaving}
            placeholder={
              tags.length === 0
                ? "Add tags (e.g. uniform, frieren)... press Enter"
                : "Add tag..."
            }
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (showSuggestions && suggestions.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev < suggestions.length - 1 ? prev + 1 : 0
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev > 0 ? prev - 1 : suggestions.length - 1
                  );
                  return;
                }
                if (e.key === "Enter" && selectedIndex >= 0) {
                  e.preventDefault();
                  handleSelectSuggestion(suggestions[selectedIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  setShowSuggestions(false);
                  return;
                }
              }

              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                e.preventDefault();
                handleRemoveTag(tags[tags.length - 1].name);
              }
            }}
            className="flex-1 min-w-[120px] bg-transparent text-xs text-white placeholder-zinc-400 focus:outline-none px-1 py-0.5"
          />
        </div>

        {/* Save Button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-white font-semibold text-xs tracking-wider shadow-lg shadow-pink-500/20 hover:brightness-110 active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving Changes...</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Save Tags ({tags.length})</span>
            </>
          )}
        </button>
      </>
    );
  };

  return (
    <div className="relative w-full h-full bg-black md:bg-zinc-950 text-white select-none overflow-hidden flex flex-col md:flex-row">
      {/* =====================================================================
          LEFT / MAIN PANE: MEDIA PREVIEW STAGE
          (Full-screen on Mobile, Left Studio Stage on Desktop)
         ===================================================================== */}
      <div className="relative flex-1 h-full flex flex-col justify-between overflow-hidden bg-black">
        {/* Dynamic ambient glow */}
        <div
          className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-30 scale-125 pointer-events-none"
          style={{ backgroundImage: `url(${streamFallbackUrl})` }}
        />

        {/* Media display */}
        <div className="absolute inset-0 md:relative md:flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden">
          {isVideo ? (
            <div
              className="relative w-full h-full flex items-center justify-center cursor-pointer md:p-6"
              onClick={toggleVideoPlayback}
            >
              <video
                ref={videoRef}
                key={streamFallbackUrl}
                src={streamFallbackUrl}
                autoPlay
                loop
                muted
                playsInline
                className={`max-h-full max-w-full md:rounded-2xl md:shadow-2xl ${
                  isHorizontal
                    ? "w-full object-contain"
                    : "h-full w-full object-cover md:w-auto md:object-contain"
                }`}
              />
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-xs">
                  <div className="p-4 bg-black/50 backdrop-blur-xl rounded-full border border-white/10">
                    <Play className="w-8 h-8 text-white fill-white" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center p-2 md:p-6">
              <img
                key={streamFallbackUrl}
                src={streamFallbackUrl}
                alt="Post preview"
                className={`max-h-full max-w-full md:rounded-2xl md:shadow-2xl ${
                  isHorizontal
                    ? "object-contain"
                    : "h-full w-full object-cover md:w-auto md:object-contain"
                }`}
              />
            </div>
          )}
        </div>

        {/* Multi-Item Filmstrip Navigation if post has multiple items */}
        {hasMultipleItems && (
          <div className="absolute top-16 md:top-auto md:bottom-4 inset-x-0 z-30 flex items-center justify-center gap-2 px-4 pointer-events-auto">
            <div className="flex items-center gap-2 bg-black/70 backdrop-blur-xl border border-white/15 px-3 py-1.5 rounded-full shadow-2xl">
              <button
                type="button"
                onClick={() => setActiveItemIndex((prev) => Math.max(0, prev - 1))}
                disabled={activeItemIndex === 0}
                className="text-white/80 hover:text-white disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-zinc-300">
                {activeItemIndex + 1} / {totalItemsCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  setActiveItemIndex((prev) =>
                    Math.min(totalItemsCount - 1, prev + 1)
                  )
                }
                disabled={activeItemIndex === totalItemsCount - 1}
                className="text-white/80 hover:text-white disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* MOBILE OVERLAY: Header + Bottom Tag Controls */}
        <div className="md:hidden absolute inset-0 z-30 flex flex-col justify-between p-4 pointer-events-none">
          {/* Top Bar with Back & Post details */}
          <div className="flex items-center justify-between pointer-events-auto pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="p-2.5 rounded-full bg-black/60 backdrop-blur-xl border border-white/15 text-white active:scale-95 transition shadow-lg"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-xl border border-white/15 text-xs font-semibold text-white/90">
              Edit Post Tags
            </div>

            <div className="w-9" />
          </div>

          {/* Bottom Floating Tag Editor Overlay */}
          <div className="flex flex-col gap-2.5 pointer-events-auto pb-4">
            {renderInspectorControls()}
          </div>
        </div>
      </div>

      {/* =====================================================================
          RIGHT / SIDEBAR: DESKTOP STUDIO INSPECTOR
         ===================================================================== */}
      <aside className="hidden md:flex flex-col justify-between w-96 lg:w-[420px] h-full bg-zinc-950 border-l border-white/10 p-6 z-30 shrink-0">
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition active:scale-95"
                title="Cancel & return"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">
                  Edit Tags
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Update taxonomy and metadata
                </p>
              </div>
            </div>

            {hasMultipleItems && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-[11px] font-mono text-zinc-300">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>{totalItemsCount} items</span>
              </span>
            )}
          </div>

          {/* Tag Category Legend */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            {(
              ["artist", "character", "copyright", "general", "meta"] as TagCategory[]
            ).map((cat) => {
              const c = TagCategoryColors[cat];
              return (
                <span
                  key={cat}
                  className={`px-2 py-0.5 rounded-md border capitalize ${c.bg} ${c.text} ${c.border}`}
                >
                  {cat}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          {renderInspectorControls()}
        </div>
      </aside>
    </div>
  );
};
