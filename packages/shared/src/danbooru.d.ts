import { z } from "zod";
export declare const TagCategorySchema: z.ZodEnum<["general", "artist", "character", "copyright", "meta"]>;
export type TagCategory = z.infer<typeof TagCategorySchema>;
export declare const TagCategoryColors: Record<TagCategory, {
    text: string;
    bg: string;
    border: string;
}>;
//# sourceMappingURL=danbooru.d.ts.map