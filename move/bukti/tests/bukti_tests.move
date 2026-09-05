#[test_only]
module bukti::bukti_tests {
    use bukti::reports;
    use sui::test_scenario;

    #[test]
    fun score_bounds_are_validated() {
        assert!(reports::is_valid_score(10_000), 0);
        assert!(!reports::is_valid_score(10_001), 1);
    }

    #[test]
    fun publish_report_v2_freezes_an_immutable_receipt() {
        let publisher = @0xA11CE;
        let mut scenario = test_scenario::begin(publisher);
        {
            let ctx = scenario.ctx();
            reports::publish_report_v2(
                b"claim-hash",
                8_500,
                b"likely supported",
                b"result-digest",
                b"walrus-blob-id",
                b"req-1,req-2",
                b"model-a,model-b",
                ctx,
            );
        };
        // The receipt is frozen (immutable), so it is not owned by the
        // publisher. Confirm no owned object landed with the sender.
        scenario.next_tx(publisher);
        assert!(!test_scenario::has_most_recent_for_sender<reports::TruthReportV2>(&scenario), 0);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = reports::EInvalidScore)]
    fun publish_report_v2_rejects_out_of_range_score() {
        let publisher = @0xA11CE;
        let mut scenario = test_scenario::begin(publisher);
        {
            let ctx = scenario.ctx();
            reports::publish_report_v2(
                b"claim-hash",
                10_001,
                b"invalid",
                b"result-digest",
                b"walrus-blob-id",
                b"req-1",
                b"model-a",
                ctx,
            );
        };
        scenario.end();
    }

    #[test]
    fun publish_report_v3_freezes_receipt_and_emits_event() {
        let publisher = @0xB0B;
        let mut scenario = test_scenario::begin(publisher);
        {
            let ctx = scenario.ctx();
            reports::publish_report_v3(
                b"BUDI95 gives 300 litres from 1 September 2026",
                b"claim-hash",
                8_500,
                b"likely supported",
                b"result-digest",
                b"walrus-blob-id",
                b"req-1,req-2",
                b"model-a,model-b",
                ctx,
            );
        };
        // Closing the publishing transaction returns its effects: exactly one
        // public index event was emitted, and the frozen receipt is immutable so
        // no owned object lands with the sender.
        let effects = scenario.next_tx(publisher);
        assert!(test_scenario::num_user_events(&effects) == 1, 0);
        assert!(!test_scenario::has_most_recent_for_sender<reports::TruthReportV3>(&scenario), 1);
        scenario.end();
    }

    #[test]
    #[expected_failure(abort_code = reports::EInvalidScore)]
    fun publish_report_v3_rejects_out_of_range_score() {
        let publisher = @0xB0B;
        let mut scenario = test_scenario::begin(publisher);
        {
            let ctx = scenario.ctx();
            reports::publish_report_v3(
                b"invalid claim",
                b"claim-hash",
                10_001,
                b"invalid",
                b"result-digest",
                b"walrus-blob-id",
                b"req-1",
                b"model-a",
                ctx,
            );
        };
        scenario.end();
    }
}
