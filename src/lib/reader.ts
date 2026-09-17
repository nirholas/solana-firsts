import { RPC_ENDPOINTS, type Cluster } from './config';
import {
  readArtifactFrom,
  readLaunchedToken,
  readTokenImage,
  type LaunchedToken,
  type RecoveredArtifact,
} from './chain-read';

export { reassembleEnvelopes, type ArtifactEnvelope, type LaunchedToken, type RecoveredArtifact } from './chain-read';

export function readArtifact(signatures: readonly string[], cluster: Cluster): Promise<RecoveredArtifact> {
  return readArtifactFrom(RPC_ENDPOINTS[cluster], signatures, cluster);
}

export function readToken(mint: string, cluster: Cluster): Promise<LaunchedToken> {
  return readLaunchedToken(RPC_ENDPOINTS[cluster], mint.trim());
}

export function readImageForToken(token: LaunchedToken, cluster: Cluster): Promise<RecoveredArtifact> {
  return readTokenImage(RPC_ENDPOINTS[cluster], token, cluster);
}
