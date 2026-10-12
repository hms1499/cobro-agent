// src/lib/signer/treasury-signer.ts
import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import type { ParaRestClient, ParaTypedData } from "./para-rest";
import { rawSignatureToParts, toJsonSafe } from "./signature";

export interface DigestSignature {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
}

/**
 * Spec §7.2: the only way the app signs for a treasury wallet. Transactions are CIP-64 (gas in a
 * stablecoin), which Para's sign-transaction does not accept, so they are signed as a digest
 * (sign-raw, spike check 5). Textile's taker proof is EIP-712.
 */
export interface TreasurySigner {
  readonly address: Address;
  signDigest(digest: Hex): Promise<DigestSignature>;
  signTypedData(data: TypedDataDefinition): Promise<Hex>;
}

export function paraTreasurySigner(
  client: Pick<ParaRestClient, "signRaw" | "signTypedData">,
  wallet: { id: string; address: Address },
): TreasurySigner {
  return {
    address: wallet.address,
    async signDigest(digest) {
      return rawSignatureToParts(await client.signRaw(wallet.id, digest));
    },
    async signTypedData(data) {
      const { domain, types, primaryType, message } = data as unknown as ParaTypedData & {
        types: Record<string, readonly { name: string; type: string }[]>;
      };
      // Para derives the domain type itself and rejects an explicit EIP712Domain entry.
      const ownTypes = Object.fromEntries(Object.entries(types).filter(([name]) => name !== "EIP712Domain"));
      return client.signTypedData(
        wallet.id,
        toJsonSafe({ domain: domain ?? {}, types: ownTypes, primaryType, message }) as ParaTypedData,
      );
    },
  };
}

/** The same interface over a local key, for tests and one-off scripts. */
export function localKeyTreasurySigner(privateKey: Hex): TreasurySigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async signDigest(digest) {
      const { r, s, yParity } = await sign({ hash: digest, privateKey });
      return { r, s, yParity: yParity === 1 ? 1 : 0 };
    },
    signTypedData: (data) => account.signTypedData(data),
  };
}
