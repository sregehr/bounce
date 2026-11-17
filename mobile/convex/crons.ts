import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("clear unclaimed uploads", { hours: 1 }, internal.cleanup.sweep, {});

export default crons;
