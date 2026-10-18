# Image privacy and integrity

New uploads passing through the shared upload guard and the base64 image route
are sanitized before their size and SHA-256 are recorded. JPEG, PNG, GIF and WebP
are supported. Recognized images in unsupported formats are rejected rather than
published without inspection. Profile-store media data URLs are sanitized
recursively; invalid media data URLs become empty strings.

The sanitizer removes container metadata without decoding or recompressing pixels.
It checks container boundaries and required content, but is not a complete image
decoder: it does not validate PNG CRCs or compressed pixel streams. Removal of EXIF
orientation and color profiles can change the displayed orientation or colors.
Metadata embedded in pixels is not removed. Audio/video metadata is not stripped.

Upload responses and message attachments carry `sha256`. Attachments referencing
missing files or non-upload relative URLs have a null hash. Message creation (REST
and socket) and text edits record `integrityHash`; read receipts, reactions and poll
votes are intentionally excluded. Hashes are server-computed checksums, not signed
proofs of authenticity, and clients do not automatically verify them.

Existing stored files and messages are not migrated or rehashed. No external URLs
are fetched. Upload paths are lexically restricted before reading; the uploads
directory must remain administrator-controlled and must not contain symlinks to
private files. Hashing currently uses synchronous file reads, so large attachments
can temporarily block the Node.js event loop.

Canonical base64 (including required padding) is required; whitespace is accepted.
Clients submitting malformed/unsupported data URLs will have those media entries
removed. Existing clients can ignore the additional hash fields.