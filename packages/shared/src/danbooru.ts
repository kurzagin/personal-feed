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

export interface TagCategoryPrefixDef {
  category: TagCategory;
  prefix: string;
  aliases: string[];
  label: string;
}

export const TAG_CATEGORY_PREFIXES: TagCategoryPrefixDef[] = [
  { category: "character", prefix: "@character:", aliases: ["@ch", "@char", "ch:", "char:", "@character"], label: "Character" },
  { category: "artist", prefix: "@artist:", aliases: ["@art", "@a", "art:", "a:", "@artist"], label: "Artist" },
  { category: "copyright", prefix: "@copyright:", aliases: ["@copy", "@cp", "@c", "cp:", "c:", "@copyright", "copy:"], label: "Copyright / Series" },
  { category: "meta", prefix: "@meta:", aliases: ["@m", "m:", "meta:", "@meta"], label: "Meta" },
  { category: "general", prefix: "@general:", aliases: ["@gen", "@g", "g:", "gen:", "@general"], label: "General" },
];

/**
 * Parses user tag input which may have a category prefix, e.g.:
 * "@character:marian", "ch:marian", "@art:wlop", or "frieren"
 */
export function parseTagInput(raw: string): { name: string; explicitCategory?: TagCategory; prefixQuery?: string } {
  const trimmed = raw.trim().toLowerCase();
  
  // Check exact/alias prefixes
  for (const def of TAG_CATEGORY_PREFIXES) {
    if (trimmed.startsWith(def.prefix)) {
      const rest = trimmed.slice(def.prefix.length).trim().replace(/^#+/, "").replace(/\s+/g, "_");
      return { name: rest, explicitCategory: def.category };
    }
    // Also check aliases that end in colon or space
    for (const alias of def.aliases) {
      if (trimmed.startsWith(alias + ":")) {
        const rest = trimmed.slice(alias.length + 1).trim().replace(/^#+/, "").replace(/\s+/g, "_");
        return { name: rest, explicitCategory: def.category };
      }
      if (trimmed.startsWith(alias + " ")) {
        const rest = trimmed.slice(alias.length + 1).trim().replace(/^#+/, "").replace(/\s+/g, "_");
        return { name: rest, explicitCategory: def.category };
      }
    }
  }

  const cleanName = trimmed.replace(/^#+/, "").replace(/\s+/g, "_");
  return { name: cleanName };
}
