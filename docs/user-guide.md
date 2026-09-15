# User guide

Firsts is a non-custodial browser application. It never asks for a seed phrase or private key. Your installed Wallet Standard wallet is the only component allowed to approve chain writes.

## Choose a network

Mainnet is selected by default and spends real SOL. Select devnet before connecting a wallet when rehearsing a workflow. Changing the network disconnects the active wallet so an account cannot accidentally be reused on a chain it did not advertise.

## Publish an artifact

1. Open **Inscribe** and choose text, JSON, image, agent, HTML, or file.
2. Enter content or select a file no larger than 256 KB.
3. Choose v1 for fewer, larger transactions or legacy for broad wallet compatibility. Firsts automatically uses legacy if the connected wallet does not advertise v1 sign-and-send support.
4. Review the digest, chunk count, estimated fee, and mainnet warning.
5. Connect, approve each wallet prompt, and wait for every transaction to confirm.
6. Copy the complete recovery manifest. A multi-chunk publish is not atomic, so preserve any partial manifest shown after an interruption.

JSON and agent text must parse as JSON. Artifact identity is the SHA-256 digest of the original bytes; changing the filename or transaction format does not change it.

## Recover an artifact

Open **Verify**, select the original cluster, paste one transaction signature per line, and fetch. Firsts reads the Memo instructions from RPC, validates the complete envelope sequence, rebuilds the bytes, and compares SHA-256 before enabling download. The download name is sanitized locally.

## Create an SPL token

Open **Launch token**, enter the name, ticker, initial supply, and decimals. Optional artwork is published as a separate Firsts artifact before mint creation; retain that artwork manifest even if the later mint transaction fails. The resulting mint uses the standard SPL Token program, leaves mint authority with the connected wallet, and disables freeze authority.

This workflow does not create metadata recognized by every wallet, a bonding curve, liquidity, or a market. It makes no promise of value.

## Generate a vanity keypair

Open **Vanity keys**, enter Base58 prefix/suffix characters, and start the browser worker. Search complexity grows exponentially. Download the secret once, store it offline, and test restoration before funding it. Firsts cannot recover the key.
