import { describe, expect, it } from "vitest";
import { fetchWalletHistory } from "./wallet-history";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const NONE = { status: "0", message: "No transactions found", result: [] };

/** A fetch that answers Blockscout's txlist and tokentx calls with the given bodies. */
function fakeFetch(bodies: { txlist: unknown; tokentx: unknown }, status = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const action = new URL(String(input)).searchParams.get("action") as "txlist" | "tokentx";
    return new Response(JSON.stringify(bodies[action]), { status });
  }) as typeof fetch;
}

const row = (timeStamp: number, from: string, to: string) => ({ timeStamp: String(timeStamp), from, to });

describe("fetchWalletHistory", () => {
  it("picks the earliest of txlist and tokentx", async () => {
    const history = await fetchWalletHistory(
      ADDRESS,
      fakeFetch({
        txlist: { status: "1", message: "OK", result: [row(1759000000, ADDRESS, "0x2222222222222222222222222222222222222222")] },
        tokentx: { status: "1", message: "OK", result: [row(1758000000, "0x3333333333333333333333333333333333333333", ADDRESS)] },
      }),
    );
    expect(history.firstActivityAt).toEqual(new Date(1758000000 * 1000));
  });

  it("firstFunder is the sender of the earliest incoming row, lowercased", async () => {
    const history = await fetchWalletHistory(
      ADDRESS,
      fakeFetch({
        txlist: NONE,
        tokentx: { status: "1", message: "OK", result: [row(1758000000, "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", ADDRESS.toUpperCase().replace("0X", "0x"))] },
      }),
    );
    expect(history.firstFunder).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });

  it("a wallet with no history gives nulls", async () => {
    expect(await fetchWalletHistory(ADDRESS, fakeFetch({ txlist: NONE, tokentx: NONE }))).toEqual({
      firstActivityAt: null,
      firstFunder: null,
    });
  });

  it("throws on HTTP 503", async () => {
    await expect(fetchWalletHistory(ADDRESS, fakeFetch({ txlist: NONE, tokentx: NONE }, 503))).rejects.toThrow("503");
  });

  it('throws on status "0" with message "Max rate limit reached"', async () => {
    const limited = { status: "0", message: "Max rate limit reached", result: null };
    await expect(fetchWalletHistory(ADDRESS, fakeFetch({ txlist: limited, tokentx: NONE }))).rejects.toThrow("Max rate limit reached");
  });
});
