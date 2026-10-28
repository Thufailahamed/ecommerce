import { rmSync } from "node:fs";
rmSync(new URL("./.state", import.meta.url), { recursive: true, force: true });
