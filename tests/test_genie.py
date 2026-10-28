import genie
from genie import FacilityRef, MapContext, OperatorRef


def test_no_context_sends_question_unchanged():
    assert genie.compose("Top producers?", None) == "Top producers?"
    assert genie.compose("Top producers?", MapContext()) == "Top producers?"


def test_context_block_lists_selection():
    ctx = MapContext(
        cnrl_facility_ids=["ABGP1", "ABGP2"], radius_km=25,
        competitor_operators=[OperatorRef(baid="A1", name="Small", boe_d=10),
                              OperatorRef(baid="A2", name="Big", boe_d=5000)],
        focused_facility=FacilityRef(id="ABBT9", name="Pad 9", operator_baid="A2", operator_name="Big"),
        well_ids=["ABWI1"],
    )
    text = genie.compose("Which of these grew?", ctx)
    assert text.startswith("Map context")
    assert "Selected CNRL facilities (2): ABGP1, ABGP2" in text
    assert "within 25 km" in text
    assert text.index("A2 Big (5,000 boe/d)") < text.index("A1 Small (10 boe/d)")  # biggest first
    assert "Focused facility: ABBT9 Pad 9, operator Big (BA ID A2)" in text
    assert "Selected wells (1): ABWI1" in text
    assert text.endswith("Question: Which of these grew?")


def test_long_selections_are_truncated_with_a_count():
    ids = [f"ABBT{i:07d}" for i in range(100)]
    text = genie.context_block(MapContext(cnrl_facility_ids=ids))
    assert f"(first {genie.LIMITS['cnrl']} of 100)" in text
    assert ids[genie.LIMITS["cnrl"]] not in text
