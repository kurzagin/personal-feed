import React, { useState, useEffect, useRef } from "react";
import type { TagCategory } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  ArrowLeft,
  Sparkles,
  X,
  Plus,
  Play,
  Film,
  Image as ImageIcon,
  Check,
  RotateCcw,
  Sliders,
  Lock,
} from "lucide-react";

interface UploadViewProps {
  initialFile?: File | null;
  onSuccess: () => void;
  onCancel: () => void;
}

interface TagSuggestion {
  id: number;
  name: string;
  category: TagCategory;
  post_count?: number;
}

export const UploadView: React.FC<UploadViewProps> = ({
  initialFile,
  onSuccess,
  onCancel,
}) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string>("anime_art");
  const [aspectRatio, setAspectRatio] = useState<string>("0.5625"); // 9:16 default for TikTok style
  const [duration, setDuration] = useState<string>("");
  const [tagInput, setTagInput] = useState<string>("");
  const [tagCategory, setTagCategory] = useState<TagCategory>("character");
  const [tags, setTags] = useState<Array<{ name: string; category: TagCategory }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Danbooru Autocomplete state
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Auto trigger file picker if no initial file
  useEffect(() => {
    if (!file) {
      fileInputRef.current?.click();
    }
  }, []);

  // Sync initialFile if changed
  useEffect(() => {
    if (initialFile) {
      processFile(initialFile);
    }
  }, [initialFile]);

  const processFile = (selected: File) => {
    setFile(selected);
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);

    if (selected.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      v.onloadedmetadata = () => {
        if (v.duration) {
          const sec = Math.round(v.duration);
          setDuration(sec.toString());
          setMediaType(sec > 180 ? "long_video" : "short_video");
        }
        if (v.videoWidth && v.videoHeight) {
          const ratio = (v.videoWidth / v.videoHeight).toFixed(4);
          setAspectRatio(ratio);
        }
      };
    } else if (selected.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      img.onload = () => {
        if (img.width && img.height) {
          const ratio = (img.width / img.height).toFixed(4);
          setAspectRatio(ratio);
        }
      };
      setMediaType("anime_art");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      processFile(selected);
    }
  };

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
    }, 120);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      fileInputRef.current?.click();
      return;
    }

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

  const isVideo = file?.type.startsWith("video/") || mediaType.includes("video");

  return (
    <div className="relative w-full h-full bg-black text-white select-none overflow-hidden flex flex-col justify-between">
      {/* Hidden system file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* FULL-SCREEN IMMERSIVE MEDIA BACKGROUND (TikTok Style) */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        {previewUrl ? (
          isVideo ? (
            <div
              className="relative w-full h-full flex items-center justify-center cursor-pointer"
              onClick={toggleVideoPlayback}
            >
              <video
                ref={videoRef}
                src={previewUrl}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
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
            <img
              src={previewUrl}
              alt="Post preview"
              className="w-full h-full object-cover"
            />
          )
        ) : (
          /* Empty placeholder state if file picker cancelled */
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-zinc-950 p-6 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center mb-4 active:scale-95 transition">
              <Film className="w-7 h-7 text-white/80" />
            </div>
            <p className="text-sm font-semibold text-white">Tap to select media from gallery</p>
            <p className="text-xs text-zinc-500 mt-1">Photos & Videos supported</p>
          </div>
        )}

        {/* Ambient Top & Bottom Vignettes identical to feed view */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black via-black/85 to-transparent pointer-events-none" />
      </div>

      {/* FLOATING TOP BAR (Back button, Change file, Encryption badge) */}
      <div className="relative z-30 flex items-center justify-between px-4 pt-4">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back to feed"
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition shadow-lg"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 shadow-lg">
          <Lock className="w-3 h-3 text-cyan-400" />
          <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-300">
            E2E Encrypted
          </span>
        </div>

        {file && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change media"
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition shadow-lg"
          >
            <RotateCcw className="w-4 h-4 text-zinc-300" />
          </button>
        )}
      </div>

      {/* BOTTOM SHEET METADATA & TAGGING OVERLAY */}
      <div className="relative z-30 w-full px-4 pb-6 flex flex-col gap-3">
        {/* Danbooru Dropdown Suggestions (Floats right above input) */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="max-h-48 overflow-y-auto bg-black/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl divide-y divide-white/5 animate-in fade-in slide-in-from-bottom-2"
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

        {/* Selected Tags Display */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto no-scrollbar py-0.5">
            {tags.map((t) => {
              const colors = TagCategoryColors[t.category] || TagCategoryColors.general;
              return (
                <span
                  key={t.name}
                  onClick={() => handleRemoveTag(t.name)}
                  className={`cursor-pointer text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 border backdrop-blur-xl transition shadow-sm ${colors.bg} ${colors.text} ${colors.border} hover:opacity-80 active:scale-95`}
                >
                  <span>#{t.name}</span>
                  <X className="w-3 h-3 opacity-60 hover:opacity-100" />
                </span>
              );
            })}
          </div>
        )}

        {/* Sleek TikTok-Style Tag Input Capsule */}
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-2xl border border-white/15 rounded-2xl p-1.5 pl-3 shadow-2xl">
          <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
          <input
            type="text"
            placeholder="Add tags (e.g. frieren, anime, 4k)..."
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
                  setSelectedIndex(
                    (prev) => (prev - 1 + suggestions.length) % suggestions.length
                  );
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
            className="flex-1 bg-transparent text-xs text-white placeholder-zinc-400 focus:outline-none"
          />

          <select
            value={tagCategory}
            onChange={(e) => setTagCategory(e.target.value as TagCategory)}
            className="bg-white/10 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none"
          >
            <option value="character" className="bg-zinc-900 text-white">char</option>
            <option value="artist" className="bg-zinc-900 text-white">artist</option>
            <option value="copyright" className="bg-zinc-900 text-white">series</option>
            <option value="general" className="bg-zinc-900 text-white">general</option>
            <option value="meta" className="bg-zinc-900 text-white">meta</option>
          </select>

          <button
            type="button"
            onClick={handleAddTag}
            className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 border border-white/10 flex items-center justify-center text-white transition shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Media Format Selector Bar */}
        <div className="flex items-center justify-between gap-1 p-1 bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl">
          {[
            { id: "anime_art", label: "Art", icon: ImageIcon },
            { id: "short_video", label: "Short", icon: Film },
            { id: "long_video", label: "Long", icon: Film },
            { id: "cosplay_set", label: "Gallery", icon: ImageIcon },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = mediaType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMediaType(item.id)}
                className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium transition ${
                  isSelected
                    ? "bg-white/20 text-white font-semibold border border-white/15 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Action Button: Post (High-Contrast TikTok Post Bar) */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isUploading || !file}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-white font-semibold text-xs tracking-wider shadow-lg shadow-pink-500/20 active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Encrypting & Posting...</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>{file ? "Post to Feed" : "Select Media to Post"}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
