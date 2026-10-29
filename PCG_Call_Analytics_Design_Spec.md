# Wint Wealth — PCG Call Analytics & Quality Portal
## UI Design Specification & Architecture Guide

---

### 1. Overview & Objectives
The **PCG Call Analytics Portal** is a specialized quality intelligence and coaching platform designed for Wint Wealth's Private Client Group (PCG) Relationship Managers (RMs) and Team Leaders (TLs). It provides automated quality scoring, compliance tripwire detection, multi-intent category classification, and dispute resolution workflows.

---

### 2. User Personas & Permissions

| Role | Personas Represented | Primary Interface & Capabilities |
| :--- | :--- | :--- |
| **Admin** | Senior Leadership, Compliance Officers | Full oversight across all teams (**Team Gokul** & **Team Vaishnavi**), cross-team category analytics, dispute approvals, RM leaderboards. |
| **Team Leader (TL)** | **Gokul**, **Vaishnavi** | Team-scoped console, auditing team calls, Agent filter, resolving parameter disputes with TL overrides. |
| **Agent / RM** | **Aahan Thaker**, **Dhanush**, **Aravind**, etc. | Scoped to own calls (*"My Evaluated Calls"*), personal weekly scorecard, raising quality disputes with timestamped justification. |

---

### 3. Layout Structure & Navigation

The platform follows a clean, single-page progressive disclosure architecture:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Top Nav: Brand (Wint Wealth PCG) | Tabs [Call Audits, Scorecard, Disputes]  │
│                                  | Role Switcher [Admin, TL, Agent]         │
├─────────────────────────────────────────────────────────────────────────────┤
│ Metric Overview Cards:                                                      │
│ [ Total Calls: 118 ] [ Avg IQS: 87.4% ] [ Connect: 68.2% ] [ Pass: 96.8% ] │
├─────────────────────────────────────────────────────────────────────────────┤
│ Category Filter Pills:                                                      │
│ [ All Categories ] [ 13% Pitching ] [ Upselling ] [ Support ] [ Coaching ]  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Evaluated Call Audits Table:                                                │
│ Header: Title + Subtitle            | Controls: [Agent Filter] [Search Bar] │
│ --------------------------------------------------------------------------- │
│ Call ID | RM Name | Phone | Category Badges | Duration | IQS | Gate | Action│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Interactive Slide-over Call Audit Drawer

Clicking on any call opens a high-fidelity **2-column slide-over drawer** (`max-w-5xl`):

#### Left Column (Voice & Transcript Flow):
1. **Audio Player**: High-contrast, dark-mode stereo player streaming S3 recordings with speed controls (1.0x, 1.25x, 1.5x).
2. **Dialogue Turns**:
   - Numbered, color-coded speaker turns (Blue for RM, Zinc for Investor/Customer).
   - Timestamp badges (`00:04`, `00:18`, etc.).
   - **RM Topic Pivot Marker**: When a call shifts from support resolution to a reinvestment pitch:
     > `⚡ RM Topic Pivot: Transitioned from Support Resolution to Re-investment Pitch`
     *(Rendered in clean, neutral black & white border styling).*

#### Right Column (Quality & Scoring Breakdown):
1. **Category Parameters**:
   - 13-parameter (Pitching), 7-parameter (Upselling), or 9-parameter (Support) checklists.
   - Earned points vs. max score badges (`Yes` in emerald, `Half` in amber, `No` in red).
   - Exact turn quotes justifying why points were awarded or deducted.
2. **Compliance Gates (G1, G2, G3)**:
   - Tripwires: *No Advice*, *No Fabricated Facts*, *Data Privacy*.
3. **AI Coaching Guidance**: Actionable coaching advice for calls `< 85%` IQS.
4. **Dispute & TL Override Console**: Agents challenge scores; TLs enter approved point overrides.

---

### 5. Multi-Category Call Handling Specification

When a call discusses multiple topics (e.g. an investor starts with a **Support** question and the RM pivots to an **Upselling** pitch):
1. **Scoring Protocol**: Scored against the **Primary Intent** (e.g. 7 parameters for Upselling) to maintain clean scorecard baselines.
2. **Table Display**: Displays primary pill + subtle secondary pill: `[Upselling Calls]  [+ General / Support]`.
3. **Cross-Category Filtering**: The call is indexed under *both* category filters so it is discoverable regardless of whether a TL filters by Upselling or Support.
4. **Audit History**: Secondary topics are logged in the metadata for complete compliance visibility.

---

### 6. Design System Tokens

* **Typography**: Primary: `Inter` (Sans-serif), Telephony & Timestamps: `JetBrains Mono` (Monospace).
* **Colors**:
  * Background: `#F8F9FA` (Neutral Canvas)
  * Surface/Cards: `#FFFFFF` with `#E4E4E7` borders
  * Text Primary: `#111111`
  * Text Secondary: `#71717A`
  * Success / Compliance Pass: Emerald (`#059669`, bg: `#ECFDF5`)
  * Attention / Needs Review: Amber (`#D97706`, bg: `#FFFBEB`)
  * Critical Gate Fail: Red (`#DC2626`, bg: `#FEF2F2`)
  * Pitching Category Pill: Blue (`#2563EB`, bg: `#EFF6FF`)
  * Upselling Category Pill: Purple (`#9333EA`, bg: `#FAF5FF`)

---

### 7. File Access & Figma Import
* **Interactive Design Prototype**: [pcg_call_analytics_prototype.html](file:///Users/sivaranjini/Documents/wint/wint-ir-portal/pcg_call_analytics_prototype.html)
* **Import to Figma**: Open Figma &rarr; Plugins &rarr; Run **"HTML to Figma"** (by Builder.io) &rarr; Paste file contents or local URL.
