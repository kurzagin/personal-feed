import { z } from "zod";
import { TagCategorySchema } from "./danbooru";

export const MediaTypeSchema = z.enum([
  "short_video",   // <= 3 mins
  "long_video",    // > 3 mins (up to 1h+)
  "cosplay_set",   // Multi-image photo gallery
  "anime_art"      // Single/multi-image illustrations
]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const PostRatingSchema = z.enum(["general", "sensitive", "questionable", "explicit"]);
export type PostRating = z.infer<typeof PostRatingSchema>;

export interface Tag {
  id: number;
  name: string;
  category: z.infer<typeof TagCategorySchema>;
}

export interface Post {
  id: string;
  media_type: MediaType;
  duration_seconds: number | null;
  aspect_ratio: number; // width / height
  page_count: number;
  r2_storage_key: string;
  encrypted_key: string; // Base64 wrapped content key
  content_hash: string;
  created_at: number;
  rating: PostRating;
  tags?: Tag[];
}

export interface WatchSessionInput {
  postId: string;
  watchDurationSeconds: number;
  completionRate: number;
  interactedFavorite: boolean;
  interactedSkipped: boolean;
  interactedDwellMs?: number;
  lastPositionSeconds?: number;
}

export interface FeedResponse {
  items: (Post & { tags: Tag[] })[];
  cursor?: string;
}
