import { describe, expect, it } from "vitest";
import { registrationBlocker } from "./admin-state";

const agentWallet = "0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78";
const ready = { connectedAddress: agentWallet.toLowerCase(), chainId: 42220, agentWallet, isPending: false };

describe("registrationBlocker", () => {
  it("allows registration from the agent wallet on Celo", () => {
    expect(registrationBlocker(ready)).toBeNull();
  });

  it("compares addresses case-insensitively", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: agentWallet.toUpperCase().replace("0X", "0x") })).toBeNull();
  });

  it("blocks when no wallet is connected", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: undefined })).toBe("not-connected");
  });

  it("blocks a different account, which would own the identity", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: "0x000000000000000000000000000000000000dEaD" })).toBe(
      "wrong-wallet",
    );
  });

  it("blocks any network other than Celo mainnet", () => {
    expect(registrationBlocker({ ...ready, chainId: 1 })).toBe("wrong-network");
    expect(registrationBlocker({ ...ready, chainId: 11142220 })).toBe("wrong-network");
    expect(registrationBlocker({ ...ready, chainId: undefined })).toBe("wrong-network");
  });

  it("blocks a second registration once an agent id exists", () => {
    expect(registrationBlocker({ ...ready, registeredAgentId: 9752 })).toBe("already-registered");
    expect(registrationBlocker({ ...ready, registeredAgentId: 9752n })).toBe("already-registered");
    expect(registrationBlocker({ ...ready, registeredAgentId: 0 })).toBe("already-registered");
  });

  it("blocks double submission while a transaction is pending", () => {
    expect(registrationBlocker({ ...ready, isPending: true })).toBe("pending");
  });
});
