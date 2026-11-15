import type { Doc } from "./_generated/dataModel";

// The one place that decides who may use the AI features. Today everyone signed in gets a
// small free allowance. When the in-app purchase arrives, its receipt handler sets `pro` on
// the user and nothing else here or in the app has to change.

/** AI images a free account may make. Override with AI_FREE_IMAGES on the deployment. */
export const freeImages = () => {
  const set = Number(process.env.AI_FREE_IMAGES);
  return Number.isFinite(set) && set >= 0 ? Math.floor(set) : 5;
};

/** `left` is null when there is no limit. */
export function aiAllowance(user: Pick<Doc<"users">, "pro" | "aiUsed">): { pro: boolean; left: number | null } {
  if (user.pro) return { pro: true, left: null };
  return { pro: false, left: Math.max(0, freeImages() - (user.aiUsed ?? 0)) };
}
