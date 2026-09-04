module bukti::reports {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::TxContext;

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

    #[test]
    fun score_bounds_are_validated() {
        assert!(is_valid_score(0), 0);
        assert!(is_valid_score(10_000), 1);
        assert!(!is_valid_score(10_001), 2);
    }
}
