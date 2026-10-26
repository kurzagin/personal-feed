import React, { useState, useEffect, useMemo, useCallback } from "react";
import type { TagCategory } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  Tag as TagIcon,
  Search,
  Filter,
  Check,
  RefreshCw,
  Sparkles,
  ArrowLeft,
  X,
  Edit2,
  CheckCheck,
  Trash2,
  ExternalLink,
  SlidersHorizontal,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

interface AdminTag {
  id: number;
  name: string;
  category: TagCategory;
  post_count: number;
}

const CATEGORIES: TagCategory[] = [
  "general",
  "character",
  "copyright",
  "artist",
  "meta",
];

interface TagsManagerViewProps {
  onBack: () => void;
  onNavigateToExplore: (tagName: string) => void;
  onTagsUpdated?: () => void;
}

type SortOption = "most_used" | "least_used" | "alphabetical" | "category";

export const TagsManagerView: React.FC<TagsManagerViewProps> = ({
  onBack,
  onNavigateToExplore,
  onTagsUpdated,
}) => {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("most_used");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [deletingTagId, setDeletingTagId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: "info" | "success" | "error" } | null>(null);

  const fetchActiveTags = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/tags");
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error("Failed to fetch active tags:", err);
      showToast("Failed to fetch tags", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveTags();
  }, [fetchActiveTags]);

  const showToast = (message: string, type: "info" | "success" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  // 1-Tap Category Switcher
  const handleUpdateCategory = async (tagId: number, nextCategory: TagCategory) => {
    const current = tags.find((t) => t.id === tagId);
    if (!current || current.category === nextCategory) return;

    // Optimistic update
    setTags((prev) =>
      prev.map((t) => (t.id === tagId ? { ...t, category: nextCategory } : t))
    );

    try {
      const res = await fetch(`/api/admin/tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: nextCategory }),
      });
      if (res.ok) {
        showToast(`Updated #${current.name} → ${nextCategory}`, "success");
        onTagsUpdated?.();
      } else {
        fetchActiveTags();
        showToast("Failed to update category", "error");
      }
    } catch {
      fetchActiveTags();
      showToast("Network error while updating tag", "error");
    }
  };

  // Rename Tag
  const handleSaveRename = async (tagId: number) => {
    const trimmed = editNameValue.trim().toLowerCase().replace(/\s+/g, "_");
    if (!trimmed) {
      setEditingTagId(null);
      return;
    }

    try {
      setIsUpdating(true);
      const res = await fetch(`/api/admin/tags/${tagId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.merged ? `Merged into #${trimmed}` : `Saved #${trimmed}`, "success");
        setEditingTagId(null);
        fetchActiveTags();
        onTagsUpdated?.();
      } else {
        showToast("Failed to rename tag", "error");
      }
    } catch {
      showToast("Error renaming tag", "error");
    } finally {
      setIsUpdating(false);
    }
  };

  // Delete Tag globally
  const handleDeleteTag = async (tagId: number, name: string) => {
    try {
      setIsUpdating(true);
      const res = await fetch(`/api/admin/tags/${tagId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== tagId));
        setDeletingTagId(null);
        showToast(`Deleted #${name} from all posts`, "info");
        onTagsUpdated?.();
      } else {
        showToast("Failed to delete tag", "error");
      }
    } catch {
      showToast("Error deleting tag", "error");
    } finally {
      setIsUpdating(false);
    }
  };

  // Detect character tags currently stuck as "general"
  const candidateCharacters = useMemo(() => {
    return tags.filter(
      (t) =>
        t.category === "general" &&
        (t.name.includes("(") ||
          t.name.includes("vtuber") ||
          t.name.includes("wuthering_waves") ||
          t.name.includes("zenless") ||
          t.name.includes("arknights") ||
          t.name.includes("star_rail"))
    );
  }, [tags]);

  // Bulk convert detected character candidates
  const handleBulkConvertCandidates = async () => {
    if (candidateCharacters.length === 0) return;
    try {
      setIsUpdating(true);
      const updates = candidateCharacters.map((c) => ({
        id: c.id,
        category: "character",
      }));
      const res = await fetch("/api/admin/tags/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (res.ok) {
        showToast(`Converted ${candidateCharacters.length} tags to character!`, "success");
        fetchActiveTags();
        onTagsUpdated?.();
      }
    } catch {
      showToast("Failed to convert candidates", "error");
    } finally {
      setIsUpdating(false);
    }
  };

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: tags.length,
      general: 0,
      character: 0,
      artist: 0,
      copyright: 0,
      meta: 0,
    };
    for (const t of tags) {
      if (counts[t.category] !== undefined) {
        counts[t.category]++;
      }
    }
    return counts;
  }, [tags]);

  // Filter & Sort
  const filteredAndSortedTags = useMemo(() => {
    let result = tags.filter((t) => {
      if (filterCategory !== "all" && t.category !== filterCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return t.name.toLowerCase().includes(q);
      }
      return true;
    });

    result.sort((a, b) => {
      if (sortBy === "most_used") return b.post_count - a.post_count || a.name.localeCompare(b.name);
      if (sortBy === "least_used") return a.post_count - b.post_count || a.name.localeCompare(b.name);
      if (sortBy === "alphabetical") return a.name.localeCompare(b.name);
      if (sortBy === "category") return a.category.localeCompare(b.category) || b.post_count - a.post_count;
      return 0;
    });

    return result;
  }, [tags, filterCategory, searchQuery, sortBy]);

  return (
    <div
      className="w-full h-full flex flex-col bg-black text-white overflow-y-auto overscroll-y-contain custom-scrollbar pb-32 md:pb-12"
      style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      {/* Toast Bar */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 border transition-all ${
            toast.type === "success"
              ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/40"
              : toast.type === "error"
              ? "bg-red-950/90 text-red-200 border-red-500/40"
              : "bg-cyan-950/90 text-cyan-200 border-cyan-500/40"
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* Sticky Header Bar */}
      <header className="sticky top-0 z-30 px-4 sm:px-8 py-4 border-b border-white/10 bg-zinc-950/95 backdrop-blur-xl flex flex-col gap-4 shrink-0 shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition active:scale-95"
              title="Go Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-pink-500 p-0.5">
                <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
                  <TagIcon className="w-4 h-4 text-cyan-300" />
                </div>
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Tag Management</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-normal">
                    {tags.length} active
                  </span>
                </h1>
                <p className="text-xs text-zinc-400 hidden sm:block">
                  Edit names, reassign categories, and manage all tags used across your posts
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchActiveTags()}
              disabled={loading}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setFilterCategory("all")}
            className={`px-3 py-1.5 rounded-xl border font-medium transition shrink-0 flex items-center gap-1.5 ${
              filterCategory === "all"
                ? "bg-white text-black border-white shadow-md font-semibold"
                : "bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <span>All Tags</span>
            <span className="text-[10px] opacity-75 font-mono">({categoryCounts.all})</span>
          </button>

          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat] || 0;
            const colors = TagCategoryColors[cat];
            const isSelected = filterCategory === cat;

            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1.5 rounded-xl border capitalize font-medium transition shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-white/20 font-semibold shadow-md`
                    : "bg-zinc-900 text-zinc-400 border-white/5 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                <span>{cat}</span>
                <span className="text-[10px] opacity-75 font-mono">({count})</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-8 py-5 flex flex-col gap-4">
        {/* Candidate Auto-Convert Prompt */}
        {candidateCharacters.length > 0 && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/50 via-zinc-900 to-cyan-950/50 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <div className="font-bold text-emerald-300">
                  {candidateCharacters.length} character candidates currently marked as general
                </div>
                <div className="text-zinc-400 text-[11px] mt-0.5">
                  Tags like <span className="font-mono text-white">#{candidateCharacters[0]?.name}</span> appear to be characters.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleBulkConvertCandidates}
              disabled={isUpdating}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition disabled:opacity-50 shrink-0"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Convert All to Character</span>
            </button>
          </div>
        )}

        {/* Filter and Search Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/60 p-2.5 rounded-2xl border border-white/5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by tag name (e.g. frieren, 1girl, wlop)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs bg-black/60 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400/50 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0 hidden sm:inline">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-black/60 border border-white/10 text-xs text-zinc-300 rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-400/50 cursor-pointer"
            >
              <option value="most_used">Most Used</option>
              <option value="least_used">Least Used</option>
              <option value="alphabetical">Alphabetical (A-Z)</option>
              <option value="category">Category</option>
            </select>
          </div>
        </div>

        {/* Tags Table / Cards Grid */}
        <div className="flex flex-col divide-y divide-white/5 rounded-2xl border border-white/10 bg-zinc-950/70 overflow-hidden shadow-2xl">
          {loading ? (
            <div className="py-16 text-center text-xs text-zinc-500 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Loading active tags from database...</span>
            </div>
          ) : filteredAndSortedTags.length === 0 ? (
            <div className="py-16 text-center text-xs text-zinc-400 flex flex-col items-center justify-center gap-2">
              <AlertCircle className="w-6 h-6 text-zinc-600" />
              <span>No tags match your search or filter.</span>
            </div>
          ) : (
            filteredAndSortedTags.map((t) => {
              const colors = TagCategoryColors[t.category] || TagCategoryColors.general;
              const isEditing = editingTagId === t.id;
              const isConfirmingDelete = deletingTagId === t.id;

              return (
                <div
                  key={t.id}
                  className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-white/[0.02] transition"
                >
                  {/* Left: Tag name, Rename input, Post count & Explore Link */}
                  <div className="flex items-center gap-3 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          className="px-2.5 py-1 text-xs bg-black/80 border border-cyan-400/50 rounded-lg text-white font-mono focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveRename(t.id);
                            if (e.key === "Escape") setEditingTagId(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveRename(t.id)}
                          disabled={isUpdating}
                          className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition"
                          title="Save Rename"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTagId(null)}
                          className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md font-mono font-medium border ${colors.bg} ${colors.text} ${colors.border} truncate max-w-[240px] sm:max-w-md`}
                          title={`#${t.name}`}
                        >
                          #{t.name}
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingTagId(t.id);
                            setEditNameValue(t.name);
                          }}
                          className="opacity-40 hover:opacity-100 text-zinc-400 hover:text-white p-1 transition rounded-lg hover:bg-white/5"
                          title="Rename Tag"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onNavigateToExplore(t.name)}
                          className="text-[11px] text-zinc-400 hover:text-cyan-300 font-mono flex items-center gap-1 transition px-2 py-0.5 rounded-md hover:bg-white/5"
                          title="View posts with this tag"
                        >
                          <span>{t.post_count} {t.post_count === 1 ? "post" : "posts"}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Right: 1-Tap Category Switcher Buttons & Delete */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0 shrink-0">
                    <div className="flex items-center gap-1">
                      {CATEGORIES.map((cat) => {
                        const isCurrent = t.category === cat;
                        const catColors = TagCategoryColors[cat];

                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => handleUpdateCategory(t.id, cat)}
                            className={`text-[11px] px-2.5 py-1 rounded-lg border capitalize font-medium transition active:scale-95 ${
                              isCurrent
                                ? `${catColors.bg} ${catColors.text} ${catColors.border} ring-1 ring-white/20 font-bold shadow-sm`
                                : "bg-white/5 border-white/5 text-zinc-500 hover:text-zinc-200 hover:bg-white/10"
                            }`}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>

                    <div className="h-4 w-[1px] bg-white/10 mx-1 hidden sm:block" />

                    {/* Delete Tag Button */}
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1.5 bg-red-950/60 p-1 rounded-lg border border-red-500/30">
                        <span className="text-[10px] text-red-300 pl-1 font-medium">Delete?</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteTag(t.id, t.name)}
                          className="px-2 py-0.5 rounded bg-red-500 text-black text-[10px] font-bold hover:bg-red-400"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingTagId(null)}
                          className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] hover:text-white"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingTagId(t.id)}
                        className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition"
                        title="Delete tag from all posts"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
