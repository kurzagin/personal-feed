import React, { useState, useRef, useEffect } from "react";
import type { Post, Tag } from "@personal-feed/shared";
import { Heart, Volume2, VolumeX, Play } from "lucide-react";

interface FeedCardProps {
  post: Post & { tags: Tag[] };
  isActive: boolean;
  onRecordSession: (stats: {
    duration: number;
    completion: number;
    favorite: boolean;
    skipped: boolean;
    dwellMs?: number;
  }) => void;
}

export const FeedCard: React.FC<FeedCardProps> = ({ post, isActive, onRecordSession }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isFavorited, setIsFavorited] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(post.duration_seconds || 0);

  const startTimeRef = useRef<number>(Date.now());
  const loopCountRef = useRef<number>(0);

  const isVideo = post.media_type.includes("video");
  const isHorizontal = post.aspect_ratio > 1.0;
  const streamUrl = `/api/media/${post.id}/stream`;

  useEffect(() => {
    if (isVideo && videoRef.current) {
      if (isActive) {
        startTimeRef.current = Date.now();
        loopCountRef.current = 0;
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);

        const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
        const totalDuration = duration || 1;
        const completion = (elapsedSec / totalDuration) + loopCountRef.current;
        const skipped = elapsedSec < 3.0;

        onRecordSession({
          duration: elapsedSec,
          completion,
          favorite: isFavorited,
          skipped,
          dwellMs: !isVideo ? Date.now() - startTimeRef.current : undefined,
        });
      }
    }
  }, [isActive]);

  const togglePlay = () => {
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

  const handleTimeUpdate = () => {
    if (videoRef.current) {
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

  return (
    <div className="feed-item relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none">
      {/* Dynamic blurred ambient glow for horizontal content */}
      {isHorizontal && isVideo && (
        <div
          className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-20 scale-125 pointer-events-none"
          style={{ backgroundImage: `url(${streamUrl})` }}
        />
      )}

      {/* Main Content Viewport */}
      {isVideo ? (
        <div
          className="relative w-full h-full flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={streamUrl}
            playsInline
            loop={false}
            muted={isMuted}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            className={`max-h-full max-w-full ${
              isHorizontal ? "w-full object-contain" : "h-full w-full object-cover"
            }`}
          />

          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
              <div className="p-4 bg-black/40 backdrop-blur-xl rounded-full border border-white/5">
                <Play className="w-10 h-10 text-white fill-white" />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="relative w-full h-full flex items-center justify-center p-2">
          <img
            src={streamUrl}
            alt="Content"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}

      {/* Right Side Minimal Action Bar */}
      <div className="absolute right-3.5 bottom-20 flex flex-col items-center gap-5 z-20">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsFavorited(!isFavorited);
          }}
          aria-label="Like"
          className="p-3 rounded-full bg-black/30 backdrop-blur-xl border border-white/5 text-white active:scale-95 transition"
        >
          <Heart
            className={`w-6 h-6 transition-colors duration-200 ${
              isFavorited ? "fill-red-500 text-red-500" : "text-white/80"
            }`}
          />
        </button>

        {isVideo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            aria-label="Mute toggle"
            className="p-3 rounded-full bg-black/30 backdrop-blur-xl border border-white/5 text-white/80 active:scale-95 transition"
          >
            {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          </button>
        )}
      </div>

      {/* Sleek Bottom Scrubber for 1h+ / Long Videos */}
      {isVideo && duration > 0 && (
        <div className="absolute bottom-16 inset-x-4 z-20 flex items-center gap-2 pointer-events-auto">
          <span className="text-[10px] text-white/50 font-mono tracking-tight">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration}
            value={currentTime}
            aria-label="Progress scrub bar"
            onChange={(e) => {
              const target = parseFloat(e.target.value);
              setCurrentTime(target);
              if (videoRef.current) {
                videoRef.current.currentTime = target;
              }
            }}
            className="w-full h-0.5 bg-white/20 rounded-full appearance-none cursor-pointer accent-white"
          />
          <span className="text-[10px] text-white/50 font-mono tracking-tight">{formatTime(duration)}</span>
        </div>
      )}
    </div>
  );
};
