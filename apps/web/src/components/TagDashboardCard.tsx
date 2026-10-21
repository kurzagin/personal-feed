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
  ArrowRight,
  ChevronDown,
  Layers,
  SlidersHorizontal,
  X,
  Edit2,
  CheckCheck,
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

interface TagDashboardCardProps {
  onTagsUpdated?: () => void;
}

export const TagDashboardCard: React.FC<TagDashboardCardProps> = ({ onTagsUpdated }) => {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editNameValue, setEditNameValue] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchActiveTags = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/tags");
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags || []);
      }
    } catch (err) {
      console.error("Failed to fetch admin tags:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveTags();
  }, [fetchActiveTags]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 2500);
  };

  // Change a single tag category immediately
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
        showToast(`Updated #${current.name} to ${nextCategory}`);
        onTagsUpdated?.();
      } else {
        // Rollback
        fetchActiveTags();
      }
    } catch {
      fetchActiveTags();
    }
  };

  // Save renamed tag
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
        showToast(`Saved #${trimmed}`);
        setEditingTagId(null);
        fetchActiveTags();
        onTagsUpdated?.();
      }
    } catch {
      showToast("Failed to rename tag");
    } finally {
      setIsUpdating(false);
    }
  };

  // Auto-detect character tags that are currently stuck as "general"
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
        showToast(`Converted ${updates.length} tags to Character!`);
        fetchActiveTags();
        onTagsUpdated?.();
      }
    } catch (err) {
      showToast("Bulk conversion failed");
    } finally {
      setIsUpdating(false);
    }
  };

  // Filtered tag list
  const filteredTags = useMemo(() => {
    return tags.filter((t) => {
      if (filterCategory !== "all" && t.category !== filterCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        return t.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      }
      return true;
    });
  }, [tags, filterCategory, searchQuery]);

  const generalCount = useMemo(
    () => tags.filter((t) => t.category === "general").length,
    [tags]
  );

  return (
    <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <TagIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Tag Dashboard & Reclassifier</h3>
            <p className="text-[11px] text-zinc-400">
              Quickly reassign categories across all {tags.length} active tags
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fetchActiveTags()}
          disabled={loading}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition disabled:opacity-50"
          title="Refresh Tags"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="text-[11px] px-3 py-1.5 rounded-lg bg-cyan-950/80 border border-cyan-500/30 text-cyan-200 animate-fadeIn flex items-center justify-between">
          <span>{toast}</span>
        </div>
      )}

      {/* Smart Character Candidates Action Banner */}
      {candidateCharacters.length > 0 && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-green-950/40 to-cyan-950/40 border border-green-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-400 shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-green-300">
                {candidateCharacters.length} character candidates detected
              </span>
              <p className="text-[10px] text-zinc-400">
                Found tags like{" "}
                <span className="font-mono text-zinc-300">
                  {candidateCharacters[0]?.name}
                </span>{" "}
                currently marked as general.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleBulkConvertCandidates}
            disabled={isUpdating}
            className="w-full sm:w-auto px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-400 text-black text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50 shrink-0"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Convert All to Character</span>
          </button>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tags to reclassify..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar text-[11px]">
          <button
            type="button"
            onClick={() => setFilterCategory("all")}
            className={`px-2.5 py-1 rounded-lg border transition shrink-0 ${
              filterCategory === "all"
                ? "bg-white/20 text-white border-white/30"
                : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
            }`}
          >
            All ({tags.length})
          </button>

          <button
            type="button"
            onClick={() => setFilterCategory("general")}
            className={`px-2.5 py-1 rounded-lg border transition shrink-0 ${
              filterCategory === "general"
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
            }`}
          >
            Needs Review ({generalCount})
          </button>

          {(["character", "artist", "copyright", "meta"] as TagCategory[]).map((cat) => {
            const count = tags.filter((t) => t.category === cat).length;
            const colors = TagCategoryColors[cat];
            const isSelected = filterCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-lg border capitalize transition shrink-0 ${
                  isSelected
                    ? `${colors.bg} ${colors.text} ${colors.border}`
                    : "bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags List Table */}
      <div className="max-h-96 overflow-y-auto custom-scrollbar divide-y divide-white/5 rounded-xl border border-white/5 bg-black/30">
        {loading ? (
          <div className="py-8 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-400" />
            <span>Loading active tags...</span>
          </div>
        ) : filteredTags.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">
            No matching tags found.
          </div>
        ) : (
          filteredTags.map((t) => {
            const colors = TagCategoryColors[t.category] || TagCategoryColors.general;
            const isEditing = editingTagId === t.id;

            return (
              <div
                key={t.id}
                className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.02] transition"
              >
                {/* Tag name and post count */}
                <div className="flex items-center gap-2 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="px-2 py-0.5 text-xs bg-black/60 border border-white/20 rounded text-white focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRename(t.id);
                          if (e.key === "Escape") setEditingTagId(null);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(t.id)}
                        className="p-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTagId(null)}
                        className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs font-mono font-medium text-white truncate">
                        #{t.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTagId(t.id);
                          setEditNameValue(t.name);
                        }}
                        className="opacity-40 hover:opacity-100 text-zinc-400 p-0.5 transition"
                        title="Rename Tag"
                      >
                        <Edit2 className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {t.post_count} {t.post_count === 1 ? "post" : "posts"}
                      </span>
                    </>
                  )}
                </div>

                {/* 1-Tap Category Switcher Buttons */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0 shrink-0">
                  {CATEGORIES.map((cat) => {
                    const isCurrent = t.category === cat;
                    const catColors = TagCategoryColors[cat];

                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleUpdateCategory(t.id, cat)}
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-medium capitalize transition active:scale-95 ${
                          isCurrent
                            ? `${catColors.bg} ${catColors.text} ${catColors.border} ring-1 ring-white/20 font-semibold`
                            : "bg-white/5 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-white/10"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
