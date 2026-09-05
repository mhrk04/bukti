module bukti::reports {
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;
    use sui::event;

    const EInvalidScore: u64 = 0;

    public struct TruthReport has key, store {
        id: UID,
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        evidence_digest: vector<u8>,
        gonka_request_id: vector<u8>,
        model: vector<u8>,
    }

    /// V2 immutable receipt. Additive to `TruthReport`: it commits the same
    /// claim hash, score, and verdict, but also freezes the canonical result
    /// digest and the public Walrus blob ID so a report page can fetch the full
    /// snapshot off-chain and prove it matches this on-chain digest.
    ///
    /// Abilities: `key, store` for a unique, permanently frozen receipt; no
    /// `copy` or `drop` because a report is unique and never destroyed.
    public struct TruthReportV2 has key, store {
        id: UID,
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        /// SHA-256 digest (raw bytes) of the exact canonical result JSON that
        /// is stored on Walrus. A report page reads the blob and re-hashes it.
        result_digest: vector<u8>,
        /// Walrus blob ID (base64url string bytes) of the canonical snapshot.
        walrus_blob_id: vector<u8>,
        /// Comma-joined Gonka request IDs kept for audit.
        gonka_request_ids: vector<u8>,
        /// Comma-joined model names kept for audit.
        models: vector<u8>,
    }

    /// V3 immutable receipt. Additive to V1/V2: it commits the same canonical
    /// result digest and public Walrus blob ID, but is paired with a permanent
    /// public `ReportPublishedV3` event so a public `/reports` index can be
    /// rebuilt from Sui events without opening every object. The plain UTF-8
    /// claim, score, and verdict are intentionally public: a publisher opts in
    /// by freezing them here and emitting the event.
    ///
    /// Abilities: `key, store` for a unique, permanently frozen receipt; no
    /// `copy` or `drop` because a report is unique and never destroyed.
    public struct TruthReportV3 has key, store {
        id: UID,
        /// Plain UTF-8 claim text, intentionally public for the index.
        claim: vector<u8>,
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        /// SHA-256 digest (raw bytes) of the exact canonical result JSON stored
        /// on Walrus. A report page reads the blob and re-hashes it.
        result_digest: vector<u8>,
        /// Walrus blob ID (base64url string bytes) of the canonical snapshot.
        walrus_blob_id: vector<u8>,
        /// Comma-joined Gonka request IDs kept for audit.
        gonka_request_ids: vector<u8>,
        /// Comma-joined model names kept for audit.
        models: vector<u8>,
    }

    /// Permanent public index event emitted once per V3 report. Its `copy, drop`
    /// fields carry the plain claim, score, verdict, the report's object ID, and
    /// the Walrus blob ID so a server-only event reader can build the public
    /// `/reports` list and link each claim to its immutable report.
    public struct ReportPublishedV3 has copy, drop {
        /// Plain UTF-8 claim text.
        claim: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        /// Object ID of the frozen `TruthReportV3` receipt.
        report_id: ID,
        /// Walrus blob ID (base64url string bytes) of the canonical snapshot.
        walrus_blob_id: vector<u8>,
    }

    public fun is_valid_score(score_bps: u16): bool {
        score_bps <= 10_000
    }

    public fun publish_report(
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        evidence_digest: vector<u8>,
        gonka_request_id: vector<u8>,
        model: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(is_valid_score(score_bps), EInvalidScore);
        let report = TruthReport {
            id: object::new(ctx),
            claim_hash,
            score_bps,
            verdict,
            evidence_digest,
            gonka_request_id,
            model,
        };
        transfer::freeze_object(report);
    }

    /// Publishes an immutable V2 receipt committing the canonical result digest
    /// and its public Walrus blob ID. Additive: the V1 `publish_report` above is
    /// unchanged. A re-check creates a new object; reports are never mutated.
    public fun publish_report_v2(
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        result_digest: vector<u8>,
        walrus_blob_id: vector<u8>,
        gonka_request_ids: vector<u8>,
        models: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(is_valid_score(score_bps), EInvalidScore);
        let report = TruthReportV2 {
            id: object::new(ctx),
            claim_hash,
            score_bps,
            verdict,
            result_digest,
            walrus_blob_id,
            gonka_request_ids,
            models,
        };
        transfer::freeze_object(report);
    }

    /// Publishes an immutable V3 receipt and emits a permanent public
    /// `ReportPublishedV3` event indexing the plain claim, score, verdict,
    /// report object ID, and Walrus blob ID. Additive: V1 `publish_report` and
    /// V2 `publish_report_v2` are unchanged. A re-check creates a new object and
    /// a new event; reports are never mutated.
    public fun publish_report_v3(
        claim: vector<u8>,
        claim_hash: vector<u8>,
        score_bps: u16,
        verdict: vector<u8>,
        result_digest: vector<u8>,
        walrus_blob_id: vector<u8>,
        gonka_request_ids: vector<u8>,
        models: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(is_valid_score(score_bps), EInvalidScore);
        let report = TruthReportV3 {
            id: object::new(ctx),
            claim,
            claim_hash,
            score_bps,
            verdict,
            result_digest,
            walrus_blob_id,
            gonka_request_ids,
            models,
        };
        let report_id = object::id(&report);
        event::emit(ReportPublishedV3 {
            claim: report.claim,
            score_bps: report.score_bps,
            verdict: report.verdict,
            report_id,
            walrus_blob_id: report.walrus_blob_id,
        });
        transfer::freeze_object(report);
    }

    #[test]
    fun score_bounds_are_validated() {
        assert!(is_valid_score(0), 0);
        assert!(is_valid_score(10_000), 1);
        assert!(!is_valid_score(10_001), 2);
    }
}
