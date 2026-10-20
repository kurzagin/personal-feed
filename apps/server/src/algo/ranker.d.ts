import { Database } from "bun:sqlite";
import type { Post, Tag } from "@personal-feed/shared";
export declare class FeedRanker {
    private db;
    constructor(db: Database);
    /**
     * Computes the dynamic user tag affinity vector with exponential time decay.
     * Half-life is set to 7 days (604,800,000 ms).
     */
    getUserTagAffinities(): Map<number, number>;
    /**
     * Generates a ranked batch of feed items.
     */
    getRankedFeed(limit?: number): (Post & {
        tags: Tag[];
    })[];
}
//# sourceMappingURL=ranker.d.ts.map