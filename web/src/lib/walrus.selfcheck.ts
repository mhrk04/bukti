import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidBlobId } from "./walrus.ts";

// Blob IDs are base64url strings; reject path traversal and empty input.
test("isValidBlobId accepts base64url and rejects unsafe input", () => {
  assert.equal(isValidBlobId("Tl3GHxEB_-abc123"), true);
  assert.equal(isValidBlobId(""), false);
  assert.equal(isValidBlobId("../../etc/passwd"), false);
  assert.equal(isValidBlobId("has space"), false);
  assert.equal(isValidBlobId("has/slash"), false);
});
