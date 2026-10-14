#!/usr/bin/env node
// Verify script for the agent-arena offline demo.
// Passes when arena-demo.txt exists in the sandbox.
import { existsSync } from "node:fs";

process.exit(existsSync("arena-demo.txt") ? 0 : 1);