import React, { useState, useEffect, useRef } from "react";
import type { TagCategory } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import { UploadCloud, Plus, X, Search, Sparkles } from "lucide-react";

interface UploadViewProps {
  onSuccess: () => void;
}

interface TagSuggestion {
  id: number;
  name: string;
  category: TagCategory;
  post_count?: number;
}

export const UploadView: React.FC<UploadViewProps> = ({ onSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<string>("anime_art");
  const [aspectRatio, setAspectRatio] = useState<string>("0.75");
  const [duration, setDuration] = useState<string>("");
  const [tagInput, setTagInput] = useState<string>("");
  const [tagCategory, setTagCategory] = useState<TagCategory>("character");
  const [tags, setTags] = useState<Array<{ name: string; category: TagCategory }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Danbooru Autocomplete state
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced tag search
  useEffect(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) {
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
          setShowSuggestions((data.tags || []).length > 0);
          setSelectedIndex(-1);
        }
      } catch (err) {
        console.error("Autocomplete error:", err);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [tagInput]);

  const handleSelectSuggestion = (s: TagSuggestion) => {
    if (!tags.some((t) => t.name === s.name)) {
      setTags([...tags, { name: s.name, category: s.category }]);
    }
    setTagInput("");
    setShowSuggestions(false);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (clean && !tags.some((t) => t.name === clean)) {
      setTags([...tags, { name: clean, category: tagCategory }]);
      setTagInput("");
      setShowSuggestions(false);
    }
  };

  const handleRemoveTag = (name: string) => {
    setTags(tags.filter((t) => t.name !== name));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mediaType", mediaType);
    formData.append("aspectRatio", aspectRatio);
    if (duration) formData.append("durationSeconds", duration);
    formData.append("tags", JSON.stringify(tags));

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setFile(null);
        setTags([]);
        setDuration("");
        onSuccess();
      } else {
        alert("Upload failed");
      }
    } catch (err) {
      alert("Error uploading media");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full h-full bg-zinc-950 text-white flex flex-col justify-start items-center p-6 pt-12 overflow-y-auto">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Add Content</h1>
          <p className="text-xs text-zinc-500 mt-1">Direct client-side encrypted upload to storage</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* File Picker Zone */}
          <label className="border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition">
            <UploadCloud className="w-8 h-8 text-zinc-400 mb-2" />
            <span className="text-xs font-medium text-zinc-300">
              {file ? file.name : "Choose MP4, AVIF, JPEG, or PNG"}
            </span>
            <span className="text-[10px] text-zinc-500 mt-0.5">Encrypted locally in 2MB chunks</span>
            <input
              type="file"
              required
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>

          {/* Format & Aspect Ratio */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
                Type
              </label>
              <select
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value)}
                className="w-full mt-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-700"
              >
                <option value="anime_art">Anime Art</option>
                <option value="cosplay_set">Cosplay Gallery</option>
                <option value="short_video">Short Video (≤ 3m)</option>
                <option value="long_video">Long Video (&gt; 3m / 1h+)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
                Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full mt-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-700"
              >
                <option value="0.75">3:4 Portrait</option>
                <option value="0.5625">9:16 Vertical</option>
                <option value="1.777">16:9 Horizontal</option>
                <option value="1.0">1:1 Square</option>
              </select>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Duration (Seconds)
            </label>
            <input
              type="number"
              placeholder="e.g. 60 (Optional for images)"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full mt-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
            />
          </div>

          {/* Danbooru Taxonomy Tags with Autocomplete */}
          <div className="relative">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-purple-400" />
                Danbooru Autocomplete
              </label>
              <span className="text-[10px] text-zinc-600">57k+ indexed tags</span>
            </div>

            <div className="flex gap-2 mt-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Type character, series, artist (e.g. frieren)..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (showSuggestions && suggestions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
                          handleSelectSuggestion(suggestions[selectedIndex]);
                        } else {
                          handleSelectSuggestion(suggestions[0]);
                        }
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
                    }
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
                />
              </div>

              <select
                value={tagCategory}
                onChange={(e) => setTagCategory(e.target.value as TagCategory)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2 text-xs text-zinc-300 focus:outline-none"
              >
                <option value="character">character</option>
                <option value="artist">artist</option>
                <option value="copyright">copyright</option>
                <option value="general">general</option>
                <option value="meta">meta</option>
              </select>

              <button
                type="button"
                onClick={handleAddTag}
                aria-label="Add custom tag"
                className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-white transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Danbooru Dropdown Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl z-50 divide-y divide-zinc-800/50"
              >
                {suggestions.map((s, index) => {
                  const colors = TagCategoryColors[s.category] || TagCategoryColors.general;
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep input focus
                        handleSelectSuggestion(s);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between transition text-xs ${
                        isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                          {s.category}
                        </span>
                        <span className="font-medium text-zinc-200 truncate">{s.name}</span>
                      </div>
                      {s.post_count !== undefined && (
                        <span className="text-[10px] text-zinc-500 font-mono ml-2 shrink-0">
                          {s.post_count.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected Tags Pills with Danbooru Colors */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {tags.map((t) => {
                  const colors = TagCategoryColors[t.category] || TagCategoryColors.general;
                  return (
                    <span
                      key={t.name}
                      onClick={() => handleRemoveTag(t.name)}
                      className={`cursor-pointer text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 border transition ${colors.bg} ${colors.text} ${colors.border} hover:opacity-75`}
                    >
                      <span>{t.name}</span>
                      <span className="text-[9px] opacity-60">({t.category})</span>
                      <X className="w-3 h-3 opacity-60 hover:opacity-100" />
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isUploading || !file}
            className="w-full py-3.5 mt-2 bg-white text-black font-semibold rounded-2xl text-xs tracking-wide hover:bg-zinc-200 transition disabled:opacity-40"
          >
            {isUploading ? "Encrypting & Saving..." : "Encrypt & Upload"}
          </button>
        </form>
      </div>
    </div>
  );
};
