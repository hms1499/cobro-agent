import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Address } from "viem";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import type { EmailMessage, EmailSender } from "@/lib/email/send";
import { insertSavedAddress, listSavedAddresses } from "./repo";
import { CODE_COOLDOWN_MS, CODE_TTL_MS, CODES_PER_DAY, confirmAddressCode, pendingAddressCode, requestAddressCode, type CodeDeps } from "./codes";

const T0 = new Date("2026-10-21T12:00:00Z");
const SECRET = "s".repeat(48);
const A = { label: "Binance", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address };
const B = { label: "Kraken", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as Address };

let db: Db;
let clock: number;
let sent: EmailMessage[];
let send: Mock<EmailSender>;
let deps: CodeDeps;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  clock = T0.getTime();
  sent = [];
  send = vi.fn<EmailSender>(async (m: EmailMessage) => {
    sent.push(m);
  });
  deps = { db, now: () => new Date(clock), secret: SECRET, send };
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

const codeOf = (m: EmailMessage) => /\b(\d{6})\b/.exec(m.text)![1];
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

describe("address codes", () => {
  it("emails a code bound to the address and confirms it", async () => {
    const user = await seedFreelancer(db);
    const res = await requestAddressCode(deps, user, A);
    expect(res).toEqual({ ok: true, expiresAt: new Date(T0.getTime() + CODE_TTL_MS) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0].to).toBe("ana@example.com");
    expect(sent[0].text).toContain("Binance");
    expect(sent[0].text).toContain(A.address);
    expect(await pendingAddressCode(db, user.id, new Date(clock))).toEqual({ label: "Binance", address: A.address, expiresAt: new Date(T0.getTime() + CODE_TTL_MS) });
    const code = codeOf(sent[0]);
    const done = await confirmAddressCode(deps, user, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    expect(done.ok).toBe(true);
    expect((await listSavedAddresses(db, user.id)).map((a) => a.address)).toEqual([A.address]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent[1].to).toBe("ana@example.com");
    expect(await pendingAddressCode(db, user.id, new Date(clock))).toBeNull();
  });

  it("a code works once", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    const code = codeOf(sent[0]);
    expect((await confirmAddressCode(deps, user, code)).ok).toBe(true);
    expect(await confirmAddressCode(deps, user, code)).toEqual({ ok: false, error: "no_code" });
    expect(await listSavedAddresses(db, user.id)).toHaveLength(1);
  });

  it("locks the code after five wrong attempts", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    const code = codeOf(sent[0]);
    const bad = wrongFor(code);
    for (let i = 0; i < 4; i++) expect(await confirmAddressCode(deps, user, bad)).toEqual({ ok: false, error: "invalid" });
    expect(await confirmAddressCode(deps, user, bad)).toEqual({ ok: false, error: "too_many" });
    expect(await confirmAddressCode(deps, user, code)).toEqual({ ok: false, error: "no_code" });
    expect(await listSavedAddresses(db, user.id)).toHaveLength(0);
  });

  it("treats non-digit input as a wrong attempt", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    expect(await confirmAddressCode(deps, user, "abc")).toEqual({ ok: false, error: "invalid" });
  });

  it("expires after ten minutes", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    clock += CODE_TTL_MS;
    expect(await confirmAddressCode(deps, user, codeOf(sent[0]))).toEqual({ ok: false, error: "no_code" });
    expect(await pendingAddressCode(db, user.id, new Date(clock))).toBeNull();
  });

  it("a new code replaces the old one", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    clock += 61_000;
    await requestAddressCode(deps, user, B);
    const [mA, mB] = sent;
    // Codes are random; only test A's refusal when A's and B's differ.
    if (codeOf(mA) !== codeOf(mB)) {
      expect(await confirmAddressCode(deps, user, codeOf(mA))).toEqual({ ok: false, error: "invalid" });
    }
    const done = await confirmAddressCode(deps, user, codeOf(mB));
    expect(done.ok && done.address.address).toBe(B.address);
    expect((await listSavedAddresses(db, user.id)).map((a) => a.address)).toEqual([B.address]);
  });

  it("limits how often codes are sent", async () => {
    const user = await seedFreelancer(db);
    expect((await requestAddressCode(deps, user, A)).ok).toBe(true);
    clock += CODE_COOLDOWN_MS - 1;
    expect(await requestAddressCode(deps, user, A)).toEqual({ ok: false, error: "cooldown" });
    clock += 1;
    for (let i = 1; i < CODES_PER_DAY; i++) {
      expect((await requestAddressCode(deps, user, A)).ok).toBe(true);
      clock += 61_000;
    }
    expect(await requestAddressCode(deps, user, A)).toEqual({ ok: false, error: "daily_limit" });
  });

  it("serialises parallel requests: one code, one email, and it works", async () => {
    // PGlite is single-connection, so this cannot prove the real race; it checks the logic.
    const user = await seedFreelancer(db);
    const results = await Promise.all([requestAddressCode(deps, user, A), requestAddressCode(deps, user, A)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "cooldown")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await confirmAddressCode(deps, user, codeOf(sent[0]))).ok).toBe(true);
  });

  it("a failed send leaves nothing behind", async () => {
    const user = await seedFreelancer(db);
    send.mockRejectedValueOnce(new Error("boom"));
    expect(await requestAddressCode(deps, user, A)).toEqual({ ok: false, error: "send_failed" });
    expect(errorSpy).toHaveBeenCalled();
    expect(await pendingAddressCode(db, user.id, new Date(clock))).toBeNull();
    expect((await requestAddressCode(deps, user, A)).ok).toBe(true);
  });

  it("a failed send keeps the earlier live code working", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    clock += 61_000;
    send.mockRejectedValueOnce(new Error("boom"));
    expect(await requestAddressCode(deps, user, B)).toEqual({ ok: false, error: "send_failed" });
    expect((await confirmAddressCode(deps, user, codeOf(sent[0]))).ok).toBe(true);
  });

  it("needs an account email", async () => {
    const user = await seedFreelancer(db);
    expect(await requestAddressCode(deps, { id: user.id, email: null }, A)).toEqual({ ok: false, error: "no_email" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed notice does not undo the add", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    send.mockRejectedValueOnce(new Error("boom"));
    const done = await confirmAddressCode(deps, user, codeOf(sent[0]));
    expect(done.ok).toBe(true);
    expect(await listSavedAddresses(db, user.id)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("rechecks the limit at confirm time", async () => {
    const user = await seedFreelancer(db);
    for (let i = 0; i < 9; i++) {
      const addr = `0x${(i + 1).toString(16).padStart(40, "0")}` as Address;
      await insertSavedAddress(db, user.id, { label: `n${i}`, address: addr }, T0);
    }
    await requestAddressCode(deps, user, A);
    await insertSavedAddress(db, user.id, { label: "tenth", address: B.address }, T0);
    expect(await confirmAddressCode(deps, user, codeOf(sent[0]))).toEqual({ ok: false, error: "full" });
  });

  it("refuses an address saved meanwhile as duplicate", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    await insertSavedAddress(db, user.id, A, T0);
    expect(await confirmAddressCode(deps, user, codeOf(sent[0]))).toEqual({ ok: false, error: "duplicate" });
  });

  it("two concurrent confirms add one address", async () => {
    const user = await seedFreelancer(db);
    await requestAddressCode(deps, user, A);
    const code = codeOf(sent[0]);
    const results = await Promise.all([confirmAddressCode(deps, user, code), confirmAddressCode(deps, user, code)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listSavedAddresses(db, user.id)).toHaveLength(1);
  });
});
