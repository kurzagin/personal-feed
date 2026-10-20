import React, { useState } from "react";
import type { TagCategory } from "@personal-feed/shared";
import { UploadCloud, Plus, X, Film, Image as ImageIcon } from "lucide-react";

interface UploadViewProps {
  onSuccess: () => void;
}

export const UploadView: React.FC<UploadViewProps> = ({ onSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<string>("short_video");
  const [aspectRatio, setAspectRatio] = useState<string>("0.5625");
  const [duration, setDuration] = useState<string>("");
  const [tagInput, setTagInput] = useState<string>("");
  const [tagCategory, setTagCategory] = useState<TagCategory>("general");
  const [tags, setTags] = useState<Array<{ name: string; category: TagCategory }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
    if (clean && !tags.some((t) => t.name === clean)) {
      setTags([...tags, { name: clean, category: tagCategory }]);
      setTagInput("");
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
              {file ? file.name : "Choose MP4 or AVIF file"}
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
                <option value="short_video">Short Video (≤ 3m)</option>
                <option value="long_video">Long Video (&gt; 3m / 1h+)</option>
                <option value="cosplay_set">Cosplay Gallery</option>
                <option value="anime_art">Anime Art</option>
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
                <option value="0.5625">9:16 Vertical</option>
                <option value="1.777">16:9 Horizontal</option>
                <option value="0.666">2:3 Portrait</option>
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
              placeholder="e.g. 60 (Optional)"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full mt-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
            />
          </div>

          {/* Danbooru Taxonomy Tags (Under the hood) */}
          <div>
            <label className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Danbooru Metadata (Private)
            </label>
            <div className="flex gap-2 mt-1.5">
              <input
                type="text"
                placeholder="character, artist, or tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none"
              />
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
                aria-label="Add tag"
                className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-white transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Tags Pills inside upload screen only */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {tags.map((t) => (
                  <span
                    key={t.name}
                    onClick={() => handleRemoveTag(t.name)}
                    className="cursor-pointer text-[11px] px-2.5 py-1 bg-zinc-900 border border-zinc-800 hover:border-red-500/50 rounded-full flex items-center gap-1.5 text-zinc-400"
                  >
                    <span>{t.name}</span>
                    <span className="text-[9px] text-zinc-600">{t.category}</span>
                    <X className="w-3 h-3 text-zinc-500" />
                  </span>
                ))}
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
