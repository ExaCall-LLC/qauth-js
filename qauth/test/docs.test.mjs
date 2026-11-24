// The TypeScript samples of qAuth's docs (docs/*.md, ```ts / ```typescript
// blocks) typecheck against this package's built types (dist), strict.
// A block not meant to compile (a sample for another library, a deliberate
// fragment) has `<!-- no-compile -->` on the line right before its fence
// (the Go samples follow the same rule: docs/snippets_test.go).
//
// Each sample is its own module. A sample without an `export` is wrapped in
// an async function (so `return` and `await` work); its import lines move
// to the first line, so error positions map back to the page. Free names a
// sample uses (token, req, res, app, verifier, qauth, …) are declared in
// PRELUDE. Handler parameters may be untyped (noImplicitAny off): Express's
// own types are not installed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(pkg, "..", "..", "docs");
const LANGS = new Set(["ts", "typescript"]);

/** The fenced ts blocks of every page: { file, line (first code line), code, skip }. */
export function snippets(dir) {
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("```") || lines[i].length === 3) continue;
      const lang = lines[i].slice(3).trim();
      let j = i + 1;
      while (j < lines.length && lines[j].trimEnd() !== "```") j++;
      if (j === lines.length) throw new Error(`${file}:${i + 1}: unclosed code block`);
      if (LANGS.has(lang)) {
        const skip = i > 0 && lines[i - 1].trim().startsWith("<!-- no-compile");
        out.push({ file, line: i + 2, code: lines.slice(i + 1, j).join("\n"), skip });
      }
      i = j;
    }
  }
  return out;
}

/** The module for one sample; line N (N >= 2) is the sample's line N-1. */
export function moduleFor(code) {
  const lines = code.split("\n");
  const imports = [];
  const body = lines.map((l) => {
    if (!l.startsWith("import ")) return l;
    if (!/;\s*$/.test(l)) throw new Error("a multi-line import: put it on one line");
    imports.push(l.trim());
    return "";
  });
  const wrap = !lines.some((l) => l.startsWith("export "));
  const first = ["export {};", ...imports, wrap ? "async function snippet(): Promise<any> {" : ""].join(" ");
  return [first, ...body, wrap ? "}" : ""].join("\n");
}

// Free names the samples use. A global script: no top-level import/export.
const PRELUDE = `
type SDK = typeof import("@isdlc.ai/qauth");
declare const process: { env: Record<string, string | undefined> };
declare const QAuth: SDK["QAuth"];
declare const QAuthError: SDK["QAuthError"];
declare const Verifier: SDK["Verifier"];
declare const TokenErrorCode: SDK["TokenErrorCode"];
declare const identityOf: SDK["identityOf"];
declare const keyMay: SDK["keyMay"];
declare const qauth: import("@isdlc.ai/qauth").QAuth;
declare const verifier: import("@isdlc.ai/qauth").Verifier;
declare const me: import("@isdlc.ai/qauth").PersonClient;
declare const org: import("@isdlc.ai/qauth").OrgClient;
declare const app: { use(...handlers: any[]): void; get(path: string, ...handlers: ((req: any, res: any, next: any) => unknown)[]): void };
declare const req: any;
declare const res: any;
declare const token: string;
declare const accessToken: string;
declare const newAccessToken: string;
declare const idToken: string;
declare const baseUrl: string;
declare const apiAppId: string;
declare const appId: string;
declare const orgId: string;
declare const userId: string;
declare const roleId: string;
declare const permissionId: string;
declare const invitationId: string;
declare const verificationId: string;
declare const clientId: string;
declare const clientSecret: string;
declare const presentedKey: string;
declare const orgApiKey: string;
declare const jwksUri: string;
declare const discovery: { jwks_uri: string };
declare const allowed: string[];
declare const allowedClientIds: string[];
declare function getSession(req: unknown): Promise<{ accessToken: string } | null>;
declare function showCountdown(reason: string, secondsLeft: number): void;
declare function hideCountdown(): void;
declare function signOutLocally(reason?: string): void;
declare function endSessionAndRefuse(req: any, res: any): unknown;
`;

test("the docs' TypeScript samples typecheck against the SDK", () => {
  const all = snippets(docsDir);
  const todo = all.filter((s) => !s.skip);
  assert.ok(todo.length > 10, `only ${todo.length} TypeScript samples found in ${docsDir}`);
  // inside the package, so "@isdlc.ai/qauth" resolves to this package (self-reference) and "jose" to node_modules
  const work = join(pkg, `.docs-snippets-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  try {
    const files = [join(work, "prelude.d.ts")];
    writeFileSync(files[0], PRELUDE);
    const where = new Map();
    todo.forEach((s, i) => {
      const f = join(work, `s${String(i).padStart(3, "0")}.ts`);
      writeFileSync(f, moduleFor(s.code));
      files.push(f);
      where.set(f, s);
    });
    const program = ts.createProgram(files, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      types: [],
      strict: true,
      noImplicitAny: false,
      noEmit: true,
      skipLibCheck: true,
    });
    const problems = ts.getPreEmitDiagnostics(program).map((d) => {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (!d.file) return msg;
      const s = where.get(d.file.fileName);
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
      return s ? `${s.file}:${s.line + line - 1}: ${msg}` : `${d.file.fileName}:${line + 1}: ${msg}`;
    });
    assert.deepEqual(problems, [], "fix the samples (or mark one <!-- no-compile -->):\n" + problems.join("\n"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("moduleFor keeps the sample's lines where they were", () => {
  const m = moduleFor('import { QAuth } from "x";\nconst a = 1;\nreturn a;').split("\n");
  assert.equal(m[0], 'export {}; import { QAuth } from "x"; async function snippet(): Promise<any> {');
  assert.equal(m[2], "const a = 1;");
  assert.equal(m[4], "}");
  assert.equal(moduleFor("export const b = 2;").split("\n")[1], "export const b = 2;");
});
