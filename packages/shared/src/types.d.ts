import { z } from "zod";
import { TagCategorySchema } from "./danbooru";
export declare const MediaTypeSchema: z.ZodEnum<["short_video", "long_video", "cosplay_set", "anime_art"]>;
export type MediaType = z.infer<typeof MediaTypeSchema>;
export declare const PostRatingSchema: z.ZodEnum<["general", "sensitive", "questionable", "explicit"]>;
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
    aspect_ratio: number;
    page_count: number;
    r2_storage_key: string;
    encrypted_key: string;
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
    items: (Post & {
        tags: Tag[];
    })[];
    cursor?: string;
}
//# sourceMappingURL=types.d.ts.map