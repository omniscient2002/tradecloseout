# 17 — Business Validation Plan

**Status:** Draft v0.2
**Change history:** v0.2 tightens the ICP (AUD-B-01), sharpens positioning (AUD-B-03), prices checklist mapping (AUD-B-11), adds a realistic cost stack (AUD-B-09), widens pilots (AUD-B-10) and adds a Why-now section (AUD-B-12).
**Purpose:** Separate market evidence from assumptions and define how to test the commercial thesis before building too much.
**Rule:** Nothing in this document is market fact unless marked and sourced.

---

## 1. What must be true

The business works only if all five are true:

1. Closeout documentation causes measurable pain (delay, payment hold, rework) for HVAC subcontractors.
2. A senior person will pay ₹5,000–₹20,000/month (or equivalent per project) to reduce it.
3. Contractors will change behaviour enough to capture documents during the project.
4. Suppliers and consultants will participate through low-friction links.
5. The cost to acquire and support a customer is low enough for the price.

If any fails, the product or segment must change.

## 2. Ideal Customer Profile (ICP v1)

| Attribute | Target |
|---|---|
| Trade | HVAC installation/contracting |
| Size | 20–120 employees; ₹5–80 crore turnover; **≤20 active commercial projects at a time** |
| Projects | 3–20 active commercial projects (upper bound matches the Starter/Growth plan limits) |
| Buyer | Owner/proprietor or projects head |
| Daily users | PM + site engineer + document controller |
| Pain trigger | Final bill/retention held; consultant rejecting handover; audit |
| Current tools | Excel, WhatsApp, email, Drive, paper |
| Geography | NCR, Mumbai, Pune, Bengaluru, Hyderabad, Chennai, Ahmedabad |
| Disqualifiers | Large EPC with Aconex; residential-only dealer; no in-house PM |

## 2b. Why now

| Driver | Effect |
|---|---|
| GST e-invoicing and digital invoicing pressure | Finance teams want structured, verifiable records |
| Main contractors standardising on Aconex/Asite | Subcontractors must produce portal-ready submissions |
| WhatsApp Business API maturity | Low-friction collection from suppliers is practical |
| Retention and DLP disputes becoming costlier | Documentation is a payment lever, not an admin task |
| Cheap mobile data and mid-range Android | Site capture is viable at scale |

These are **hypotheses about timing**, not verified market facts. Validate in the discovery interviews.

## 3. Buyer and user map

| Role | Cares about | Objection | Message |
|---|---|---|---|
| Owner/proprietor | Cash, retention, reputation | "We already manage with Excel" | "Get your final bill processed without a document dispute" |
| Projects head | On-time handover, consultant relations | "My team won't use it" | "Site engineers upload in 3 taps; you see what's missing" |
| PM | Not being blamed, less chasing | "Too much setup" | "Start from an HVAC checklist, customise later" |
| Document controller | Control, revisions, audit | "I have my own register" | "Import/export; one source of truth" |
| Site engineer | Speed, no extra paperwork | "I'm busy" | "Take a photo, upload, done" |
| Consultant | Clear submissions, fewer revisions | "I won't learn a new portal" | "No login needed; review link" |

## 4. Hypotheses and tests

| ID | Hypothesis | Test | Pass threshold | Cost |
|---|---|---|---|---|
| H1 | Closeout pain is acute | 20 discovery interviews | ≥12 describe a payment/acceptance delay in last 12 months | 3 weeks |
| H2 | Willingness to pay | Price framing + 3 paid pilots | ≥3 pay ≥₹5,000/month equivalent | 6–8 weeks |
| H3 | Setup is acceptable | Onboarding time trial | First checklist <2 hours with help; <30 min self-serve | 2 weeks |
| H4 | Suppliers participate | Pilot supplier links | ≥70% upload within 7 days | During pilot |
| H5 | Consultants review in-app | Pilot review participation | ≥50% of reviews in-app | During pilot |
| H6 | Handover package is a top buying reason | Interview ranking | Top 3 for ≥50% | 2 weeks |
| H7 | Retention/expansion | 90-day usage | ≥70% orgs still active; ≥1 project per quarter | 3 months |
| H8 | Weekly Owner Digest ROI | Weekly digest open & action rates | ≥60% open rate; proprietors cite blocked retention rupee figures (RT-029) as primary reason to mandate app on all jobs | 2 months |
| H8 | Main contractors will pay later | 5 MC interviews | ≥2 request pilot/price | 3 weeks |
| H9 | The default checklist covers real projects | 5 checklist teardowns | ≥70% coverage without manual additions | 2 weeks |

## 5. Pricing hypotheses

All prices are **hypotheses**, not validated.

### 5.1 Per-company subscription (primary)

