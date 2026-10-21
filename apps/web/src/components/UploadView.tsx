import React, { useState, useEffect, useRef, useCallback } from "react";
import type { TagCategory } from "@personal-feed/shared";
import {
  TagCategoryColors,
  TAG_CATEGORY_PREFIXES,
  parseTagInput,
  TagCategoryPrefixDef,
} from "@personal-feed/shared";
import {
  ArrowLeft,
  Sparkles,
  X,
  Play,
  Check,
  RotateCcw,
  Lock,
  ChevronLeft,
  ChevronRight,
  FolderUp,
  FilePlus,
  AlertTriangle,
  RefreshCw,
  Ban,
  Cpu,
  UploadCloud,
  ShieldCheck,
  Trash2,
  Film,
  Image as ImageIcon,
  Layers,
} from "lucide-react";
import {
  saveUploadDraft,
  updateUploadDraftStatus,
  loadUploadDraft,
  clearUploadDraft,
  getActiveUploadIdFromStorage,
  setActiveUploadIdInStorage,
} from "../lib/uploadDraftStore";

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

export type ServerUploadStage =
  | "receiving"
  | "deduplicating"
  | "transcoding"
  | "thumbnails"
  | "compressing"
  | "encrypting_uploading"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "error";

export interface ServerProgressSnapshot {
  uploadId: string;
  stage: ServerUploadStage;
  overallPercent: number;
  currentItem: number;
  totalItems: number;
  message: string;
  detail?: string;
  updatedAt: number;
  error?: string;
  postId?: string;
  notFound?: boolean;
}

