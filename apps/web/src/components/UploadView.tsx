import React, { useState, useEffect, useRef } from "react";
import type { TagCategory } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  ArrowLeft,
  Sparkles,
  X,
  Play,
  Film,
  Image as ImageIcon,
  Check,
  RotateCcw,
  Lock,
  ChevronLeft,
  ChevronRight,
  FolderUp,
  FilePlus,
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

interface SelectedMedia {
  file: File;
  previewUrl: string;
  isVideo: boolean;
  aspectRatio: string;
  duration?: string;
}

export const UploadView: React.FC<UploadViewProps> = ({
  initialFile,
  onSuccess,
  onCancel,
}) => {
  const [items, setItems] = useState<SelectedMedia[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [tagInput, setTagInput] = useState<string>("");
  const [tags, setTags] = useState<Array<{ name: string; category: TagCategory }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Danbooru Autocomplete state
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Process a list of files
  const processFiles = (fileList: FileList | File[]) => {
    const validFiles = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/") || f.type.startsWith("video/") ||
      /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i.test(f.name)
    );
    if (validFiles.length === 0) return;

    // Natural sort by filename so folder images stay in sequence (01.jpg, 02.jpg, etc.)
    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    const newMediaList: SelectedMedia[] = validFiles.map((file) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
      return {
        file,
        previewUrl: url,
        isVideo,
        aspectRatio: "0.5625", // default 9:16
      };
    });

    setItems(newMediaList);
    setCurrentIndex(0);

    // Read metadata for aspect ratios and video durations asynchronously
    newMediaList.forEach((media, idx) => {
      if (media.isVideo) {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = media.previewUrl;
        v.onloadedmetadata = () => {
          setItems((prev) => {
            const copy = [...prev];
            if (copy[idx]) {
              const sec = Math.round(v.duration || 0);
              const ratio = v.videoWidth && v.videoHeight ? (v.videoWidth / v.videoHeight).toFixed(4) : "0.5625";
              copy[idx] = { ...copy[idx], duration: sec.toString(), aspectRatio: ratio };
            }
            return copy;
          });
        };
      } else {
        const img = new Image();
        img.src = media.previewUrl;
        img.onload = () => {
          setItems((prev) => {
            const copy = [...prev];
            if (copy[idx] && img.width && img.height) {
              const ratio = (img.width / img.height).toFixed(4);
              copy[idx] = { ...copy[idx], aspectRatio: ratio };
            }
            return copy;
          });
        };
      }
    });
  };

  // Sync initialFile if provided
  useEffect(() => {
    if (initialFile) {
      processFiles([initialFile]);
    }
  }, [initialFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
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

  const handleAddTag = (rawName?: string) => {
    const val = (rawName ?? tagInput).trim().toLowerCase().replace(/\s+/g, "_");
    if (!val) return;

    if (!tags.some((t) => t.name === val)) {
      const matched = suggestions.find((s) => s.name.toLowerCase() === val);
      const category: TagCategory = matched?.category || "general";
      setTags((prev) => [...prev, { name: val, category }]);
    }
    setTagInput("");
    setSuggestions([]);
    setShowSuggestions(false);
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

  const currentMedia = items[currentIndex];
  const isCurrentHorizontal = currentMedia ? parseFloat(currentMedia.aspectRatio) > 1.0 : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) {
      fileInputRef.current?.click();
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    items.forEach((item) => {
      formData.append("files", item.file);
    });

    if (items.length === 1) {
      formData.append("aspectRatio", items[0].aspectRatio);
      if (items[0].duration) {
        formData.append("durationSeconds", items[0].duration);
      }
    }

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

  return (
    <div className="relative w-full h-full bg-black text-white select-none overflow-hidden flex flex-col justify-between">
      {/* Hidden system file picker (multiple files) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Hidden folder picker */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard in HTML5 browsers
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* FULL-SCREEN IMMERSIVE MEDIA BACKGROUND */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        {/* Dynamic blurred ambient glow for horizontal content */}
        {currentMedia && isCurrentHorizontal && (
          <div
            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-30 scale-125 pointer-events-none"
            style={{ backgroundImage: `url(${currentMedia.previewUrl})` }}
          />
        )}

        {currentMedia ? (
          currentMedia.isVideo ? (
            <div
              className="relative w-full h-full flex items-center justify-center cursor-pointer"
              onClick={toggleVideoPlayback}
            >
              <video
                ref={videoRef}
                key={currentMedia.previewUrl}
                src={currentMedia.previewUrl}
                autoPlay
                loop
                muted
                playsInline
                className={`max-h-full max-w-full ${
                  isCurrentHorizontal ? "w-full object-contain" : "h-full w-full object-cover"
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
            <div className="relative w-full h-full flex items-center justify-center p-2">
              <img
                key={currentMedia.previewUrl}
                src={currentMedia.previewUrl}
                alt="Post preview"
                className={`max-h-full max-w-full ${
                  isCurrentHorizontal ? "object-contain" : "h-full w-full object-cover"
                }`}
              />
            </div>
          )
        ) : (
          /* Empty placeholder state */
          <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 p-6 text-center gap-3">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900 border border-white/10 active:scale-95 transition hover:border-white/20"
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                  <FilePlus className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-semibold text-white">Files / Videos</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900 border border-white/10 active:scale-95 transition hover:border-white/20"
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                  <FolderUp className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-semibold text-white">Whole Folder</span>
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">Select files or a folder to merge into one post</p>
          </div>
        )}

        {/* Ambient Top & Bottom Vignettes */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black via-black/85 to-transparent pointer-events-none" />
      </div>

      {/* FLOATING TOP BAR */}
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

        {/* Change file or folder actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Upload whole folder"
            onClick={() => folderInputRef.current?.click()}
            aria-label="Upload folder"
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition shadow-lg"
          >
            <FolderUp className="w-4 h-4 text-zinc-300" />
          </button>
          <button
            type="button"
            title="Change media"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change media"
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition shadow-lg"
          >
            <RotateCcw className="w-4 h-4 text-zinc-300" />
          </button>
        </div>
      </div>

      {/* MULTI-MEDIA CAROUSEL INDICATOR & CONTROLS */}
      {items.length > 1 && (
        <div className="relative z-30 flex items-center justify-between px-4 my-auto pointer-events-none">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
            className="pointer-events-auto w-9 h-9 rounded-full bg-black/50 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-20 shadow-xl"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="pointer-events-auto px-3 py-1 rounded-full bg-black/60 backdrop-blur-xl border border-white/15 text-[11px] font-mono text-zinc-200">
            {currentIndex + 1} / {items.length}
          </div>

          <button
            type="button"
            disabled={currentIndex === items.length - 1}
            onClick={() => setCurrentIndex((prev) => Math.min(items.length - 1, prev + 1))}
            className="pointer-events-auto w-9 h-9 rounded-full bg-black/50 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-20 shadow-xl"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* BOTTOM SHEET METADATA & TAGGING OVERLAY */}
      <div className="relative z-30 w-full px-4 pb-6 flex flex-col gap-3">
        {/* Danbooru Dropdown Suggestions */}
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

        {/* Unified Tag Label Input Capsule */}
        <div className="flex flex-wrap items-center gap-1.5 bg-black/60 backdrop-blur-2xl border border-white/15 rounded-2xl p-2 shadow-2xl focus-within:border-white/30 transition">
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
            placeholder={tags.length === 0 ? "Add tags (e.g. uniform, frieren)... press Enter" : "Add tag..."}
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
                    const exact = suggestions.find(
                      (s) => s.name.toLowerCase() === tagInput.trim().toLowerCase().replace(/\s+/g, "_")
                    );
                    if (exact) {
                      handleSelectSuggestion(exact);
                    } else {
                      handleAddTag();
                    }
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
              } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                e.preventDefault();
                handleRemoveTag(tags[tags.length - 1].name);
              }
            }}
            className="flex-1 min-w-[120px] bg-transparent text-xs text-white placeholder-zinc-400 focus:outline-none px-1 py-0.5"
          />
        </div>

        {/* Action Button: Post (High-Contrast TikTok Post Bar) */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isUploading || items.length === 0}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-white font-semibold text-xs tracking-wider shadow-lg shadow-pink-500/20 active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Encrypting & Posting {items.length > 1 ? `(${items.length} files)` : ""}...</span>
            </>
          ) : (
            <>
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>
                {items.length === 0
                  ? "Select Media or Folder to Post"
                  : items.length === 1
                  ? "Post to Feed"
                  : `Post Set (${items.length} items)`}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
