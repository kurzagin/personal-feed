import { app } from "./index";
async function test() {
    console.log("Testing /api/feed...");
    const res = await app.handle(new Request("http://localhost:3001/api/feed"));
    const data = await res.json();
    console.log("Feed items retrieved:", data.items.length);
    for (const item of data.items) {
        console.log(`- [${item.media_type}] ID: ${item.id}, Tags: ${item.tags.map((t) => t.name).join(", ")}`);
    }
    // Test recording a watch session (telemetry)
    console.log("Testing /api/session telemetry...");
    const firstPost = data.items[0];
    const sessionRes = await app.handle(new Request("http://localhost:3001/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            postId: firstPost.id,
            watchDurationSeconds: 15.0,
            completionRate: 1.0,
            interactedFavorite: true,
            interactedSkipped: false,
        }),
    }));
    const sessionData = await sessionRes.json();
    console.log("Session saved:", sessionData);
}
test();
//# sourceMappingURL=test_api.js.map