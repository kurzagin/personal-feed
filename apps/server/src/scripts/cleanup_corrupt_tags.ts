import { Database } from "bun:sqlite";

export function cleanupCorruptTags(dbPath = "personal_feed.db") {
  const db = new Database(dbPath);

  const merges: Array<{ corruptId: number; canonicalName: string }> = [
    { corruptId: 57194, canonicalName: "honkai:_star_rail" },
    { corruptId: 57195, canonicalName: "kafka_(honkai:_star_rail)" },
    { corruptId: 57196, canonicalName: "sparkle_(honkai:_star_rail)" },
    { corruptId: 57198, canonicalName: "goddess_of_victory:_nikke" },
    { corruptId: 57212, canonicalName: "sparxie_(honkai:_star_rail)" },
  ];

  const mergeTx = db.transaction(() => {
    for (const m of merges) {
      const corrupt = db.query("SELECT * FROM tags WHERE id = ?").get(m.corruptId) as any;
      if (!corrupt) continue;

      const canonical = db.query("SELECT * FROM tags WHERE name = ?").get(m.canonicalName) as any;
      if (canonical) {
        console.log(`Merging tag ${corrupt.id} ("${corrupt.name}", cat: "${corrupt.category}") into ${canonical.id} ("${canonical.name}", cat: "${canonical.category}")...`);
        db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT post_id, ? FROM post_tags WHERE tag_id = ?").run(canonical.id, corrupt.id);
        db.query("DELETE FROM post_tags WHERE tag_id = ?").run(corrupt.id);
        db.query("DELETE FROM tags WHERE id = ?").run(corrupt.id);
      }
    }

    // Clean up any remaining legacy "creator" category to "artist"
    const creatorUpdated = db.query("UPDATE tags SET category = 'artist' WHERE category = 'creator'").run();
    console.log(`Updated ${creatorUpdated.changes} tags with category 'creator' -> 'artist'.`);

    // Clean up any stray non-standard categories
    const strayDeleted = db.query("DELETE FROM tags WHERE category NOT IN ('general', 'artist', 'character', 'copyright', 'meta')").run();
    console.log(`Deleted ${strayDeleted.changes} stray corrupt tag entries.`);
  });

  mergeTx();
  console.log("Tag cleanup completed successfully!");
}

if (import.meta.main) {
  cleanupCorruptTags(process.env.DATABASE_PATH || "personal_feed.db");
}
