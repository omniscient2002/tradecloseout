#!/usr/bin/env python3
import os

FILES = [
    "README.md",
    "00-PRODUCT-VISION.md",
    "01-MARKET-AND-DOMAIN-RESEARCH.md",
    "02-BUSINESS-REQUIREMENTS.md",
    "03-PRODUCT-REQUIREMENTS.md",
    "04-DOCUMENT-CATALOGUE.md",
    "05-ACTORS-AND-PERMISSIONS.md",
    "06-WORKFLOWS-AND-STATE-MACHINES.md",
    "07-CUSTOMISATION-ENGINE.md",
    "08-DATA-MODEL-AND-ERD.md",
    "09-SYSTEM-ARCHITECTURE.md",
    "10-API-AND-INTEGRATIONS.md",
    "11-UI-UX-SPECIFICATION.md",
    "12-EDGE-CASES-AND-FAILURE-MODES.md",
    "13-SECURITY-PRIVACY-AND-COMPLIANCE.md",
    "14-TESTING-AND-ACCEPTANCE.md",
    "15-DEPLOYMENT-AND-OPERATIONS.md",
    "16-MVP-AND-IMPLEMENTATION-ROADMAP.md",
    "17-BUSINESS-VALIDATION-PLAN.md",
    "SOURCES-VERIFICATION.md",
    "DECISIONS-AND-OPEN-QUESTIONS.md",
    "TRADECLOSEOUT-AUDIT/README.md",
    "TRADECLOSEOUT-AUDIT/00-EXECUTIVE-AUDIT.md",
    "TRADECLOSEOUT-AUDIT/01-CRITICAL-ISSUES.md",
    "TRADECLOSEOUT-AUDIT/02-DOMAIN-AND-BUSINESS-REVIEW.md",
    "TRADECLOSEOUT-AUDIT/03-PRODUCT-AND-WORKFLOW-REVIEW.md",
    "TRADECLOSEOUT-AUDIT/04-ARCHITECTURE-AND-DATABASE-REVIEW.md",
    "TRADECLOSEOUT-AUDIT/05-SECURITY-AND-EDGE-CASE-REVIEW.md",
    "TRADECLOSEOUT-AUDIT/06-REQUIREMENT-TRACEABILITY.md",
    "TRADECLOSEOUT-AUDIT/07-RECOMMENDED-CHANGES.md",
    "TRADECLOSEOUT-AUDIT/08-FINAL-READINESS-REPORT.md",
    "TRADECLOSEOUT-AUDIT/ISSUE-REGISTER.md",
]

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    header_path = os.path.join(root, "scripts", "master-prompt-header.txt")
    with open(header_path, "r", encoding="utf-8") as f:
        header = f.read().rstrip()

    out_parts = [header, ""]

    total = len(FILES)
    for i, rel_path in enumerate(FILES, start=1):
        num_str = f"{i:02d}"
        file_path = os.path.join(root, rel_path)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        banner = (
            "================================================================================\n"
            f"FILE {num_str}/{total} — {rel_path}\n"
            "================================================================================"
        )
        out_parts.append(banner)
        out_parts.append("")
        out_parts.append(content.rstrip())
        out_parts.append("")

    final_content = "\n".join(out_parts).strip() + "\n"

    target_md = os.path.join(root, "TRADECLOSEOUT-MASTER-PROMPT.md")
    target_txt = os.path.join(root, "TRADECLOSEOUT-MASTER-PROMPT.txt")

    with open(target_md, "w", encoding="utf-8") as f:
        f.write(final_content)
    with open(target_txt, "w", encoding="utf-8") as f:
        f.write(final_content)

    print(f"Successfully generated {target_md} and {target_txt} ({len(final_content)} bytes, {len(FILES)} files)")

if __name__ == "__main__":
    main()
