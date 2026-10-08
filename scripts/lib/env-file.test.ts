import { describe, expect, it } from "vitest";
import { upsertEnvLine } from "./env-file";

describe("upsertEnvLine", () => {
  it("fills an empty KEY= line in place", () => {
    expect(upsertEnvLine("A=1\nOPERATOR_PRIVATE_KEY=\nB=2\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe(
      "A=1\nOPERATOR_PRIVATE_KEY=0xabc\nB=2\n",
    );
  });

  it("appends the line when the key is absent", () => {
    expect(upsertEnvLine("A=1", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe("A=1\nOPERATOR_PRIVATE_KEY=0xabc\n");
    expect(upsertEnvLine("", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe("OPERATOR_PRIVATE_KEY=0xabc\n");
  });

  it("refuses to overwrite an existing value", () => {
    expect(() => upsertEnvLine("OPERATOR_PRIVATE_KEY=0xdef\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toThrow(
      /already set/,
    );
  });

  it("does not match a key that merely shares a prefix", () => {
    expect(upsertEnvLine("OPERATOR_PRIVATE_KEY_OLD=x\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe(
      "OPERATOR_PRIVATE_KEY_OLD=x\nOPERATOR_PRIVATE_KEY=0xabc\n",
    );
  });
});
