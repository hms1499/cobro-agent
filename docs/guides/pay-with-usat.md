# Paying a Cobro invoice in USA₮

For clients who received a Cobro payment link (`https://cobro-agent.vercel.app/pay/…`, or `/r/…` for a recurring invoice) and want to pay in
**USA₮**, the US-regulated dollar stablecoin on Celo. Paying takes about a minute and costs no network fee:
you only sign.

## What you need

- A browser wallet or wallet app that works on Celo: MiniPay, MetaMask or Rabby.
- Enough USA₮ on **Celo mainnet** to cover the invoice. No CELO is needed for gas: the payment settles
  through Celo's x402 facilitator, which pays the network fee.

USA₮ on Celo is the token at
[`0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`](https://celoscan.io/token/0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771)
(6 decimals), issued by Anchorage Digital Bank ([Celo docs: Build with USA₮](https://docs.celo.org/build-on-celo/build-with-usat),
[usat.io](https://usat.io/)). Check the address before you add it to your wallet.

## Getting USA₮ on Celo

1. **Google Cloud Web3 faucet, after verifying with Self.** Eligible people can claim a first allocation of
   USA₮ on Celo mainnet once they verify with [Self](https://self.xyz/)
   ([event FAQ](https://www.loops.house/agents-on-open-rails)). Open the
   [Celo mainnet faucet](https://cloud.google.com/application/web3/faucet/celo/mainnet), sign in, and follow
   its steps.
2. **From another chain or an exchange.** Celo lists its supported [on-ramps](https://docs.celo.org/home/ramps)
   and [bridges](https://docs.celo.org/home/bridged-tokens/bridges). Make sure what arrives is USA₮ on Celo,
   not USD₮ or USDC.
3. **Already hold USD₮, wARS or wBRL on Celo?** You don't need USA₮: the payment page also accepts those.
   USDC is not accepted.

## Paying

1. Open the payment link the freelancer sent you.
2. Under **Choose how to pay**, pick **US dollar (USA₮)**. The page shows the exact amount and how long
   the rate is locked.
3. Press **Connect wallet**, and **Switch to Celo** if the page asks.
4. Press **Pay**, then confirm the signature in your wallet. You are signing a transfer of exactly the
   amount shown, to the freelancer's account; nothing else.
5. Wait a few seconds for **Payment complete**. **View receipt on Celoscan** opens the transaction.

For a recurring invoice, keep the `/r/…` link: it always opens the invoice that is due now, so you use the same link and the same steps every period.

## If something goes wrong

- **"Switch to Celo" keeps appearing:** your wallet is on another network. Add Celo mainnet (chain 42220)
  in your wallet and switch to it.
- **"Your wallet has …":** not enough USA₮. Top up, or choose another currency on the page.
- **"The rate expired":** press **Get a new rate**. Rates are locked only for a short time.
- **"You declined the signature":** nothing was paid. Press **Pay** again when you're ready.
- **"We couldn't confirm your payment yet":** don't pay again. Refresh the page in a few minutes; the
  invoice shows as paid once the transaction is confirmed.
