import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_NAME;

if (!tag) throw new Error("GITHUB_REF_NAME is required to verify a release tag.");
if (tag !== `v${version}`) throw new Error(`Release tag ${tag} must match package version v${version}.`);
