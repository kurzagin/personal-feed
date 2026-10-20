import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { TagCategoryColors } from "@personal-feed/shared";
import {
  Heart,
  Volume2,
  VolumeX,
  Play,
  ChevronLeft,
  ChevronRight,
  Layers,
  Zap,
  Sparkles,
} from "lucide-react";
import Hls from "hls.js";

interface FeedCardProps {
  post: Post & { tags: Tag[] };
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onTagClick?: (tagName: string) => void;
  onRecordSession: (stats: {
    duration: number;
    completion: number;
    favorite: boolean;
    skipped: boolean;
    dwellMs?: number;
  }) => void;
}

interface HeartBurst {
  id: number;
  x: number;
  y: number;
}

export const FeedCard: React.FC<FeedCardProps> = ({
  post,
  isActive,
  isMuted,
  onToggleMute,
  onTagClick,
  onRecordSession,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const scrubberTrackRef = useRef<HTMLDivElement | null>(null);

  const [activeItemIndex, setActiveItemIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(post.duration_seconds || 0);
  const [isFastForwarding, setIsFastForwarding] = useState<boolean>(false);
  const [showAllTags, setShowAllTags] = useState<boolean>(false);
  const [heartBursts, setHeartBursts] = useState<HeartBurst[]>([]);

  // 1-second scrubbing & desktop hover preview state
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [isHoveringScrubber, setIsHoveringScrubber] = useState<boolean>(false);
  const [scrubPreviewTime, setScrubPreviewTime] = useState<number>(0);
  const [scrubPositionPct, setScrubPositionPct] = useState<number>(0);

  const startTimeRef = useRef<number>(Date.now());
  const loopCountRef = useRef<number>(0);

  // Touch & double-tap gesture refs
  const lastTapTimeRef = useRef<number>(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const didSwipeOrLongPressRef = useRef<boolean>(false);

  const hasMultipleItems = Boolean(post.items && post.items.length > 1);
  const totalItemsCount = post.items?.length || 1;
  const currentItem = hasMultipleItems ? post.items![activeItemIndex] : null;

  const isVideo = currentItem
    ? currentItem.media_type === "video"
    : post.media_type === "video" || post.media_type.includes("video");

  const aspectRatio =
    (currentItem ? currentItem.aspect_ratio : post.aspect_ratio) || 0.5625;
  const isHorizontal = aspectRatio > 1.05;

  const activeId = currentItem ? currentItem.id : post.id;
  const hasHls =
    ((currentItem ? currentItem.hls_segment_count : post.hls_segment_count) ?? 0) > 0;
  const hasScrub = Boolean(
    currentItem ? currentItem.has_scrub_sheet : post.has_scrub_sheet
  );

  const playlistUrl = `/api/media/${activeId}/playlist.m3u8`;
  const streamFallbackUrl = currentItem
    ? `/api/media/item/${currentItem.id}/stream`
    : `/api/media/${post.id}/stream`;
  const posterGridUrl = `/api/media/${activeId}/thumbnail-grid`;

  // Sync duration when switching carousel items
  useEffect(() => {
    const itemDur = currentItem
      ? currentItem.duration_seconds
      : post.duration_seconds;
    setDuration(itemDur || 0);
    setCurrentTime(0);
  }, [activeItemIndex, currentItem, post.duration_seconds]);

  // Initialize HLS / native video playback
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (hasHls && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        enableWorker: true,
        lowLatencyMode: false,
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(videoRef.current);
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (videoRef.current) {
            videoRef.current.src = streamFallbackUrl;
          }
        }
      });
    } else if (
      hasHls &&
      videoRef.current.canPlayType("application/vnd.apple.mpegurl")
    ) {
      videoRef.current.src = playlistUrl;
    } else {
      videoRef.current.src = streamFallbackUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeId, isVideo, hasHls, playlistUrl, streamFallbackUrl]);

  // Play / Pause & telemetry reporting when card enters/leaves viewport
  useEffect(() => {
    if (isActive) {
      startTimeRef.current = Date.now();
      loopCountRef.current = 0;
      if (isVideo && videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.playbackRate = 1.0;
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    } else {
      if (isVideo && videoRef.current) {
        videoRef.current.pause();
        videoRef.current.playbackRate = 1.0;
        setIsPlaying(false);
      }
      setIsFastForwarding(false);

      const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
      if (elapsedSec > 0.4) {
        const totalDuration = duration || 10;
        const completion = elapsedSec / totalDuration + loopCountRef.current;
        const skipped = elapsedSec < 2.5;

        onRecordSession({
          duration: elapsedSec,
          completion,
          favorite: isFavorited,
          skipped,
          dwellMs: !isVideo ? Date.now() - startTimeRef.current : undefined,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, activeItemIndex, isVideo]);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const triggerHeartBurst = useCallback((clientX: number, clientY: number) => {
    const id = Date.now() + Math.random();
    setHeartBursts((prev) => [...prev, { id, x: clientX, y: clientY }]);
    setIsFavorited(true);
    setTimeout(() => {
      setHeartBursts((prev) => prev.filter((b) => b.id !== id));
    }, 800);
  }, []);

  // Desktop keyboard shortcuts when this card is active
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        if (isVideo) {
          e.preventDefault();
          togglePlay();
        }
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        onToggleMute();
      } else if (e.key === "l" || e.key === "L" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        setIsFavorited((prev) => !prev);
      } else if (e.key === "ArrowLeft") {
        if (e.shiftKey && isVideo && videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = Math.max(
            0,
            videoRef.current.currentTime - 5
          );
        } else if (hasMultipleItems) {
          e.preventDefault();
          setActiveItemIndex((prev) => Math.max(0, prev - 1));
        } else if (isVideo && videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = Math.max(
            0,
            videoRef.current.currentTime - 5
          );
        }
      } else if (e.key === "ArrowRight") {
        if (e.shiftKey && isVideo && videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = Math.min(
            duration || 0,
            videoRef.current.currentTime + 5
          );
        } else if (hasMultipleItems) {
          e.preventDefault();
          setActiveItemIndex((prev) => Math.min(totalItemsCount - 1, prev + 1));
        } else if (isVideo && videoRef.current) {
          e.preventDefault();
          videoRef.current.currentTime = Math.min(
            duration || 0,
            videoRef.current.currentTime + 5
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    isVideo,
    hasMultipleItems,
    totalItemsCount,
    duration,
    togglePlay,
    onToggleMute,
  ]);

  const handleTimeUpdate = () => {
    if (videoRef.current && !isScrubbing) {
      setCurrentTime(videoRef.current.currentTime);
      if (!duration && videoRef.current.duration) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const handleEnded = () => {
    loopCountRef.current += 1;
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Touch & Mouse Gesture Handlers for Stage (Double-tap to Like, Swipe for Carousel, Hold for 2x Speed)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, input, [data-no-stage-click]")) {
      return;
    }

    didSwipeOrLongPressRef.current = false;
    touchStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (isVideo) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        if (videoRef.current && !videoRef.current.paused) {
          didSwipeOrLongPressRef.current = true;
          videoRef.current.playbackRate = 2.0;
          setIsFastForwarding(true);
        }
      }, 380);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!touchStartPosRef.current) return;
    const dx = e.clientX - touchStartPosRef.current.x;
    const dy = e.clientY - touchStartPosRef.current.y;

    // Cancel long press if user moves finger significantly
    if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isFastForwarding && videoRef.current) {
      videoRef.current.playbackRate = 1.0;
      setIsFastForwarding(false);
    }

    if ((e.target as HTMLElement).closest("button, input, [data-no-stage-click]")) {
      touchStartPosRef.current = null;
      return;
    }

    // Check horizontal swipe for multi-item carousel
    if (touchStartPosRef.current && hasMultipleItems) {
      const dx = e.clientX - touchStartPosRef.current.x;
      const dy = e.clientY - touchStartPosRef.current.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        didSwipeOrLongPressRef.current = true;
        if (dx < 0 && activeItemIndex < totalItemsCount - 1) {
          setActiveItemIndex((prev) => prev + 1);
        } else if (dx > 0 && activeItemIndex > 0) {
          setActiveItemIndex((prev) => prev - 1);
        }
        touchStartPosRef.current = null;
        return;
      }
    }

    touchStartPosRef.current = null;
    if (didSwipeOrLongPressRef.current) return;

    // Distinguish Single Tap (Play/Pause) vs Double Tap (Heart Burst Like)
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    if (now - lastTapTimeRef.current < 260) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      triggerHeartBurst(relX, relY);
      lastTapTimeRef.current = 0;
    } else {
      lastTapTimeRef.current = now;
      if (isVideo) {
        singleTapTimerRef.current = setTimeout(() => {
          togglePlay();
          singleTapTimerRef.current = null;
        }, 230);
      }
    }
  };

  // Desktop mouse hover on scrubber bar for instant 1-second frame preview
  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberTrackRef.current || !duration) return;
    const rect = scrubberTrackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrubPositionPct(pct);
    setScrubPreviewTime(pct * duration);
  };

  const tags = post.tags || [];
  const displayedTags = showAllTags ? tags : tags.slice(0, 5);

  return (
    <div className="feed-item relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none md:py-4 md:px-6 lg:px-10">
      {/* Ambient background glow for desktop stage & horizontal media */}
      <div
        className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-25 scale-125 pointer-events-none transition-all duration-700"
        style={{
          backgroundImage: `url(${isVideo ? posterGridUrl : streamFallbackUrl})`,
        }}
      />

      {/* Layout Wrapper: Full-bleed on Mobile, Theater Stage + Action Dock on Desktop */}
      <div className="relative z-10 w-full h-full flex items-center justify-center md:gap-5 max-w-6xl mx-auto">
        {/* MEDIA STAGE CARD */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            // On desktop, size horizontal content wide and vertical content like a sleek theater screen
            aspectRatio:
              typeof window !== "undefined" && window.innerWidth >= 768
                ? isHorizontal
                  ? `${Math.min(1.78, Math.max(1.2, aspectRatio))}`
                  : "9 / 16"
                : undefined,
          }}
          className={`relative w-full h-full md:h-[calc(100dvh-2.25rem)] md:w-auto ${
            isHorizontal ? "md:max-w-[calc(100vw-16rem)]" : "md:max-w-[520px]"
          } bg-zinc-950 md:rounded-3xl md:border md:border-white/15 md:shadow-[0_24px_80px_rgba(0,0,0,0.9)] overflow-hidden flex items-center justify-center cursor-pointer`}
        >
          {/* Inner blurred fill for horizontal media on mobile */}
          {isHorizontal && (
            <div
              className="absolute inset-0 bg-cover bg-center filter blur-2xl opacity-30 scale-110 pointer-events-none"
              style={{
                backgroundImage: `url(${isVideo ? posterGridUrl : streamFallbackUrl})`,
              }}
            />
          )}

          {/* Main Video or Image Element */}
          {isVideo ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <video
                ref={videoRef}
                key={activeId}
                poster={hasHls ? posterGridUrl : undefined}
                playsInline
                loop={false}
                muted={isMuted}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                className={`max-h-full max-w-full transition-all ${
                  isHorizontal
                    ? "w-full object-contain"
                    : "h-full w-full object-cover"
                }`}
              />

              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                  <div className="p-4 rounded-full bg-black/50 backdrop-blur-xl border border-white/15 shadow-2xl">
                    <Play className="w-10 h-10 text-white fill-white translate-x-0.5" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center p-1 md:p-2">
              <img
                key={streamFallbackUrl}
                src={streamFallbackUrl}
                alt="Post media"
                className={`max-h-full max-w-full ${
                  isHorizontal
                    ? "w-full object-contain"
                    : "h-full w-full object-contain md:object-cover"
                }`}
              />
            </div>
          )}

          {/* Double-Tap Floating Heart Bursts */}
          {heartBursts.map((burst) => (
            <div
              key={burst.id}
              style={{ left: burst.x, top: burst.y }}
              className="absolute pointer-events-none z-40 animate-heart-pop"
            >
              <Heart className="w-20 h-20 fill-rose-500 text-rose-500 drop-shadow-[0_8px_24px_rgba(244,63,94,0.65)]" />
            </div>
          ))}

          {/* 2x Speed Pill Indicator (when holding screen) */}
          {isFastForwarding && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1 rounded-full bg-black/70 backdrop-blur-xl border border-cyan-400/40 text-xs font-mono font-semibold text-cyan-300 flex items-center gap-1.5 shadow-xl pointer-events-none animate-pulse">
              <Zap className="w-3.5 h-3.5 fill-cyan-400 text-cyan-400" />
              <span>2x Speed</span>
            </div>
          )}

          {/* Top Gradient & Multi-Item Progress / Page Pill */}
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 via-black/20 to-transparent pointer-events-none" />

          {hasMultipleItems && (
            <>
              {/* Story-style segmented progress bar at top of card */}
              <div
                data-no-stage-click
                className="absolute top-3 inset-x-4 z-30 flex items-center gap-1.5"
              >
                {post.items!.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Go to slide ${idx + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveItemIndex(idx);
                    }}
                    className={`h-1 flex-1 rounded-full transition-all ${
                      idx === activeItemIndex
                        ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                        : idx < activeItemIndex
                        ? "bg-white/60"
                        : "bg-white/25 hover:bg-white/40"
                    }`}
                  />
                ))}
              </div>

              {/* Left / Right Carousel Arrows */}
              <div
                data-no-stage-click
                className="absolute inset-x-3 top-1/2 -translate-y-1/2 flex items-center justify-between z-20 pointer-events-none"
              >
                <button
                  type="button"
                  disabled={activeItemIndex === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveItemIndex((prev) => Math.max(0, prev - 1));
                  }}
                  className="pointer-events-auto p-2 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition disabled:opacity-0 shadow-lg"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={activeItemIndex === totalItemsCount - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveItemIndex((prev) =>
                      Math.min(totalItemsCount - 1, prev + 1)
                    );
                  }}
                  className="pointer-events-auto p-2 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition disabled:opacity-0 shadow-lg"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Top Floating Page Counter Badge */}
              <div className="absolute top-6 right-4 z-20 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-xl border border-white/10 text-[11px] font-mono text-zinc-100 flex items-center gap-1 pointer-events-none">
                <Layers className="w-3 h-3 text-cyan-400" />
                <span>
                  {activeItemIndex + 1}/{totalItemsCount}
                </span>
              </div>
            </>
          )}

          {/* Bottom Vignette for Tags & Scrubber */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/90 via-black/45 to-transparent pointer-events-none" />

          {/* MOBILE ONLY: Right Side Floating Action Bar */}
          <div
            data-no-stage-click
            className="md:hidden absolute right-3.5 bottom-24 flex flex-col items-center gap-4 z-20"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsFavorited(!isFavorited);
              }}
              aria-label="Like"
              className="p-3 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 text-white active:scale-90 transition shadow-lg"
            >
              <Heart
                className={`w-6 h-6 transition-colors duration-200 ${
                  isFavorited ? "fill-rose-500 text-rose-500" : "text-white/90"
                }`}
              />
            </button>

            {isVideo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMute();
                }}
                aria-label="Mute toggle"
                className="p-3 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 text-white/90 active:scale-90 transition shadow-lg"
              >
                {isMuted ? (
                  <VolumeX className="w-6 h-6 text-rose-300" />
                ) : (
                  <Volume2 className="w-6 h-6 text-cyan-300" />
                )}
              </button>
            )}
          </div>

          {/* BOTTOM METADATA OVERLAY (Danbooru Tag Pills) */}
          {tags.length > 0 && (
            <div
              data-no-stage-click
              className={`absolute inset-x-4 ${
                isVideo && duration > 0
                  ? "bottom-24 md:bottom-12"
                  : "bottom-20 md:bottom-5"
              } right-16 md:right-4 z-20 flex flex-wrap items-center gap-1.5 pointer-events-auto`}
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0 mr-0.5 drop-shadow" />
              {displayedTags.map((t) => {
                const colors =
                  TagCategoryColors[t.category] || TagCategoryColors.general;
                return (
                  <button
                    key={t.id || t.name}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick?.(t.name);
                    }}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border backdrop-blur-md transition active:scale-95 ${colors.bg} ${colors.text} ${colors.border} hover:brightness-125`}
                  >
                    #{t.name}
                  </button>
                );
              })}
              {tags.length > 5 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllTags((prev) => !prev);
                  }}
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-white backdrop-blur-md transition"
                >
                  {showAllTags ? "Show less" : `+${tags.length - 5} more`}
                </button>
              )}
            </div>
          )}

          {/* SLEEK BOTTOM SCRUBBER WITH HOVER & TOUCH 1S THUMBNAIL PREVIEW */}
          {isVideo && duration > 0 && (
            <div
              ref={scrubberTrackRef}
              data-no-stage-click
              onMouseEnter={() => setIsHoveringScrubber(true)}
              onMouseLeave={() => setIsHoveringScrubber(false)}
              onMouseMove={handleScrubberMouseMove}
              className="absolute bottom-16 md:bottom-3 inset-x-4 z-30 flex flex-col pointer-events-auto py-1"
            >
              {/* Floating 1s Scrub Preview Bubble (active on touch drag OR desktop mouse hover) */}
              {(isScrubbing || isHoveringScrubber) && hasScrub && (
                <div
                  className="absolute bottom-9 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-75"
                  style={{
                    left: `${Math.max(12, Math.min(88, scrubPositionPct * 100))}%`,
                  }}
                >
                  <div className="p-1.5 rounded-xl bg-zinc-950/95 border border-white/20 shadow-2xl backdrop-blur-xl overflow-hidden">
                    {(() => {
                      const sec = Math.max(
                        0,
                        Math.min(
                          Math.floor(scrubPreviewTime),
                          Math.floor(duration)
                        )
                      );
                      const sheetIndex = Math.floor(sec / 100);
                      const frameInSheet = sec % 100;
                      const col = frameInSheet % 10;
                      const row = Math.floor(frameInSheet / 10);
                      const thumbWidth = 110;
                      const thumbHeight = Math.round(
                        thumbWidth / (aspectRatio || 1)
                      );
                      const posX = -(col * thumbWidth);
                      const posY = -(row * thumbHeight);

                      return (
                        <div
                          style={{
                            width: `${thumbWidth}px`,
                            height: `${thumbHeight}px`,
                            backgroundImage: `url(/api/media/${activeId}/scrub/sheet/${sheetIndex})`,
                            backgroundPosition: `${posX}px ${posY}px`,
                            backgroundSize: `${thumbWidth * 10}px auto`,
                            backgroundRepeat: "no-repeat",
                          }}
                          className="rounded-lg bg-black"
                        />
                      );
                    })()}
                    <div className="text-center font-mono text-[10px] font-semibold text-cyan-300 pt-1">
                      {formatTime(scrubPreviewTime)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 w-full">
                <span className="text-[10px] text-white/70 font-mono tracking-tight w-8 text-right">
                  {formatTime(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={currentTime}
                  aria-label="Progress scrub bar"
                  onTouchStart={() => setIsScrubbing(true)}
                  onTouchEnd={() => setIsScrubbing(false)}
                  onMouseDown={() => setIsScrubbing(true)}
                  onMouseUp={() => setIsScrubbing(false)}
                  onChange={(e) => {
                    const target = parseFloat(e.target.value);
                    setCurrentTime(target);
                    setScrubPreviewTime(target);
                    setScrubPositionPct(target / (duration || 1));
                    if (videoRef.current) {
                      videoRef.current.currentTime = target;
                    }
                  }}
                  className="w-full h-1.5 hover:h-2 transition-all bg-white/25 rounded-full appearance-none cursor-pointer accent-cyan-400"
                />
                <span className="text-[10px] text-white/70 font-mono tracking-tight w-8">
                  {formatTime(duration)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* DESKTOP ONLY: Side Action Dock (Like, Mute, Carousel Info outside the video frame) */}
        <div
          data-no-stage-click
          className="hidden md:flex flex-col items-center justify-end gap-4 self-end pb-6 shrink-0"
        >
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsFavorited(!isFavorited)}
              title="Favorite (L)"
              aria-label="Favorite"
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition active:scale-90 shadow-lg ${
                isFavorited
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-400"
                  : "bg-zinc-900/90 hover:bg-zinc-800 border-white/10 text-white"
              }`}
            >
              <Heart
                className={`w-6 h-6 transition-transform duration-200 ${
                  isFavorited ? "fill-rose-500 text-rose-500 scale-110" : ""
                }`}
              />
            </button>
            <span className="text-[10px] font-mono text-zinc-400">
              {isFavorited ? "Liked" : "Like"}
            </span>
          </div>

          {isVideo && (
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleMute}
                title="Mute / Unmute (M)"
                aria-label="Mute toggle"
                className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition active:scale-90 shadow-lg ${
                  !isMuted
                    ? "bg-cyan-500/15 border-cyan-400/30 text-cyan-300"
                    : "bg-zinc-900/90 hover:bg-zinc-800 border-white/10 text-zinc-300"
                }`}
              >
                {isMuted ? (
                  <VolumeX className="w-6 h-6" />
                ) : (
                  <Volume2 className="w-6 h-6" />
                )}
              </button>
              <span className="text-[10px] font-mono text-zinc-400">
                {isMuted ? "Muted" : "Audio"}
              </span>
            </div>
          )}

          {hasMultipleItems && (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900/90 border border-white/10 flex flex-col items-center justify-center text-xs font-mono text-cyan-300">
                <Layers className="w-4 h-4 mb-0.5" />
                <span className="text-[10px]">
                  {activeItemIndex + 1}/{totalItemsCount}
                </span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">Set</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
