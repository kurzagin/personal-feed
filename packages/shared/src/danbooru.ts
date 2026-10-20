import { z } from "zod";

export const TagCategorySchema = z.enum([
  "general",
  "artist",
  "character",
  "copyright",
  "meta"
]);

export type TagCategory = z.infer<typeof TagCategorySchema>;

export const TagCategoryColors: Record<TagCategory, { text: string; bg: string; border: string }> = {
  artist: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  character: { text: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  copyright: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  meta: { text: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  general: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
};
