#[test_only]
module bukti::bukti_tests {
    use bukti::reports;

    #[test]
    fun score_bounds_are_validated() {
        assert!(reports::is_valid_score(10_000), 0);
        assert!(!reports::is_valid_score(10_001), 1);
    }
}
