#!/usr/bin/env node
// Mock coding agent for the agent-arena offline demo.
// Writes arena-demo.txt in the current directory and reports a fake cost.
import { writeFileSync } from "node:fs";

const prompt = process.argv[2] ?? "(no prompt)";
writeFileSync("arena-demo.txt", `mock agent was here\nprompt: ${prompt}\n`, "utf8");
console.log("mock agent wrote arena-demo.txt");
console.log(`ARENA_COST: ${JSON.stringify({ usd: 0.01 })}`);