| Plan | Monthly | Annual (≈10× monthly) | Limits |
|---|---|---|---|
| Starter | ₹4,999 | ₹49,990 | 3 active projects, 5 seats, 20 GB |
| Growth | ₹9,999 | ₹99,990 | 15 projects, 20 seats, 100 GB |
| Scale | ₹19,999 | ₹1,99,990 | 50 projects, 50 seats, 400 GB |

- Supplier/guest access unlimited and free.
- Overage per project (₹999/month) or storage pack (₹499/50 GB).
- GST extra at applicable rate (verify).
- 14-day trial; paid pilot ₹25,000 for 8–10 weeks, credited on annual conversion.

### 5.2 Per-project alternative

₹2,500–₹4,999 per project (one-time or per 6 months), including unlimited internal users, limited storage. Test with contractors who resist subscriptions.

### 5.3 What not to do

- Per-seat pricing (punishes collaboration).
- Per-supplier pricing (kills the network effect).
- Free forever (unsustainable support).
- Usage-based document pricing (unpredictable).

### 5.4 Price test design

- Show three plans with limits, not feature checklists.
- Ask "which would you choose, and why?" for a real project.
- Measure conversion at ₹4,999 vs ₹9,999 for Starter.
- Do not discount below ₹4,999 without a pilot commitment.

## 6. Unit economics (hypothesis)

| Item | Assumption |
|---|---|
| ARPA | ₹9,000/month |
| Payment fee | ~2% |
| Infrastructure | ₹1,200/org/month at 50 orgs |
| Support | 3 hours/org/month × ₹600 = ₹1,800 |
| SMS (OTP + transactional) | ₹0.15–0.25/message; ~20 messages/org/month ≈ ₹5 |
| WhatsApp Business API | ₹0.30–0.80 per template message where used ≈ ₹20–100 |
| E-invoice / GSP fees | ₹0 in MVP (Rule 46 GST invoices; IRP integration deferred to V2 under ₹5 Cr turnover threshold, RT-015) |
| Support tooling (helpdesk, status page) | ₹20–40 |
| Error tracking / monitoring | ₹15–30 |
| Gross margin | ~₹6,500 (≈72%) after SMS, WhatsApp, GSP and support tooling |
| CAC target | ≤₹25,000 |
| Payback | ≤4 months |
| Logo churn target | ≤2%/month after 6 months |

Validate with real invoices and time tracking. If support exceeds 5 hours/org/month, self-serve onboarding is failing.

## 7. Onboarding and support model

### 7.1 Onboarding

| Tier | Offering | Target time |
|---|---|---|
| Self-serve | Wizard + sample project + help docs | 30–60 min |
| Assisted (pilot) | 60-minute call + checklist import | 2 hours |
| Done-with-you | We import assets/checklist (paid) | 1–2 days |
| **Checklist mapping** | Map the consultant's checklist to the template | 0.5–1 day — **priced service, not support** (`AUD-B-11`) |

Cost target: <₹3,000 per org in founder time. If higher, improve templates/docs.

### 7.2 Support

- Email + WhatsApp link + in-app help.
- 10:00–19:00 IST, Mon–Sat.
- Critical response 4 business hours.
- No phone SLA in MVP.
- Knowledge base for top 20 tasks.
- Monthly office hours for pilots.

## 8. Acquisition strategy

| Channel | Hypothesis | Cost | Test |
|---|---|---|---|
| Founder outbound (LinkedIn/phone) | Best early | Time | 100 targeted contacts |
| Referrals from consultants/PMCs | Trusted | Rev-share or free seats | 10 consultant conversations |
| ISHRAE/industry events | Credibility | ₹10–50k/event | 2 events |
| WhatsApp/contractor groups | Reach | Time | 5 group engagements |
| SEO/content ("HVAC handover checklist") | Inbound | Time | 10 articles |
| Case study from pilot | Conversion | Time | 1 detailed story |
| Partner with OEM/dealer | Distribution | Negotiation | 2 discussions |

Do not spend on paid ads before pilot conversion is understood.

## 9. Competitive positioning

| Alternative | Why customer uses it | Our wedge |
|---|---|---|
| Excel + WhatsApp | Free, familiar | Structure, reminders, audit, package |
| Google Drive/SharePoint | Storage | Requirements, revisions, approvals |
| Aconex/Asite | Main contractor mandates | Price, simplicity, subcontractor-first |
| Project management apps | Tasks/progress | Closeout/asset/document model |
| DMS | Storage/search | Compliance workflow and handover output |

Positioning statement:

> For HVAC subcontractors who lose time and money assembling handover documents, TradeCloseout is the system that produces the **file your main contractor will accept**: every requirement and asset tracked, evidence collected from site and suppliers, and a client-ready package generated from a phone. Aconex is priced for the main contractor; TradeCloseout is priced for the subcontractor who has to feed it.

