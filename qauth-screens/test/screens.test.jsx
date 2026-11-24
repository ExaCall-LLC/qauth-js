import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QAuthScreens, MyAccount, MyTokens, OrgMembers, OrgRoles, OrgCompanySignIn, OrgSubOrgs, OrgBranding, ConfirmAction, IdleWarning, createTransport } from "../dist/index.js";
import { qauthProxy } from "@isdlc.ai/qauth";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fakeTransport(routes) {
  const calls = [];
  return {
    calls,
    get: async (p) => { calls.push(["GET", p]); if (!(p in routes)) throw new Error("no route " + p); return routes[p]; },
    send: async (m, p, b) => { calls.push([m, p, b]); return {}; },
  };
}

async function render(ui) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(ui); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

describe("screens render", () => {
  it("My account shows the person's sections", async () => {
    const tr = fakeTransport({
      "/v1/me/security": { email: "lina@shop.test", hasPassword: true, companyManaged: false, authenticator: true, phone: "+966•••••5678", recoveryCodes: 7, offered: { authenticator: true, phone: true } },
      "/v1/me/sessions": [{ id: "s1", createdAt: "2026-11-15T10:00:00Z", lastUsed: "2026-11-15T11:00:00Z", device: "Lina's laptop" }],
    });
    const el = await render(<QAuthScreens transport={tr}><MyAccount /></QAuthScreens>);
    const text = el.textContent;
    for (const s of ["lina@shop.test", "Change password", "Authenticator app", "+966•••••5678", "7 unused", "Lina's laptop", "Sign out everywhere"]) expect(text).toContain(s);
  });

  it("company-managed accounts get no password section; Arabic is right-to-left", async () => {
    const tr = fakeTransport({
      "/v1/me/security": { email: "e@corp.test", hasPassword: false, companyManaged: true, authenticator: false, recoveryCodes: 0, offered: { authenticator: false, phone: false } },
      "/v1/me/sessions": [],
    });
    const el = await render(<QAuthScreens transport={tr} locale="ar"><MyAccount /></QAuthScreens>);
    expect(el.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(el.textContent).toContain("حسابي");
    expect(el.textContent).not.toContain("تغيير كلمة المرور");
  });

  it("people and invitations; company sign-in shows the redirect address", async () => {
    const tr = fakeTransport({
      "/v1/orgs/o1/members": [{ id: "u1", login: "ann@shop.test", role: "admin", managed: true }],
      "/v1/orgs/o1/invitations": [{ id: "i1", email: "new@shop.test", role: "member", status: "pending", expired: false }, { id: "i2", email: "done@shop.test", role: "member", status: "accepted", expired: false }],
      "/v1/orgs/o1/sso": { connected: false, callbackUrl: "https://engine.example/idps/callback" },
    });
    const el = await render(<QAuthScreens transport={tr}><OrgMembers orgId="o1" /><OrgCompanySignIn orgId="o1" /></QAuthScreens>);
    expect(el.textContent).toContain("ann@shop.test");
    expect(el.textContent).toContain("new@shop.test");
    expect(el.textContent).not.toContain("done@shop.test");
    expect([...el.querySelectorAll("input")].some((i) => i.value === "https://engine.example/idps/callback")).toBe(true);
  });

  it("MyTokens makes a personal token from the person's own permissions, a group ticking all of them", async () => {
    const tr = fakeTransport({
      "/v1/me/tokens": [],
      "/v1/me/orgs": [{ id: "o1", name: "Shop" }],
      "/v1/me/token-choices?org=o1": [{ apiId: "a1", apiName: "Records", permissions: [
        { id: "p1", key: "records:read", name: "See records", group: "Records" },
        { id: "p2", key: "records:write", name: "Edit records", group: "Records" },
      ] }],
    });
    tr.send = async (m, p, b) => { tr.calls.push([m, p, b]); return { secret: "qak_secret" }; };
    const el = await render(<QAuthScreens transport={tr}><MyTokens /></QAuthScreens>);
    expect(el.textContent).toContain("Personal access tokens");
    await act(async () => button(el, "New token").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const dialog = document.querySelector('[role="dialog"]');
    const name = dialog.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "My script");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const group = [...dialog.querySelectorAll('[role="checkbox"]')].find((b) => b.getAttribute("aria-label") === "Records");
    await act(async () => group.click());
    await act(async () => button(dialog, "Create token").click());
    const post = tr.calls.find((c) => c[0] === "POST" && c[1] === "/v1/me/tokens");
    expect(post[2].orgId).toBe("o1");
    expect(post[2].permissions.sort()).toEqual(["p1", "p2"]);
    expect(typeof post[2].expiresAt).toBe("string");
    expect(dialog.textContent).toContain("shown only once");
    await act(async () => button(document.querySelector('[role="dialog"]'), "Done").click());
  });

  it("OrgMembers shows every role, edits roles across spaces and greys out roles you can't give", async () => {
    const tr = fakeTransport({
      "/v1/orgs/o1/members": [{ id: "u1", login: "ann@shop.test", role: "member", managed: true, roles: [{ id: "r-org", name: "People manager", space: "organization", spaceName: "Organization" }] }],
      "/v1/orgs/o1/invitations": [],
      "/v1/orgs/o1/givable-roles": { roles: [
        { id: "r-org", name: "People manager", space: "organization", spaceName: "Organization", orgPermissions: ["Invite people"], permissions: [], canGive: true },
        { id: "r-nurse", name: "Nurse", space: "a1", spaceName: "Patient portal", orgPermissions: [], permissions: ["See records"], canGive: true },
        { id: "r-admin", name: "Organization admin", space: "organization", spaceName: "Organization", orgPermissions: ["API keys"], permissions: [], canGive: false, missing: ["API keys"] },
      ] },
    });
    const el = await render(<QAuthScreens transport={tr}><OrgMembers orgId="o1" /></QAuthScreens>);
    expect(el.textContent).toContain("People manager");
    await act(async () => button(el, "Edit roles").click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain("You can't give this role: it includes API keys");
    const boxes = [...dialog.querySelectorAll('[role="checkbox"]')];
    expect(boxes.length).toBe(3);
    expect(boxes.some((b) => b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true" || b.getAttribute("data-disabled") !== null)).toBe(true);
    const nurse = [...dialog.querySelectorAll("label")].find((l) => l.textContent.includes("Nurse")).querySelector('[role="checkbox"]');
    await act(async () => nurse.click());
    await act(async () => button(dialog, "Save").click());
    expect(tr.calls).toContainEqual(["PUT", "/v1/orgs/o1/members/u1/roles", { roleIds: ["r-org", "r-nurse"] }]);
  });

  it("OrgRoles groups app and org permissions and submits both; OrgSubOrgs and OrgBranding call new routes", async () => {
    const tr = {
      calls: [],
      get: async (p) => {
        tr.calls.push(["GET", p]);
        if (p === "/v1/orgs/o1/apps/a1/roles") return [{ id: "r1", name: "Admin", permissions: ["p1"], orgPermissions: ["org.people.invite"] }];
        if (p === "/v1/orgs/o1/apps/a1/permissions") return [{ id: "p1", key: "calls.read", name: "Read calls", group: "Calls" }];
        if (p === "/v1/orgs/o1/org-permissions") return [{ key: "org.people.invite", name: "Invite people", group: "Organization & Team" }];
        if (p === "/v1/orgs/o1/app-roles?app=a1") return [];
        if (p === "/v1/orgs/o1/suborgs") return [{ id: "o2", name: "Partner Beta", levelName: "Service Provider", isolatedDirectory: true }];
        if (p === "/v1/orgs/o1/branding") return { displayName: "Partner Cloud", accent: "#2450C7", background: "#FFFFFF", mode: "auto", language: "auto", hasLogo: false };
        if (p === "/v1/orgs/o1/addresses") return { active: "login.example.com", cnameTarget: "cname.example.com", custom: { host: "login.partner.com", status: "ready" } };
        throw new Error("no route " + p);
      },
      send: async (m, p, b) => {
        tr.calls.push([m, p, b]);
        if (p === "/v1/orgs/o1/suborgs") return { org: { id: "o3", name: b.name }, initialAdminPassword: "temp-pass-123" };
        return {};
      },
    };
    const el = await render(
      <QAuthScreens transport={tr}>
        <OrgRoles orgId="o1" appId="a1" />
        <OrgSubOrgs orgId="o1" />
        <OrgBranding orgId="o1" />
      </QAuthScreens>,
    );
    expect(el.textContent).toContain("Invite people");
    expect(el.textContent).toContain("Partner Beta");
    expect(el.textContent).toContain("Service Provider");
    expect(el.textContent).toContain("CNAME target: cname.example.com");
    expect([...el.querySelectorAll("input")].some((i) => i.value === "Partner Cloud")).toBe(true);
    expect([...el.querySelectorAll("input")].some((i) => i.value === "login.partner.com")).toBe(true);

    // Open "New role", toggle group select-all checkboxes, save
    await act(async () => button(el, "New role").click());
    const dialog = document.querySelector('[role="dialog"]');
    const nameInput = dialog.querySelector("input");
    await act(async () => type(nameInput, "Supervisor"));
    await act(async () => dialog.querySelector('[aria-label="Calls"]')?.click());
    await act(async () => dialog.querySelector('[aria-label="Organization & Team"]')?.click());
    await act(async () => button(dialog, "Save").click());
    expect(tr.calls).toContainEqual(["POST", "/v1/orgs/o1/apps/a1/roles", { name: "Supervisor", permissions: ["p1"], orgPermissions: ["org.people.invite"] }]);
  });
});

// The real path: the screens' transport -> the SDK proxy -> qAuth's real routes.
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent.includes(text));

describe("confirm an action", () => {
  it("sends, shows where it went, offers the other channels, and reports the confirmed request", async () => {
    const calls = [];
    const tr = {
      get: async () => ({}),
      send: async (m, p, b) => {
        calls.push([m, p, b]);
        if (p === "/v1/verifications") return { requestId: "vrq_1", channel: "sms", sentTo: "+966•••••5678", expiresAt: "", channels: ["sms", "voice"] };
        if (p.endsWith("/check")) return b.code === "1234" ? { status: "verified", triesLeft: 0 } : { status: "invalid", triesLeft: 2 };
        return {};
      },
    };
    let done = null;
    const el = await render(
      <QAuthScreens transport={tr}>
        <ConfirmAction template="Money transfer" variables={{ amount: "500" }} summary="500 SAR to Hesham" onVerified={(id) => (done = id)} />
      </QAuthScreens>,
    );
    expect(calls[0]).toEqual(["POST", "/v1/verifications", { template: "Money transfer", variables: { amount: "500" } }]);
    for (const s of ["500 SAR to Hesham", "We sent a code to +966•••••5678", "Call me instead", "Send again in"]) expect(el.textContent).toContain(s);
    const input = el.querySelector("input");
    await act(async () => type(input, "9999"));
    await act(async () => button(el, "Confirm").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(el.textContent).toContain("2 tries left");
    expect(done).toBe(null);
    await act(async () => type(input, "1234"));
    await act(async () => button(el, "Confirm").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(done).toBe("vrq_1");
  });
});

describe("through the proxy to the real server", () => {
  let proc, seed;
  beforeAll(async () => {
    const repo = resolve(process.cwd(), "../..");
    const bin = join(mkdtempSync(join(tmpdir(), "qauth-screens-")), "sdk-testserver");
    execFileSync("go", ["build", "-o", bin, "./tools/sdk-testserver"], { cwd: repo, stdio: "inherit" });
    proc = spawn(bin, [], { stdio: ["ignore", "pipe", "ignore"] });
    seed = await new Promise((res) => createInterface({ input: proc.stdout }).once("line", (l) => res(JSON.parse(l))));
  });
  afterAll(() => proc?.kill());

  it("reads and changes through the transport the screens use", async () => {
    const proxy = qauthProxy({ baseUrl: seed.baseUrl, mount: "/qauth", accessToken: () => "shop-admin-token" });
    const viaProxy = (url, init) => proxy(new Request("https://product.example" + url, init));
    const api = createTransport("/qauth", viaProxy);
    const sec = await api.get("/v1/me/security");
    expect(sec.email).toBe("admin@shop.test");
    const sent = await api.send("POST", `/v1/orgs/${seed.shop}/invitations`, { email: "via-screens@shop.test", send: false });
    expect(sent.invitation.email).toBe("via-screens@shop.test");
    const list = await api.get(`/v1/orgs/${seed.shop}/invitations`);
    expect(list.some((i) => i.email === "via-screens@shop.test")).toBe(true);
    // a write without the screens' header is refused by the proxy
    const raw = await viaProxy(`/qauth/v1/orgs/${seed.shop}/invitations`, { method: "POST", body: "{}" });
    expect(raw.status).toBe(403);
  });

  it("a verification starts through the proxy and shows the masked number", async () => {
    const proxy = qauthProxy({ baseUrl: seed.baseUrl, mount: "/qauth", accessToken: () => "shop-member-token" });
    const api = createTransport("/qauth", (url, init) => proxy(new Request("https://product.example" + url, init)));
    const el = await render(
      <QAuthScreens transport={api}>
        <ConfirmAction template="Money transfer" variables={{ amount: "75" }} onVerified={() => {}} />
      </QAuthScreens>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(el.textContent).toContain("We sent a code to +966");
    expect(el.textContent).not.toContain("+966512345678");
  });
});

describe("idle warning", () => {
  const state = (o) => ({ sessionId: "s1", idleMinutes: 15, maxMinutes: 0, idleSecondsLeft: 900, maxSecondsLeft: -1, ...o });
  function idleTransport(first) {
    const calls = [];
    let answer = first;
    return {
      calls,
      set: (a) => (answer = a),
      get: async (p) => { calls.push(["GET", p]); return answer; },
      send: async (m, p) => { calls.push([m, p]); answer = state({}); return answer; },
    };
  }

  it("shows nothing while there is time", async () => {
    const tr = idleTransport(state({}));
    await render(<QAuthScreens transport={tr}><IdleWarning sessionId="s1" onEnded={() => {}} onSignOut={() => {}} /></QAuthScreens>);
    expect(document.body.textContent).not.toContain("Are you still there?");
    expect(tr.calls[0]).toEqual(["GET", "/v1/me/sessions/s1/state"]);
  });

  it("warns near the idle end; 'Stay signed in' reports activity", async () => {
    const tr = idleTransport(state({ idleSecondsLeft: 40 }));
    await render(<QAuthScreens transport={tr}><IdleWarning sessionId="s1" onEnded={() => {}} onSignOut={() => {}} /></QAuthScreens>);
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(document.body.textContent).toContain("Are you still there?");
    const stay = [...document.querySelectorAll("button")].find((b) => b.textContent === "Stay signed in");
    await act(async () => { stay.click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(tr.calls).toContainEqual(["POST", "/v1/me/sessions/s1/activity"]);
    expect(document.body.textContent).not.toContain("Are you still there?");
  });

  it("near the maximum length it can only sign out", async () => {
    const tr = idleTransport(state({ maxMinutes: 60, maxSecondsLeft: 30 }));
    let out = 0;
    await render(<QAuthScreens transport={tr}><IdleWarning sessionId="s1" onEnded={() => {}} onSignOut={() => out++} /></QAuthScreens>);
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    expect(document.body.textContent).toContain("Your session is ending");
    const dialog = document.querySelector('[role="dialog"]');
    const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Stay signed in");
    await act(async () => { [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Sign out").click(); });
    expect(out).toBe(1);
  });

  it("an ended session calls onEnded with why", async () => {
    const tr = idleTransport(state({ ended: "signed_out" }));
    const ended = [];
    await render(<QAuthScreens transport={tr}><IdleWarning sessionId="s1" onEnded={(r) => ended.push(r)} onSignOut={() => {}} /></QAuthScreens>);
    expect(ended).toEqual(["signed_out"]);
  });
});
