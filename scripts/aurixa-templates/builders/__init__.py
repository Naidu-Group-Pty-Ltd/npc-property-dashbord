"""Template generators, keyed by the template id in ``catalogue.py``.

A catalogue entry with ``built=True`` must have an entry here, and every entry
here must correspond to a catalogue entry. ``verify_library.py`` asserts both
directions, so a generator can never drift away from its published brief.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from finance_templates import (
    borrowing_capacity_report, cash_flow_net_position_report,
    finance_strategy_report, loan_comparison_report,
)
from governance_templates import (
    aml_kyc_assessment, client_fact_find_form, client_onboarding_form,
    client_proposal, client_verification_summary, executive_business_report,
)
from property_templates import (
    off_market_opportunity_report, property_acquisition_recommendation,
    property_comparison_report, property_due_diligence_report,
    property_investment_report,
)

#: template id -> (build function, output filename stem)
BUILDERS = {
    "property-investment-report":
        (property_investment_report, "Aurixa_Property_Investment_Report"),
    "property-acquisition-recommendation":
        (property_acquisition_recommendation, "Aurixa_Property_Acquisition_Recommendation"),
    "off-market-opportunity-report":
        (off_market_opportunity_report, "Aurixa_Off_Market_Opportunity_Report"),
    "property-due-diligence-report":
        (property_due_diligence_report, "Aurixa_Property_Due_Diligence_Report"),
    "property-comparison-report":
        (property_comparison_report, "Aurixa_Property_Comparison_Report"),
    "borrowing-capacity-report":
        (borrowing_capacity_report, "Aurixa_Borrowing_Capacity_Report"),
    "finance-strategy-report":
        (finance_strategy_report, "Aurixa_Finance_Strategy_Report"),
    "loan-comparison-report":
        (loan_comparison_report, "Aurixa_Loan_Comparison_Report"),
    "cash-flow-net-position-report":
        (cash_flow_net_position_report, "Aurixa_Cash_Flow_Net_Position_Report"),
    "client-fact-find-form":
        (client_fact_find_form, "Aurixa_Client_Fact_Find_Form"),
    "client-onboarding-form":
        (client_onboarding_form, "Aurixa_Client_Onboarding_Form"),
    "aml-kyc-assessment":
        (aml_kyc_assessment, "Aurixa_AML_KYC_Assessment"),
    "client-verification-summary":
        (client_verification_summary, "Aurixa_Client_Verification_Summary"),
    "executive-business-report":
        (executive_business_report, "Aurixa_Executive_Business_Report"),
    "client-proposal":
        (client_proposal, "Aurixa_Client_Proposal"),
}

__all__ = ["BUILDERS"]
