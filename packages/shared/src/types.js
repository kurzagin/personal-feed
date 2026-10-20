import { z } from "zod";
export const MediaTypeSchema = z.enum([
    "short_video", // <= 3 mins
    "long_video", // > 3 mins (up to 1h+)
    "cosplay_set", // Multi-image photo gallery
    "anime_art" // Single/multi-image illustrations
]);
export const PostRatingSchema = z.enum(["general", "sensitive", "questionable", "explicit"]);
//# sourceMappingURL=types.js.map