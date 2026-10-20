import React, { useState, useRef, useEffect } from "react";
import { TagCategoryColors } from "@personal-feed/shared";
import { Heart, Volume2, VolumeX, Play, Layers } from "lucide-react";
export const FeedCard = ({ post, isActive, onRecordSession }) => {
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(true);
    const [isFavorited, setIsFavorited] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(post.duration_seconds || 0);
    // Telemetry session tracking
    const startTimeRef = useRef(Date.now());
    const loopCountRef = useRef(0);
    const isVideo = post.media_type.includes("video");
    const isHorizontal = post.aspect_ratio > 1.0;
    const streamUrl = `/api/media/${post.id}/stream`;
    // Autoplay / Pause when swiping into/out of view
    useEffect(() => {
        if (isVideo && videoRef.current) {
            if (isActive) {
                startTimeRef.current = Date.now();
                loopCountRef.current = 0;
                videoRef.current.currentTime = 0;
                videoRef.current.play().catch(() => { });
                setIsPlaying(true);
            }
            else {
                videoRef.current.pause();
                setIsPlaying(false);
                // Record telemetry on swipe away
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
            }
            else {
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
            videoRef.current.play().catch(() => { });
        }
    };
    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? "0" : ""}${s}`;
    };
    return (<div className="feed-item relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none">
      {/* Background ambient glow for horizontal content */}
      {isHorizontal && isVideo && (<div className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-30 scale-125 pointer-events-none" style={{ backgroundImage: `url(${streamUrl})` }}/>)}

      {/* Main Media Player / Content */}
      {isVideo ? (<div className="relative w-full h-full flex items-center justify-center cursor-pointer" onClick={togglePlay}>
          <video ref={videoRef} src={streamUrl} playsInline loop={false} muted={isMuted} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} className={`max-h-full max-w-full ${isHorizontal ? "w-full object-contain" : "h-full w-full object-cover"}`}/>

          {/* Play/Pause overlay indicator */}
          {!isPlaying && (<div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
              <div className="p-4 bg-black/60 rounded-full backdrop-blur-md">
                <Play className="w-12 h-12 text-white fill-white"/>
              </div>
            </div>)}
        </div>) : (
        /* Image / Cosplay Set Display */
        <div className="relative w-full h-full flex items-center justify-center p-2">
          <img src={streamUrl} alt="Media content" className="max-h-full max-w-full object-contain rounded-lg"/>
          {post.media_type === "cosplay_set" && (<div className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-xs text-white">
              <Layers className="w-4 h-4 text-pink-400"/>
              <span>Cosplay Gallery</span>
            </div>)}
        </div>)}

      {/* Right Action Bar (TikTok style) */}
      <div className="absolute right-4 bottom-24 flex flex-col items-center gap-6 z-20">
        <button onClick={(e) => {
            e.stopPropagation();
            setIsFavorited(!isFavorited);
        }} aria-label="Favorite post" className="flex flex-col items-center group">
          <div className={`p-3 rounded-full backdrop-blur-md transition ${isFavorited ? "bg-red-500/20 text-red-500" : "bg-white/10 text-white group-hover:bg-white/20"}`}>
            <Heart className={`w-7 h-7 ${isFavorited ? "fill-red-500" : ""}`}/>
          </div>
          <span className="text-xs text-zinc-300 mt-1">{isFavorited ? "Liked" : "Like"}</span>
        </button>

        {isVideo && (<button onClick={(e) => {
                e.stopPropagation();
                setIsMuted(!isMuted);
            }} aria-label="Toggle mute" className="flex flex-col items-center p-3 rounded-full bg-white/10 backdrop-blur-md text-white hover:bg-white/20 transition">
            {isMuted ? <VolumeX className="w-6 h-6"/> : <Volume2 className="w-6 h-6"/>}
          </button>)}
      </div>

      {/* Bottom Info & Danbooru Tag Pills */}
      <div className="absolute bottom-6 left-4 right-16 z-20 flex flex-col gap-2 pointer-events-none">
        <div className="flex flex-wrap gap-1.5 pointer-events-auto">
          {post.tags.map((t) => {
            const color = TagCategoryColors[t.category] || TagCategoryColors.general;
            return (<span key={t.id} className={`text-xs px-2.5 py-0.5 rounded-full backdrop-blur-md border ${color.bg} ${color.text} ${color.border} font-medium`}>
                #{t.name}
              </span>);
        })}
        </div>

        {/* Progress scrub bar for 1h+ or long videos */}
        {isVideo && duration > 0 && (<div className="w-full flex items-center gap-2 pt-2 pointer-events-auto">
            <span className="text-[10px] text-zinc-400 font-mono">{formatTime(currentTime)}</span>
            <input type="range" min={0} max={duration} value={currentTime} aria-label="Video seek slider" onChange={(e) => {
                const target = parseFloat(e.target.value);
                setCurrentTime(target);
                if (videoRef.current) {
                    videoRef.current.currentTime = target;
                }
            }} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"/>
            <span className="text-[10px] text-zinc-400 font-mono">{formatTime(duration)}</span>
          </div>)}
      </div>
    </div>);
};
//# sourceMappingURL=FeedCard.js.map