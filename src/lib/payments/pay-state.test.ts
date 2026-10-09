import { describe, expect, it } from "vitest";
import { afterPayResponse, formatCountdown, payBlocker, payErrorKey, payExceptionKind, secondsLeft } from "./pay-state";

const ready = {
  hasInjectedWallet: true,
  address: "0xabc",
  chainId: 42220,
  balance: 300_000000n,
  amountAtomic: 300_000000n,
  expiresAt: 1_000_000,
  now: 999_000,
};

describe("payBlocker", () => {
  it("is null when everything is in place", () => {
    expect(payBlocker(ready)).toBeNull();
  });

  it("asks for the first missing thing, in order", () => {
    expect(payBlocker({ ...ready, hasInjectedWallet: false })).toBe("no-wallet");
    expect(payBlocker({ ...ready, address: undefined })).toBe("connect");
    expect(payBlocker({ ...ready, chainId: 1 })).toBe("switch-network");
    expect(payBlocker({ ...ready, now: 1_000_000 })).toBe("expired");
    expect(payBlocker({ ...ready, balance: 299_999999n })).toBe("insufficient");
  });

  it("does not block while the balance is still loading", () => {
    expect(payBlocker({ ...ready, balance: undefined })).toBeNull();
  });
});

describe("payErrorKey", () => {
  it("maps server answers to plain messages", () => {
    expect(payErrorKey(409, { error: "busy" })).toBe("pay.error.busy");
    expect(payErrorKey(409, { error: "closed", status: "paid" })).toBe("pay.error.closed");
    expect(payErrorKey(503, { error: "rates_unavailable" })).toBe("pay.error.rates");
    expect(payErrorKey(503, { error: "not_ready" })).toBe("pay.error.notReady");
    expect(payErrorKey(502, { error: "settlement_unknown" })).toBe("pay.error.unknown");
    expect(payErrorKey(402, {})).toBe("pay.error.rejected");
    expect(payErrorKey(500, null)).toBe("pay.error.generic");
  });
});

describe("afterPayResponse", () => {
  it("shows success for any OK response", () => {
    expect(afterPayResponse({ ok: true, status: 200, signed: true })).toBe("paid");
  });

  it("asks for a fresh confirmation on 402 even after signing, because the server returns 402 only when nothing moved", () => {
    expect(afterPayResponse({ ok: false, status: 402, signed: true })).toBe("requote");
    expect(afterPayResponse({ ok: false, status: 402, signed: false })).toBe("requote");
  });

  it("never invites a second payment after signing when the outcome is not a 402", () => {
    expect(afterPayResponse({ ok: false, status: 502, signed: true })).toBe("locked");
    expect(afterPayResponse({ ok: false, status: 500, signed: true })).toBe("locked");
    expect(afterPayResponse({ ok: false, status: 409, signed: true })).toBe("locked");
  });

  it("locks on 502 and 409 before signing, and shows a retryable error otherwise", () => {
    expect(afterPayResponse({ ok: false, status: 502, signed: false })).toBe("locked");
    expect(afterPayResponse({ ok: false, status: 409, signed: false })).toBe("locked");
    expect(afterPayResponse({ ok: false, status: 503, signed: false })).toBe("error");
  });
});

describe("payExceptionKind", () => {
  it("recognises a declined signature, even when wrapped", () => {
    expect(payExceptionKind({ name: "UserRejectedRequestError" })).toBe("declined");
    expect(payExceptionKind({ code: 4001 })).toBe("declined");
    expect(payExceptionKind(new Error("outer", { cause: { code: 4001 } }))).toBe("declined");
  });

  it("recognises a price that no longer matches the quote", () => {
    expect(payExceptionKind(new Error("All payment requirements were rejected by spendControls"))).toBe("changed");
    expect(payExceptionKind(new Error("network down"))).toBe("other");
  });

  it("recognises the exact errors @x402/fetch rethrows, which carry no cause", () => {
    expect(payExceptionKind(new Error("Failed to create payment payload: User rejected the request."))).toBe("declined");
    expect(payExceptionKind(new Error("Failed to create payment payload: User denied message signature."))).toBe("declined");
    expect(
      payExceptionKind(
        new Error("Failed to create payment payload: All payment requirements were filtered out by policies for x402 version: 2"),
      ),
    ).toBe("changed");
    expect(
      payExceptionKind(
        new Error("Failed to create payment payload: All payment requirements were rejected by spendControls.allowedAssets maxAmountPerPayment."),
      ),
    ).toBe("changed");
  });
});

describe("countdown", () => {
  it("counts whole seconds down to zero", () => {
    expect(secondsLeft(1_000_000, 400_500)).toBe(599);
    expect(secondsLeft(1_000_000, 1_000_001)).toBe(0);
    expect(formatCountdown(599)).toBe("9:59");
    expect(formatCountdown(5)).toBe("0:05");
  });
});
