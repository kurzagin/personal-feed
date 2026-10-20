import React, { useState } from "react";
import { X, Upload, Plus } from "lucide-react";
export const UploadModal = ({ isOpen, onClose, onSuccess }) => {
    const [file, setFile] = useState(null);
    const [mediaType, setMediaType] = useState("short_video");
    const [aspectRatio, setAspectRatio] = useState("0.5625");
    const [duration, setDuration] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [tagCategory, setTagCategory] = useState("general");
    const [tags, setTags] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    if (!isOpen)
        return null;
    const handleAddTag = () => {
        const clean = tagInput.trim().toLowerCase().replace(/\s+/g, "_");
        if (clean && !tags.some((t) => t.name === clean)) {
            setTags([...tags, { name: clean, category: tagCategory }]);
            setTagInput("");
        }
    };
    const handleRemoveTag = (name) => {
        setTags(tags.filter((t) => t.name !== name));
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file)
            return;
        setIsUploading(true);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("mediaType", mediaType);
        formData.append("aspectRatio", aspectRatio);
        if (duration)
            formData.append("durationSeconds", duration);
        formData.append("tags", JSON.stringify(tags));
        try {
            const res = await fetch("/api/ingest", {
                method: "POST",
                body: formData,
            });
            if (res.ok) {
                onSuccess();
                onClose();
            }
            else {
                alert("Upload failed");
            }
        }
        catch (err) {
            alert("Error uploading media");
        }
        finally {
            setIsUploading(false);
        }
    };
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-400 hover:text-white">
          <X className="w-6 h-6"/>
        </button>

        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-indigo-400"/>
          Ingest & Encrypt Media
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">Select File</label>
            <input type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Format</label>
              <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white">
                <option value="short_video">Short Video (≤ 3m)</option>
                <option value="long_video">Long Video (&gt; 3m / 1h+)</option>
                <option value="cosplay_set">Cosplay Gallery</option>
                <option value="anime_art">Anime Art</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Orientation</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white">
                <option value="0.5625">9:16 Vertical (Mobile)</option>
                <option value="1.777">16:9 Horizontal (Desktop)</option>
                <option value="0.666">2:3 Portrait</option>
                <option value="1.0">1:1 Square</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">
              Duration in Seconds (Optional for videos)
            </label>
            <input type="number" placeholder="e.g. 60" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white"/>
          </div>

          {/* Danbooru Tagging */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">
              Danbooru Manual Tags
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="tag_name (e.g. raiden_shogun)" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
            }
        }} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white"/>
              <select value={tagCategory} onChange={(e) => setTagCategory(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-sm text-white">
                <option value="general">general</option>
                <option value="character">character</option>
                <option value="copyright">copyright</option>
                <option value="artist">artist</option>
                <option value="meta">meta</option>
              </select>
              <button type="button" onClick={handleAddTag} className="p-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white">
                <Plus className="w-5 h-5"/>
              </button>
            </div>

            {/* Tag Pills */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {tags.map((t) => (<span key={t.name} onClick={() => handleRemoveTag(t.name)} className="cursor-pointer text-xs px-2.5 py-1 bg-zinc-800 border border-zinc-700 hover:border-red-500 rounded-full flex items-center gap-1 text-zinc-300">
                  #{t.name} <span className="text-zinc-500 text-[10px]">({t.category})</span> &times;
                </span>))}
            </div>
          </div>

          <button type="submit" disabled={isUploading} className="w-full py-3 mt-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 font-semibold rounded-xl text-white shadow-lg disabled:opacity-50">
            {isUploading ? "Encrypting & Uploading..." : "Encrypt & Save to Cloud"}
          </button>
        </form>
      </div>
    </div>);
};
//# sourceMappingURL=UploadModal.js.map