## 10. Likely objections and responses

| Objection | Response | Evidence needed |
|---|---|---|
| "Excel is enough" | "Excel can't remind suppliers, track revisions, or produce an index with approvals." | Demo with their own checklist |
| "Too expensive" | "One withheld retention payment is larger than a year of the plan." | Pilot ROI measurement |
| "My team won't use it" | "Site upload is 3 taps; suppliers don't need accounts." | Usability test |
| "Client won't use it" | "Client just receives a link to review or accept; no training." | Pilot |
| "Data security" | "India hosting, tenant isolation, audit, export; you own the data." | Security summary, DPA |
| "We already have Aconex" | "Use us internally to prepare; export to their portal." | Export demo |
| "We're mid-project" | "Start with a checklist and import existing documents; don't restart." | Migration offer |
| "No time to set up" | "Start from the HVAC template; we import your asset list." | Assisted onboarding |

## 11. Paid-pilot design

### 11.1 Offer

- 8–10 weeks. **Widen to 5 pilots** (`AUD-B-10`); n=3 is directional only and must not be treated as a statistical decision rule.
- ₹25,000 fee (or ₹15,000 for a single project), credited to annual plan on conversion.
- Includes onboarding, checklist mapping for one project, weekly 30-min check-in.
- Success criteria agreed in writing.
- Customer uses it on a **live** project with a real handover.

### 11.2 Pilot success criteria

| Criterion | Target |
|---|---|
| Checklist covers project | ≥90% of client requirements represented |
| Document capture | ≥70% of requirements have evidence by week 6 |
| Supplier participation | ≥70% of invited suppliers upload |
| Reviews | ≥50% of reviews performed in-app |
| Package | Generated and accepted by client/MC (or submitted) |
| Time saved | Self-reported ≥30% reduction vs prior project |
| Satisfaction | ≥8/10; would recommend |
| Conversion | ≥3 of 5 pilots convert to paid annual |

### 11.3 Kill/pivot criteria

Stop or pivot if, after 3 pilots:

- Fewer than 2 convert.
- Support >6 hours/org/month.
- <40% of requirements captured.
- Customers use it only as a file dump (no reviews/packages).
- Price resistance below ₹3,000 with no path to value.

## 12. Discovery interview script

**Warm-up:** role, company size, projects, typical client.

1. Walk me through the last project you handed over. What happened after commissioning?
2. What documents did the client/consultant ask for? Where was that list?
3. Who was responsible for each? How did you know it was done?
4. What went wrong? What was rejected, delayed, or missing?
5. Did any payment or retention get held? For how long? Why?
6. How did you collect documents from suppliers? Show me if possible.
7. How do you track revisions and approvals today?
8. How long did the final package take? Who built it?
9. What did you try before? Why did it stop?
10. If you could fix one thing, what would it be?
11. Who would pay for this? Who would use it daily?
12. What would make you reject a tool like this?

**Do not pitch during the first 20 minutes.** Record verbatim quotes; tag pain, trigger, workaround, willingness to pay.

## 13. Evidence register

Maintain a table:

| Claim | Evidence type | Source | Date | Confidence |
|---|---|---|---|---|
| Contractors lose retention over missing docs | Interview | Pilot A | — | Low until 5+ |
| Suppliers will upload via link | Pilot metric | — | — | Unknown |
| ₹9,999 is acceptable | Price test | — | — | Unknown |

Until evidence exists, all market claims in sales material must be phrased as hypotheses or omitted.

## 14. Validation timeline

| Week | Activity | Output |
|---|---|---|
| 1–3 | 20 interviews, 5 checklist teardowns | Pain map, requirement library |
| 3–5 | Prototype (clickable) + pricing test | Usability findings, price signal |
| 4–6 | Build MVP in parallel | Working staging |
| 6–8 | Recruit 3 pilots; sign agreements | Signed pilots |
| 8–16 | Run pilots; weekly check-ins | Usage data, quotes, package results |
| 16–20 | Convert to annual; decide | Go/no-go |

## 15. Go/no-go decision

Proceed to V1 investment only if:

- ≥3 pilots started and ≥2 converted to paid annual, or
- 10+ orgs on trial with ≥40% activation and ≥5 verbal commitments at ≥₹5,000, and
- Support load and gross margin are within targets.

Otherwise narrow the segment, change the wedge, or stop.

## 16. Version log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | Initial validation plan |
| 0.2 | 2026-10-31 | Remediation: ICP tightened; Why-now added; checklist mapping priced; cost stack expanded; 5 pilots; positioning sharpened |
