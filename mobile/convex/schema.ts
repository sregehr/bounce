import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // People who have signed in. Sessions and the Google and Apple account links are kept by
  // the auth components; this table is the app's own record of each person.
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    /** Set by the in-app purchase once there is one: lifts the limit on AI features. */
    pro: v.optional(v.boolean()),
    /** AI images counted against the free allowance. */
    aiUsed: v.optional(v.number()),
  }).index("by_email", ["email"]),

  // Every AI image asked for: what was asked, with which model, and what it cost.
  aiImages: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("backdrop"), v.literal("restyle")),
    prompt: v.string(),
    model: v.string(),
    status: v.union(v.literal("pending"), v.literal("made"), v.literal("failed")),
    costUsd: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Which account each device's backup belongs to, recorded when someone signs in on it.
  devices: defineTable({
    deviceId: v.string(),
    userId: v.id("users"),
  })
    .index("by_device", ["deviceId"])
    .index("by_user", ["userId"]),

  // The beats and takes tables below have no owner yet; they get an owner field and index
  // before this is deployed anywhere shared.
  beats: defineTable({
    name: v.string(),
    audio: v.id("_storage"),
    durationSec: v.number(),
    sampleRate: v.number(),
    channels: v.number(),
    bitDepth: v.number(),
    source: v.union(v.literal("capture"), v.literal("import")),
    // Filled in by tempo and key detection, which does not exist yet.
    bpm: v.optional(v.number()),
    key: v.optional(v.string()),
  }),

  // What proves a caller is the device a backup belongs to: a hash of the secret that device
  // made up on first launch, registered the first time it backs up. See convex/backup.ts.
  deviceSecrets: defineTable({
    deviceId: v.string(),
    hash: v.string(),
  }).index("by_device", ["deviceId"]),

  // Backup of the app's local library, kept under a random id made on each device and readable
  // only with that device's secret. Signing in links the id to the account (the devices table);
  // restoring onto another device is not built yet.
  backupProjects: defineTable({
    deviceId: v.string(),
    localId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
    /** The project as the app stores it, as JSON. */
    data: v.string(),
  }).index("by_device_local", ["deviceId", "localId"]),

  backupFiles: defineTable({
    deviceId: v.string(),
    key: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
  }).index("by_device_key", ["deviceId", "key"]),

  // A song put up for friends to hear, behind a link nobody could guess. The link opens a small
  // player page (convex/http.ts) where they can leave notes at a moment in the song.
  shares: defineTable({
    token: v.string(),
    deviceId: v.string(),
    /** The song's id on the device that shared it. */
    localId: v.string(),
    title: v.string(),
    artist: v.string(),
    audio: v.id("_storage"),
    durationSec: v.number(),
    /** The waveform drawn on the page, as 0 to 1 peaks. */
    peaks: v.array(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_device_local", ["deviceId", "localId"]),

  shareNotes: defineTable({
    shareId: v.id("shares"),
    atSec: v.number(),
    name: v.string(),
    text: v.string(),
  }).index("by_share", ["shareId"]),

  takes: defineTable({
    beatId: v.id("beats"),
    audio: v.id("_storage"),
    durationSec: v.number(),
    // How far the take is shifted against the beat on playback, from the device's latency test.
    compensationMs: v.number(),
  }).index("by_beat", ["beatId"]),
});
