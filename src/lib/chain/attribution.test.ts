import { concat, encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { attributionSuffix, hasAttribution, tagCalldata } from "./attribution";

const CODE = "celo_bc3965e128ba";
// celo.dataSuffix returned by `loops project get --event agents-on-open-rails`
const LOOPS_SUFFIX = "0x63656c6f5f626333393635653132386261110080218021802180218021802180218021";

describe("attributionSuffix", () => {
  it("matches the suffix Loops House issued for our entry", () => {
    expect(attributionSuffix(CODE)).toBe(LOOPS_SUFFIX);
  });

  it("rejects a code that is not celo_ plus 12 hex characters", () => {
    expect(() => attributionSuffix("celo_bc3965e128b")).toThrow(/attribution code/i);
    expect(() => attributionSuffix("CELO_BC3965E128BA")).toThrow(/attribution code/i);
  });
});

describe("tagCalldata", () => {
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: ["0x000000000000000000000000000000000000dEaD", 1n],
  });

  it("appends the suffix to existing calldata", () => {
    expect(tagCalldata(transfer, CODE)).toBe(concat([transfer, LOOPS_SUFFIX]));
  });

  it("uses the bare suffix when there is no calldata", () => {
    expect(tagCalldata(undefined, CODE)).toBe(LOOPS_SUFFIX);
    expect(tagCalldata("0x", CODE)).toBe(LOOPS_SUFFIX);
  });
});

describe("hasAttribution", () => {
  it("finds our code at the end of tagged calldata", () => {
    expect(hasAttribution(concat(["0xa9059cbb", LOOPS_SUFFIX]), CODE)).toBe(true);
  });

  it("is false for untagged calldata or another code", () => {
    expect(hasAttribution("0xa9059cbb", CODE)).toBe(false);
    expect(hasAttribution(attributionSuffix("celo_000000000000"), CODE)).toBe(false);
  });
});
