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

Open **Verify**, select the original cluster, and paste one transaction signature per line, or a single mint address to open that coin's page instead. Then fetch. Firsts reads the Memo instructions from RPC, validates the complete envelope sequence, rebuilds the bytes, and compares SHA-256 before enabling download. The download name is sanitized locally.

## Launch a coin

Open **Launch**, enter the name, ticker, and supply, and optionally add a story,
links, and artwork. Everything you enter is written into the mint account itself,
so the coin does not depend on this site continuing to exist.

Artwork is compressed in your browser to fit the transaction budget you choose:
**Compact** is one transaction, **Detailed** is four, and higher fidelity costs
more transactions because the image is stored as chain bytes. The preview shows
the exact bytes that will be inscribed.

Two switches decide what you can still change afterwards:

- **Fixed supply** revokes the mint authority once the supply is minted. Nobody
  can print more, including you.
- **Frozen metadata** revokes the update authority. The name, artwork, and links
  become permanent.

Both revocations happen in the same sequence that creates the coin. On a wallet
that supports v1 the whole launch is one atomic transaction, so it either
entirely happens or entirely does not. On a legacy wallet it takes two or more
approvals; if you stop partway, the studio keeps what was confirmed and the
**Resume launch** button finishes the same mint instead of paying twice.

When it is done you get a page at `/t/<cluster>/<mint>` that anyone can open. It
rebuilds the coin from chain data and checks the artwork digest before showing
the image.

This creates a token with metadata. It does not create a bonding curve,
liquidity, or a market, and it is not a promise of value.

## Generate a vanity keypair

Open **Vanity keys**, enter Base58 prefix or suffix characters, and start the
search. It runs on every spare core in your browser and reports how many keys per
second it is trying and roughly how long the pattern will take. Complexity grows
exponentially with each character, and matching capitals exactly roughly doubles
the work per letter.

A found key can be downloaded once, or used as the mint address of your next
launch with **Use as my coin address**, which is how a coin gets an address
ending in its own ticker. Store the file offline and test restoring it before
funding it. Closing the tab erases the key, and Firsts cannot recover it.
