import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getAddress, type Address } from "viem";

export interface ParaSession {
  paraUserId: string;
  email?: string;
  evmAddress?: Address;
  expiresAt: number;
}

interface ParaJwtData {
  userId?: string;
  email?: string;
  wallets?: { type?: string; address?: string }[];
}

export function paraJwks(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url));
}

export async function verifyParaJwt(token: string, getKey: JWTVerifyGetKey): Promise<ParaSession> {
  const { payload } = await jwtVerify(token, getKey);
  if (payload.exp === undefined) throw new Error("Para token has no expiry");
  const data = (payload.data ?? {}) as ParaJwtData;
  const paraUserId = data.userId ?? payload.sub;
  if (!paraUserId) throw new Error("Para token has no user id");
  const evmWallet = data.wallets?.find((wallet) => wallet.type === "EVM" && wallet.address);
  return {
    paraUserId,
    email: data.email,
    evmAddress: evmWallet?.address ? getAddress(evmWallet.address) : undefined,
    expiresAt: payload.exp,
  };
}
