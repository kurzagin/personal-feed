import React from "react";
import type { Post, Tag } from "@personal-feed/shared";
interface FeedCardProps {
    post: Post & {
        tags: Tag[];
    };
    isActive: boolean;
    onRecordSession: (stats: {
        duration: number;
        completion: number;
        favorite: boolean;
        skipped: boolean;
        dwellMs?: number;
    }) => void;
}
export declare const FeedCard: React.FC<FeedCardProps>;
export {};
//# sourceMappingURL=FeedCard.d.ts.map