type UploadPhase = "idle" | "uploading" | "processing" | "cancelling" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function generateUploadId(): string {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function getStageBadgeText(stage: ServerUploadStage): string {
  switch (stage) {
    case "receiving":
      return "PHASE 1/2 • RECEIVING PAYLOAD";
    case "deduplicating":
      return "PHASE 2/2 • INTEGRITY & DEDUP CHECK";
    case "transcoding":
      return "PHASE 2/2 • FFMPEG 480P HLS TRANSCODE";
    case "thumbnails":
      return "PHASE 2/2 • 3X3 GRID & SCRUB SPRITES";
    case "compressing":
      return "PHASE 2/2 • SHARP AVIF OPTIMIZATION";
    case "encrypting_uploading":
      return "PHASE 2/2 • AES-256-GCM & R2 STORAGE";
    case "finalizing":
      return "PHASE 2/2 • COMMITTING TO DATABASE";
    case "completed":
      return "COMPLETED • PUBLISHED";
    case "cancelled":
      return "CANCELLED";
    case "error":
      return "UPLOAD ERROR";
  }
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
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Rich upload & pipeline progress state
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [serverStage, setServerStage] = useState<ServerUploadStage>("receiving");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusDetail, setStatusDetail] = useState<string>("");
  const [isStalled, setIsStalled] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Active upload refs for clean cancellation & memory cleanup
  const objectUrlsRef = useRef<string[]>([]);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadIdRef = useRef<string | null>(null);
  const isCancelledByUserRef = useRef<boolean>(false);
  const hasFinishedRef = useRef<boolean>(false);
  const itemsRef = useRef<SelectedMedia[]>([]);
  const tagsRef = useRef<Array<{ name: string; category: TagCategory }>>([]);

  itemsRef.current = items;
  tagsRef.current = tags;

  // Danbooru Autocomplete state
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [activePrefixPrompt, setActivePrefixPrompt] = useState<TagCategoryPrefixDef | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const isBusy = phase === "uploading" || phase === "processing" || phase === "cancelling";

  const revokeCurrentUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    objectUrlsRef.current = [];
  }, []);

  const stopTrackingStreams = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
  }, []);

  const resetStallTimer = useCallback((timeoutMs: number) => {
    setIsStalled(false);
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
    }
    stallTimeoutRef.current = setTimeout(() => {
      setIsStalled(true);
    }, timeoutMs);
  }, []);

  // Cleanup local object URLs & stream listeners on unmount (DO NOT cancel server job on unmount/refresh!)
  useEffect(() => {
    return () => {
      revokeCurrentUrls();
      stopTrackingStreams();
      if (xhrRef.current) {
        try {
          xhrRef.current.abort();
        } catch {}
        xhrRef.current = null;
      }
    };
  }, [revokeCurrentUrls, stopTrackingStreams]);

  // Populate SelectedMedia state from File[] without overwriting IndexedDB if restoring
  const hydrateFilesIntoState = useCallback(
    (validFiles: File[], persistAsDraft = true): SelectedMedia[] => {
      revokeCurrentUrls();

      validFiles.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

      const newUrls: string[] = [];
      const newMediaList: SelectedMedia[] = validFiles.map((file) => {
        const url = URL.createObjectURL(file);
        newUrls.push(url);
        const isVideo =
          file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
        return {
          file,
          previewUrl: url,
          isVideo,
          aspectRatio: "0.5625",
        };
      });

      objectUrlsRef.current = newUrls;
      setItems(newMediaList);
      setCurrentIndex(0);

      if (persistAsDraft) {
        saveUploadDraft({
          phase: "draft",
          uploadId: null,
          files: validFiles,
          tags: tagsRef.current,
        });
      }

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
                const ratio =
                  v.videoWidth && v.videoHeight
                    ? (v.videoWidth / v.videoHeight).toFixed(4)
                    : "0.5625";
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

      return newMediaList;
    },
    [revokeCurrentUrls]
  );

  // Process user-selected files
  const processFiles = useCallback(
    (fileList: FileList | File[]) => {
      if (isBusy) return;
      const validFiles = Array.from(fileList).filter(
        (f) =>
          f.type.startsWith("image/") ||
          f.type.startsWith("video/") ||
          /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i.test(f.name)
      );
      if (validFiles.length === 0) return;

      setErrorMessage(null);
      setStatusBanner(null);
      hydrateFilesIntoState(validFiles, true);
    },
    [hydrateFilesIntoState, isBusy]
  );

  const handleRemoveItemAt = (indexToRemove: number) => {
    if (isBusy) return;
    const remainingFiles = items
      .filter((_, idx) => idx !== indexToRemove)
      .map((m) => m.file);
    if (remainingFiles.length === 0) {
      handleClearDraft();
    } else {
      hydrateFilesIntoState(remainingFiles, true);
      setCurrentIndex((prev) => Math.min(prev, remainingFiles.length - 1));
    }
  };

  const applyServerSnapshot = useCallback(
    (snap: ServerProgressSnapshot) => {
      if (isCancelledByUserRef.current || hasFinishedRef.current) return;
      if (snap.notFound) return;

      setServerStage(snap.stage);
      const mappedOverall = Math.min(
        99,
        Math.max(25, 25 + Math.round(snap.overallPercent * 0.74))
      );
      setProgressPercent((prev) => Math.max(prev, mappedOverall));
      setStatusMessage(snap.message || "Processing media on server...");
      if (snap.detail) {
        setStatusDetail(snap.detail);
      }
      resetStallTimer(25_000);

      if (snap.stage === "completed") {
        hasFinishedRef.current = true;
        stopTrackingStreams();
        setProgressPercent(100);
        setStatusMessage("Post encrypted and published!");
        uploadIdRef.current = null;
        clearUploadDraft().finally(() => {
          onSuccess();
        });
      } else if (snap.stage === "cancelled") {
        stopTrackingStreams();
        setPhase("idle");
        setProgressPercent(0);
        uploadIdRef.current = null;
        setActiveUploadIdInStorage(null);
        setStatusBanner("Upload cancelled — all temporary files were cleaned up.");
      } else if (snap.stage === "error") {
        stopTrackingStreams();
        setPhase("error");
        uploadIdRef.current = null;
        setActiveUploadIdInStorage(null);
        setErrorMessage(snap.error || "Upload failed during server processing.");
      }
    },
    [onSuccess, resetStallTimer, stopTrackingStreams]
  );

  const startServerProgressTracking = useCallback(
    (uploadId: string) => {
      stopTrackingStreams();
      hasFinishedRef.current = false;
      resetStallTimer(25_000);

      // 1. Real-time Server-Sent Events stream
      try {
        const es = new EventSource(`/api/ingest/progress/${encodeURIComponent(uploadId)}`);
        eventSourceRef.current = es;
        es.onmessage = (ev) => {
          try {
            const snap: ServerProgressSnapshot = JSON.parse(ev.data);
            applyServerSnapshot(snap);
          } catch {}
        };
      } catch {}

      // 2. Fallback polling in case dev proxy buffers SSE chunks
      pollIntervalRef.current = setInterval(async () => {
        if (isCancelledByUserRef.current || hasFinishedRef.current) return;
        try {
          const res = await fetch(`/api/ingest/status/${encodeURIComponent(uploadId)}`);
          if (res.ok) {
            const snap: ServerProgressSnapshot = await res.json();
            applyServerSnapshot(snap);
          }
        } catch {}
      }, 600);
    },
    [applyServerSnapshot, resetStallTimer, stopTrackingStreams]
  );

  // Trigger network upload + server pipeline for given files & tags
  const startUploadWithFiles = useCallback(
    async (
      mediaItems: SelectedMedia[],
      uploadTags: Array<{ name: string; category: TagCategory }>,
      isAutoResumed = false
    ) => {
      if (mediaItems.length === 0) return;

      const uploadId = generateUploadId();
      uploadIdRef.current = uploadId;
      isCancelledByUserRef.current = false;
      hasFinishedRef.current = false;

      setErrorMessage(null);
      setStatusBanner(
        isAutoResumed ? "Resumed interrupted upload after page refresh." : null
      );
      setIsStalled(false);
      setPhase("uploading");
      setServerStage("receiving");
      setProgressPercent(1);

      // Persist "uploading" state in IndexedDB so if user refreshes during Phase 1, we auto-resume
      saveUploadDraft({
        phase: "uploading",
        uploadId,
        files: mediaItems.map((m) => m.file),
        tags: uploadTags,
      });

      const totalSizeBytes = mediaItems.reduce((acc, it) => acc + it.file.size, 0);
      setStatusMessage(
        isAutoResumed
          ? `Resuming upload (${mediaItems.length === 1 ? mediaItems[0].file.name : `${mediaItems.length} files`})...`
          : `Uploading ${mediaItems.length === 1 ? mediaItems[0].file.name : `${mediaItems.length} files`}...`
      );
      setStatusDetail(`0 B / ${formatBytes(totalSizeBytes)}`);

      const formData = new FormData();
      formData.append("uploadId", uploadId);
      mediaItems.forEach((item) => {
        formData.append("files", item.file);
      });

      if (mediaItems.length === 1) {
        formData.append("aspectRatio", mediaItems[0].aspectRatio);
        if (mediaItems[0].duration) {
          formData.append("durationSeconds", mediaItems[0].duration);
        }
      }

      formData.append("tags", JSON.stringify(uploadTags));

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      const startTime = Date.now();

      resetStallTimer(15_000);

      xhr.upload.onprogress = (event) => {
        if (isCancelledByUserRef.current) return;
        if (event.lengthComputable && event.total > 0) {
          resetStallTimer(15_000);
          const ratio = Math.min(1, event.loaded / event.total);
          const uploadPct = Math.max(1, Math.round(ratio * 25));
          setProgressPercent(uploadPct);

          const elapsedSec = Math.max(0.2, (Date.now() - startTime) / 1000);
          const speedBps = event.loaded / elapsedSec;
          setStatusDetail(
            `${formatBytes(event.loaded)} / ${formatBytes(event.total)} • ${formatBytes(speedBps)}/s`
          );

          if (event.loaded >= event.total) {
            setPhase("processing");
            setStatusMessage("Payload received. Starting media pipeline...");
            updateUploadDraftStatus({ phase: "processing", uploadId });
            startServerProgressTracking(uploadId);
          }
        }
      };

      xhr.upload.onload = () => {
        if (isCancelledByUserRef.current) return;
        setPhase("processing");
        setProgressPercent((prev) => Math.max(prev, 25));
        updateUploadDraftStatus({ phase: "processing", uploadId });
        startServerProgressTracking(uploadId);
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (isCancelledByUserRef.current) return;

        let responseData: any = null;
        try {
          responseData = JSON.parse(xhr.responseText || "{}");
        } catch {}

        // 202 Accepted: Server received files and started detached background pipeline!
        if (xhr.status === 202 && responseData?.accepted) {
          setPhase("processing");
          setProgressPercent((prev) => Math.max(prev, 26));
          updateUploadDraftStatus({ phase: "processing", uploadId });
          if (!eventSourceRef.current && !pollIntervalRef.current) {
            startServerProgressTracking(uploadId);
          }
          return;
        }

        // 200 OK: Synchronous completion
        if (xhr.status >= 200 && xhr.status < 300 && responseData?.success) {
          hasFinishedRef.current = true;
          stopTrackingStreams();
          setProgressPercent(100);
          setStatusMessage("Post encrypted and published!");
          uploadIdRef.current = null;
          clearUploadDraft().finally(() => {
            onSuccess();
          });
          return;
        }

        // Error or Cancelled
        stopTrackingStreams();
        setActiveUploadIdInStorage(null);
        updateUploadDraftStatus({ phase: "draft", uploadId: null });

        if (xhr.status === 499 || responseData?.cancelled) {
          setPhase("idle");
          setProgressPercent(0);
          setStatusBanner("Upload cancelled — all temporary files were cleaned up.");
        } else {
          const msg =
            responseData?.error ||
            (xhr.status === 409
              ? "Duplicate post: this media already exists in your feed."
              : `Upload failed (HTTP ${xhr.status || "error"})`);
          setPhase("error");
          setErrorMessage(msg);
        }
      };

      xhr.onerror = () => {
        stopTrackingStreams();
        xhrRef.current = null;
        if (isCancelledByUserRef.current) return;
        setPhase("error");
        setErrorMessage(
          "Network connection interrupted during upload. Check your connection and retry."
        );
      };

      xhr.onabort = () => {
        xhrRef.current = null;
      };

      xhr.open("POST", "/api/ingest", true);
      xhr.setRequestHeader("X-Upload-Id", uploadId);
      xhr.setRequestHeader("X-Upload-Async", "1");
      xhr.send(formData);
    },
    [onSuccess, resetStallTimer, startServerProgressTracking, stopTrackingStreams]
  );

  // Restore draft or active upload on mount (handles F5 page refresh!)
  useEffect(() => {
    if (initialFile) {
      processFiles([initialFile]);
      return;
    }

    let cancelled = false;

    (async () => {
      const draft = await loadUploadDraft();
      if (cancelled) return;

      let restoredMedia: SelectedMedia[] = [];
      if (draft && draft.files.length > 0) {
        setTags(draft.tags || []);
        tagsRef.current = draft.tags || [];
        restoredMedia = hydrateFilesIntoState(draft.files, false);
      }

      const candidateId = draft?.uploadId || getActiveUploadIdFromStorage();
      let serverSnap: ServerProgressSnapshot | null = null;

      if (candidateId) {
        try {
          const res = await fetch(`/api/ingest/status/${encodeURIComponent(candidateId)}`);
          if (res.ok) {
            const data: ServerProgressSnapshot = await res.json();
            if (!data.notFound) {
              serverSnap = data;
            }
          }
        } catch {}
      }

      if (!serverSnap) {
        try {
          const activeRes = await fetch("/api/ingest/active");
          if (activeRes.ok) {
            const activeData = await activeRes.json();
            if (activeData?.active) {
              serverSnap = activeData.active;
            }
          }
        } catch {}
      }

      if (cancelled) return;

      if (
        serverSnap &&
        serverSnap.stage !== "receiving" &&
        serverSnap.stage !== "cancelled"
      ) {
        uploadIdRef.current = serverSnap.uploadId;
        isCancelledByUserRef.current = false;
        setPhase("processing");
        applyServerSnapshot(serverSnap);
        if (serverSnap.stage !== "completed" && serverSnap.stage !== "error") {
          startServerProgressTracking(serverSnap.uploadId);
        }
        return;
      }

      if (
        draft &&
        (draft.phase === "uploading" || draft.phase === "processing") &&
        restoredMedia.length > 0
      ) {
        startUploadWithFiles(restoredMedia, draft.tags || [], true);
        return;
      }

      if (draft && restoredMedia.length > 0) {
        setStatusBanner(
          `Restored ${restoredMedia.length} staged ${restoredMedia.length === 1 ? "file" : "files"} from your session.`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleClearDraft = async () => {
    if (isBusy) return;
    revokeCurrentUrls();
    setItems([]);
    setTags([]);
    setCurrentIndex(0);
    setErrorMessage(null);
    setStatusBanner(null);
    await clearUploadDraft();
  };

  // Debounced tag search and prefix detection
  useEffect(() => {
    const raw = tagInput.trim().toLowerCase();
    if (!raw) {
      setSuggestions([]);
      setShowSuggestions(false);
      setActivePrefixPrompt(null);
      return;
    }

    // Check if user is typing a prefix trigger like "@ch", "ch:", "@artist", etc.
    const matchedPrefix = TAG_CATEGORY_PREFIXES.find((def) => {
      // Direct alias match (e.g. user typed exactly "@ch", "ch:", "@a")
      if (def.aliases.includes(raw) || def.prefix.startsWith(raw)) {
        return true;
      }
      return false;
    });

    // If they haven't finished typing the prefix (e.g. "@ch", "@art", "ch:")
    if (matchedPrefix && raw !== matchedPrefix.prefix) {
      setActivePrefixPrompt(matchedPrefix);
    } else {
      setActivePrefixPrompt(null);
    }

    // Determine query string & category filter for tag suggestions
    const parsed = parseTagInput(raw);
    const searchTarget = parsed.name;
    const categoryFilter = parsed.explicitCategory;

    const timer = setTimeout(async () => {
      try {
        const queryParams = new URLSearchParams();
        if (searchTarget) queryParams.set("q", searchTarget);
        if (categoryFilter) queryParams.set("category", categoryFilter);

        // Fetch suggestions if there's either a search term or a locked category
        if (searchTarget || categoryFilter) {
          const res = await fetch(`/api/tags?${queryParams.toString()}`);
          if (res.ok) {
            const data = await res.json();
            setSuggestions(data.tags || []);
            setShowSuggestions((data.tags || []).length > 0 || !!matchedPrefix);
            setSelectedIndex(-1);
            return;
          }
        }
        setShowSuggestions(!!matchedPrefix);
      } catch (err) {
        console.error("Autocomplete error:", err);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [tagInput]);

  const syncTagsToDraft = (nextTags: Array<{ name: string; category: TagCategory }>) => {
    setTags(nextTags);
    tagsRef.current = nextTags;
    if (itemsRef.current.length > 0 && !isBusy) {
      updateUploadDraftStatus({
        phase: "draft",
        uploadId: null,
        tags: nextTags,
      });
    }
  };

  const handleApplyPrefix = (def: TagCategoryPrefixDef) => {
    setTagInput(def.prefix);
    setActivePrefixPrompt(null);
    if (tagInputRef.current) {
      tagInputRef.current.focus();
    }
  };

  const handleSelectSuggestion = (s: TagSuggestion) => {
    if (isBusy) return;
    if (!tags.some((t) => t.name === s.name)) {
      syncTagsToDraft([...tags, { name: s.name, category: s.category }]);
    }
    setTagInput("");
    setActivePrefixPrompt(null);
    setShowSuggestions(false);
  };

  const handleAddTag = (rawName?: string) => {
    if (isBusy) return;
    const inputVal = (rawName ?? tagInput).trim();
    if (!inputVal) return;

    // Parse any category prefix e.g. "@character:marian" or "ch:marian"
    const { name: val, explicitCategory } = parseTagInput(inputVal);
    if (!val) return;

    if (!tags.some((t) => t.name === val)) {
      const matched = suggestions.find((s) => s.name.toLowerCase() === val);
      const category: TagCategory = explicitCategory || matched?.category || "general";
      syncTagsToDraft([...tags, { name: val, category }]);
    }
    setTagInput("");
    setSuggestions([]);
    setActivePrefixPrompt(null);
    setShowSuggestions(false);
  };

  const handleRemoveTag = (name: string) => {
    if (isBusy) return;
    syncTagsToDraft(tags.filter((t) => t.name !== name));
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

  const handleCancelActiveUpload = useCallback(async () => {
    if (!isBusy) return;
    isCancelledByUserRef.current = true;
    setPhase("cancelling");
    setStatusMessage("Cancelling & cleaning up temporary files...");
    setIsStalled(false);

    stopTrackingStreams();

    if (xhrRef.current) {
      try {
        xhrRef.current.abort();
      } catch {}
      xhrRef.current = null;
    }

    const activeUploadId = uploadIdRef.current;
    uploadIdRef.current = null;
    setActiveUploadIdInStorage(null);

    updateUploadDraftStatus({ phase: "draft", uploadId: null });

    if (activeUploadId) {
      try {
        await fetch(`/api/ingest/cancel/${encodeURIComponent(activeUploadId)}`, {
          method: "POST",
        });
      } catch {}
    }

    setPhase("idle");
    setProgressPercent(0);
    setStatusMessage("");
    setStatusDetail("");
    setStatusBanner("Upload cancelled — all temporary files were cleaned up.");
  }, [isBusy, stopTrackingStreams]);

  const handleBackClick = async () => {
    if (phase === "uploading") {
      await handleCancelActiveUpload();
      return;
    }
    onCancel();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isBusy) return;

    if (items.length === 0) {
      fileInputRef.current?.click();
      return;
    }

    await startUploadWithFiles(items, tags, false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isBusy) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (isBusy) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const currentMedia = items[currentIndex];
  const isCurrentHorizontal = currentMedia
    ? parseFloat(currentMedia.aspectRatio) > 1.0
    : false;
  const totalStagedBytes = items.reduce((acc, m) => acc + m.file.size, 0);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full bg-black md:bg-zinc-950 text-white select-none overflow-hidden flex flex-col md:flex-row"
    >
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

      {/* Global Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-4 z-50 rounded-3xl bg-cyan-500/15 backdrop-blur-xl border-2 border-dashed border-cyan-400 flex flex-col items-center justify-center gap-3 pointer-events-none">
          <UploadCloud className="w-12 h-12 text-cyan-400 animate-bounce" />
          <p className="text-base font-semibold text-white">
            Drop images or videos to stage into post
          </p>
        </div>
      )}

      {/* =====================================================================
          LEFT / MAIN PANE: MEDIA PREVIEW STAGE & FILMSTRIP
          (Full-screen on Mobile, Left Studio Stage on Desktop)
         ===================================================================== */}
      <div className="relative flex-1 h-full flex flex-col justify-between overflow-hidden bg-black">
        {/* MEDIA BACKGROUND / STAGE */}
        <div className="absolute inset-0 md:relative md:flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden">
          {/* Dynamic blurred ambient glow */}
          {currentMedia && (
            <div
              className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-30 scale-125 pointer-events-none"
              style={{ backgroundImage: `url(${currentMedia.previewUrl})` }}
            />
          )}

          {currentMedia ? (
            currentMedia.isVideo ? (
              <div
                className="relative w-full h-full flex items-center justify-center cursor-pointer md:p-6"
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
                  className={`max-h-full max-w-full md:rounded-2xl md:shadow-2xl ${
                    isCurrentHorizontal
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
                  key={currentMedia.previewUrl}
                  src={currentMedia.previewUrl}
                  alt="Post preview"
                  className={`max-h-full max-w-full md:rounded-2xl md:shadow-2xl ${
                    isCurrentHorizontal
                      ? "object-contain"
                      : "h-full w-full object-cover md:w-auto md:object-contain"
                  }`}
                />
              </div>
            )
          ) : (
            /* Empty placeholder state (Drag & Drop on Desktop, Tap on Mobile) */
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 p-6 text-center gap-4">
              <div className="hidden md:flex flex-col items-center gap-2 mb-2">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-cyan-500/20 via-pink-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center shadow-2xl">
                  <UploadCloud className="w-8 h-8 text-cyan-400" />
                </div>
                <h2 className="text-lg font-bold text-white mt-2">
                  Drag & drop media here
                </h2>
                <p className="text-xs text-zinc-400 max-w-sm">
                  Supports high-res images (AVIF/WebP/PNG/JPG) and videos (MP4/WebM/MOV). Everything is automatically transcoded and encrypted with AES-256-GCM.
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-2.5 p-5 rounded-2xl bg-zinc-900/90 hover:bg-zinc-900 border border-white/10 hover:border-cyan-400/40 active:scale-95 transition shadow-xl"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                    <FilePlus className="w-6 h-6 text-cyan-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">
                    Select Files / Videos
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="flex flex-col items-center gap-2.5 p-5 rounded-2xl bg-zinc-900/90 hover:bg-zinc-900 border border-white/10 hover:border-pink-400/40 active:scale-95 transition shadow-xl"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
                    <FolderUp className="w-6 h-6 text-pink-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">
                    Select Whole Folder
                  </span>
                </button>
              </div>
              <p className="text-xs text-zinc-500 md:hidden mt-1">
                Select files or a folder to merge into one post
              </p>
            </div>
          )}

          {/* Mobile-only Top & Bottom Vignettes */}
          <div className="md:hidden absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
          <div className="md:hidden absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-black via-black/85 to-transparent pointer-events-none" />

          {/* Carousel Prev/Next Overlay Buttons */}
          {items.length > 1 && (
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 z-30 flex items-center justify-between pointer-events-none">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="pointer-events-auto w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-20 shadow-xl"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="pointer-events-auto md:hidden px-3 py-1 rounded-full bg-black/60 backdrop-blur-xl border border-white/15 text-[11px] font-mono text-zinc-200">
                {currentIndex + 1} / {items.length}
              </div>

              <button
                type="button"
                disabled={currentIndex === items.length - 1}
                onClick={() =>
                  setCurrentIndex((prev) => Math.min(items.length - 1, prev + 1))
                }
                className="pointer-events-auto w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white active:scale-90 transition disabled:opacity-20 shadow-xl"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* FLOATING TOP BAR (Visible on Mobile & Top of Left Stage on Desktop) */}
        <div className="relative md:absolute md:top-0 md:inset-x-0 z-30 flex items-center justify-between px-4 pt-4">
          <button
            type="button"
            onClick={handleBackClick}
            title={
              phase === "uploading"
                ? "Cancel network upload"
                : phase === "processing"
                ? "Return to feed (processing continues in background)"
                : "Back to feed"
            }
            aria-label="Back to feed"
            className="h-10 px-3 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-xl border border-white/15 flex items-center gap-2 text-white active:scale-95 transition shadow-lg"
          >
            <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
            <span className="hidden md:inline text-xs font-medium pr-1">
              Back to Feed
            </span>
          </button>

          {/* Change file or clear draft actions */}
          <div className="flex items-center gap-1.5">
            {items.length > 0 && !isBusy && (
              <button
                type="button"
                title="Clear staged media"
                onClick={handleClearDraft}
                aria-label="Clear staged media"
                className="w-10 h-10 rounded-full bg-black/50 hover:bg-red-500/20 backdrop-blur-xl border border-white/15 flex items-center justify-center text-zinc-300 hover:text-red-400 active:scale-90 transition shadow-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              disabled={isBusy}
              title="Change media"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change media"
              className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 backdrop-blur-xl border border-white/15 flex items-center justify-center text-white active:scale-90 transition shadow-lg disabled:opacity-30 disabled:pointer-events-none"
            >
              <RotateCcw className="w-4 h-4 text-zinc-200" />
            </button>
          </div>
        </div>

        {/* DESKTOP BOTTOM FILMSTRIP (When multiple items are staged) */}
        {items.length > 1 && (
          <div className="hidden md:flex items-center gap-2.5 px-6 py-3 bg-zinc-950/90 border-t border-white/10 overflow-x-auto custom-scrollbar z-30 shrink-0">
            <div className="text-xs font-mono text-zinc-400 pr-2 shrink-0 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>
                {currentIndex + 1} / {items.length}
              </span>
            </div>
            {items.map((item, idx) => (
              <div
                key={item.previewUrl}
                onClick={() => setCurrentIndex(idx)}
                className={`group relative w-14 h-14 rounded-xl overflow-hidden cursor-pointer border-2 shrink-0 transition ${
                  idx === currentIndex
                    ? "border-cyan-400 scale-105 shadow-lg shadow-cyan-500/20"
                    : "border-white/10 opacity-60 hover:opacity-100"
                }`}
              >
                {item.isVideo ? (
                  <video
                    src={item.previewUrl}
                    className="w-full h-full object-cover pointer-events-none"
                    muted
                  />
                ) : (
                  <img
                    src={item.previewUrl}
                    alt={`Item ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                )}
                {!isBusy && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveItemAt(idx);
                    }}
                    title="Remove item"
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 text-zinc-300 hover:text-red-400 opacity-0 group-hover:opacity-100 flex items-center justify-center transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* =====================================================================
            INSPECTOR / METADATA & PROGRESS PANEL
            (Bottom Overlay Sheet on Mobile, Dedicated Right Sidebar on Desktop)
           ===================================================================== */}
        <div className="relative z-30 w-full px-4 pb-6 md:hidden flex flex-col gap-2.5">
          {/* Mobile Mini Filmstrip */}
          {items.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
              {items.map((item, idx) => (
                <button
                  key={item.previewUrl}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`relative w-11 h-11 rounded-xl overflow-hidden border-2 shrink-0 transition ${
                    idx === currentIndex
                      ? "border-cyan-400 scale-105"
                      : "border-white/15 opacity-60"
                  }`}
                >
                  {item.isVideo ? (
                    <video
                      src={item.previewUrl}
                      className="w-full h-full object-cover pointer-events-none"
                      muted
                    />
                  ) : (
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {renderInspectorControls()}
        </div>
      </div>

      {/* DESKTOP RIGHT SIDEBAR INSPECTOR */}
      <aside className="hidden md:flex w-[380px] lg:w-[420px] h-full bg-zinc-950 border-l border-white/10 flex-col justify-between p-6 z-30 shrink-0 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Publish to Vault</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Tag your media with Danbooru categories for personalized ranking and instant filtering.
            </p>
          </div>

          {/* Staged Media Summary Card */}
          <div className="p-3.5 rounded-2xl bg-zinc-900/70 border border-white/10 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 font-medium">Staged Payload</span>
              <span className="font-mono text-cyan-300 font-semibold">
                {items.length === 0
                  ? "No files"
                  : `${items.length} ${items.length === 1 ? "item" : "items"} • ${formatBytes(totalStagedBytes)}`}
              </span>
            </div>

            {currentMedia && (
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-300">
                <div className="flex items-center gap-2 truncate pr-2">
                  {currentMedia.isVideo ? (
                    <Film className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  )}
                  <span className="truncate">{currentMedia.file.name}</span>
                </div>
                <span className="font-mono text-zinc-400 shrink-0">
                  {formatBytes(currentMedia.file.size)}
                </span>
              </div>
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

        <div className="flex flex-col gap-3 mt-6">{renderInspectorControls()}</div>
      </aside>
    </div>
  );

  function renderInspectorControls() {
    return (
      <>
        {/* Danbooru Dropdown Suggestions & Category Prefix Quick Fill */}
        {!isBusy && showSuggestions && (activePrefixPrompt || suggestions.length > 0) && (
          <div
            ref={dropdownRef}
            className="max-h-56 overflow-y-auto custom-scrollbar bg-zinc-950/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl divide-y divide-white/5"
          >
            {/* Quick prefix filler item if typing e.g. @ch, ch:, @art */}
            {activePrefixPrompt && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleApplyPrefix(activePrefixPrompt);
                }}
                className="w-full px-3.5 py-2.5 text-left flex items-center justify-between transition text-xs bg-cyan-950/40 hover:bg-cyan-900/50 border-b border-cyan-500/20 text-cyan-200"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="font-semibold text-white">
                    Set {activePrefixPrompt.label}:
                  </span>
                  <code className="text-[11px] font-mono bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded">
                    {activePrefixPrompt.prefix}
                  </code>
                </div>
                <span className="text-[10px] text-cyan-400 font-medium">Tap to fill</span>
              </button>
            )}

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

        {/* Status Banner */}
        {statusBanner && phase !== "error" && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-zinc-900/90 backdrop-blur-2xl border border-white/15 text-xs text-zinc-200 shadow-xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{statusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-zinc-400 hover:text-white p-0.5"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Error Card with Retry & Dismiss */}
        {phase === "error" && errorMessage && (
          <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl bg-red-950/85 backdrop-blur-2xl border border-red-500/40 text-xs text-red-100 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-200">Upload Interrupted</p>
                  <p className="text-[11px] text-red-200/90 mt-0.5 leading-relaxed">
                    {errorMessage}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase("idle");
                  setErrorMessage(null);
                }}
                className="text-red-300 hover:text-white p-0.5"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPhase("idle");
                  setErrorMessage(null);
                }}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium transition"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                className="px-3.5 py-1.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-[11px] font-semibold flex items-center gap-1.5 transition shadow-md"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Upload</span>
              </button>
            </div>
          </div>
        )}

        {/* Unified Tag Label Input Capsule */}
        <div
          className={`flex flex-wrap items-center gap-1.5 bg-black/65 md:bg-zinc-900 backdrop-blur-2xl border border-white/15 rounded-2xl p-2.5 shadow-2xl focus-within:border-cyan-400/50 transition ${
            isBusy ? "opacity-60 pointer-events-none" : ""
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
            ref={tagInputRef}
            type="text"
            disabled={isBusy}
            placeholder={
              tags.length === 0
                ? "Add tags (e.g. @ch or frieren)... press Enter"
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
                      (s) =>
                        s.name.toLowerCase() ===
                        tagInput.trim().toLowerCase().replace(/\s+/g, "_")
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

        {/* ACTIVE TWO-PHASE PROGRESS CARD OR POST BUTTON */}
        {isBusy ? (
          <div className="w-full p-3.5 rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-white/15 shadow-2xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider uppercase text-cyan-300">
                {phase === "uploading" ? (
                  <UploadCloud className="w-3.5 h-3.5 text-cyan-400 animate-bounce" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-pink-400 animate-spin" />
                )}
                <span>
                  {phase === "cancelling"
                    ? "CANCELLING & ROLLING BACK..."
                    : phase === "uploading"
                    ? "PHASE 1/2 • NETWORK UPLOAD"
                    : getStageBadgeText(serverStage)}
                </span>
              </div>

              <span className="text-xs font-mono font-semibold text-white">
                {progressPercent}%
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-red-500 via-pink-500 to-cyan-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-zinc-100 truncate">
                  {statusMessage || "Processing media..."}
                </span>
                {statusDetail && (
                  <span className="text-[10px] font-mono text-zinc-400 truncate mt-0.5">
                    {statusDetail}
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={phase === "cancelling"}
                onClick={handleCancelActiveUpload}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-red-500/25 border border-white/15 hover:border-red-400/40 text-[11px] font-semibold text-zinc-200 hover:text-red-200 flex items-center gap-1.5 active:scale-95 transition disabled:opacity-40"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{phase === "cancelling" ? "Stopping..." : "Cancel"}</span>
              </button>
            </div>

            {isStalled && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/30 text-[11px] text-amber-200">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    {phase === "uploading"
                      ? "Network transfer appears stalled."
                      : "Heavy video transcoding or stalled connection."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCancelActiveUpload}
                  className="underline font-semibold hover:text-white shrink-0"
                >
                  Abort
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={items.length === 0}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-red-500 via-pink-500 to-cyan-500 text-white font-semibold text-xs tracking-wider shadow-lg shadow-pink-500/20 hover:brightness-110 active:scale-[0.98] transition flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>
              {items.length === 0
                ? "Select Media or Folder to Post"
                : items.length === 1
                ? "Post to Feed"
                : `Post Set (${items.length} items)`}
            </span>
          </button>
        )}
      </>
    );
  }
};
