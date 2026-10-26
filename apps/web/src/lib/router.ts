export type AppTab = "feed" | "explore" | "upload" | "edit-tags" | "preferences";

export interface AppRoute {
  tab: AppTab;
  editPostId?: string;
  tagFilter?: string | null;
}

export function parseHash(hash: string): AppRoute {
  // Strip leading '#' and optional leading '/'
  const clean = hash.replace(/^#\/?/, "");
  if (!clean) {
    return { tab: "feed", tagFilter: null };
  }

  const [pathPart, queryPart] = clean.split("?");
  const searchParams = new URLSearchParams(queryPart || "");
  const tagFilter = searchParams.get("tag") ? decodeURIComponent(searchParams.get("tag")!) : null;

  const segments = pathPart.split("/").filter(Boolean);
  const primary = segments[0] || "";

  if (primary === "edit-tags") {
    const editPostId = segments[1] || searchParams.get("id") || undefined;
    return { tab: "edit-tags", editPostId, tagFilter };
  }
  if (primary === "explore") {
    return { tab: "explore", tagFilter };
  }
  if (primary === "upload") {
    return { tab: "upload", tagFilter };
  }
  if (primary === "preferences") {
    return { tab: "preferences", tagFilter };
  }
  return { tab: "feed", tagFilter };
}

export function formatHash(
  tab: AppTab,
  editPostId?: string,
  tagFilter?: string | null
): string {
  const params = new URLSearchParams();
  if (tagFilter) {
    params.set("tag", tagFilter);
  }
  const queryStr = params.toString() ? `?${params.toString()}` : "";

  if (tab === "edit-tags" && editPostId) {
    return `#/edit-tags/${encodeURIComponent(editPostId)}${queryStr}`;
  }
  if (tab === "explore") {
    return `#/explore${queryStr}`;
  }
  if (tab === "upload") {
    return `#/upload${queryStr}`;
  }
  if (tab === "preferences") {
    return `#/preferences${queryStr}`;
  }
  return `#/feed${queryStr}`;
}
