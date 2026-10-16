// Server start (lib/copilot.ts prewarm): the outbox on the account's client, with a blob store made the first
// time a flush needs one, and the inbox that runs cards started on the weft.zip board. Until a folder is in
// settings `syncFolders` the listener drops every event and the inbox holds nothing open, so this costs nothing
// on a board that doesn't sync (docs/architecture/cloud-sync.md).
import { accountClient } from "./account";
import { createBlobStore, type BlobStoreBundle } from "./blob-store";
import type { BlobStore } from "./cloud-sync-types";
import { startCloudInbox } from "./cloud-inbox";
import { startCloudSync } from "./cloud-sync";

export function startAccountCloudSync(): () => void {
  let store: BlobStoreBundle | null = null;
  const blobs = (): BlobStoreBundle => (store ??= createBlobStore({ client: accountClient() }));
  const lazy: BlobStore = {
    refFor: (localPath) => blobs().refFor(localPath),
    upload: (localPath, orgId) => blobs().upload(localPath, orgId),
    rewriteItem: (item, orgId) => blobs().rewriteItem(item, orgId),
  };
  const stopSync = startCloudSync({ blobs: lazy });
  const stopInbox = startCloudInbox();
  return () => {
    stopInbox();
    stopSync();
  };
}
