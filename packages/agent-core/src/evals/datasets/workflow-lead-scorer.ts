/**
 * Lead Scorer eval dataset.
 *
 * Tests whether the lead-scorer agent assigns correct scores and tiers
 * based on company profiles and the scoring rubric.
 *
 * Inputs provide pre-enriched lead data (as if Exa/Apollo already ran).
 * Expected values verify scoring accuracy.
 *
 * Scoring rubric:
 *   Company Fit (max 40): industry (0-15), size (0-15), tech fit (0-10)
 *   Contact Fit (max 30): decision-maker (0-15), department (0-15)
 *   Intent Signals (max 30): inbound (0-15), company activity (0-10), engagement (0-5)
 *   Total: 0-100 → hot (80+), warm (60-79), cool (40-59), skip (<40)
 */

import type { WorkflowEvalCase } from '../types.js'

export const leadScorerDataset = {
  name: 'workflow-lead-scorer',
  description:
    'Does the lead-scorer agent assign accurate scores and correct tiers based on the scoring rubric?',
  cases: [
    // ── Hot lead: perfect ICP match ────────────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Sarah Chen\n' +
        'Email: sarah.chen@acmecorp.com\n' +
        'Company: Acme Corp\n' +
        'Title: VP of Engineering\n\n' +
        'Research findings:\n' +
        '- Industry: B2B SaaS (project management tools)\n' +
        '- Employees: ~200\n' +
        '- Tech stack: React, Node.js, AWS, Kubernetes\n' +
        '- Recent news: Just raised Series B ($30M)\n' +
        '- Source: Demo request form (inbound)\n' +
        '- Department: Engineering\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [82, 100],
      expectedTier: 'hot',
      tags: ['hot', 'perfect-match'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Warm lead: good fit, weaker intent ─────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: James Wilson\n' +
        'Email: jwilson@midmarket.com\n' +
        'Company: MidMarket Solutions\n' +
        'Title: Director of Engineering\n\n' +
        'Research findings:\n' +
        '- Industry: B2B SaaS (analytics platform)\n' +
        '- Employees: ~150\n' +
        '- Tech stack: Python, Django, GCP\n' +
        '- Recent news: None notable\n' +
        '- Source: Contact form (general inquiry)\n' +
        '- Department: Engineering\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [60, 79],
      expectedTier: 'warm',
      tags: ['warm', 'good-fit-weak-intent'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Cool lead: partial fit ─────────────────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Lisa Park\n' +
        'Email: lisa@retailshop.com\n' +
        'Company: RetailShop\n' +
        'Title: Marketing Manager\n\n' +
        'Research findings:\n' +
        '- Industry: E-commerce / Retail (not SaaS)\n' +
        '- Employees: ~80\n' +
        '- Tech stack: Shopify, basic WordPress\n' +
        '- Recent news: Opened 3rd physical store\n' +
        '- Source: Blog post link (content engagement)\n' +
        '- Department: Marketing (not engineering)\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [40, 59],
      expectedTier: 'cool',
      tags: ['cool', 'partial-fit'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Skip: poor fit ─────────────────────────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Bob\n' +
        'Email: bob42@gmail.com\n' +
        'Company: (not provided)\n' +
        'Title: (not provided)\n\n' +
        'Research findings:\n' +
        '- Personal email, no company domain\n' +
        '- No LinkedIn profile found\n' +
        '- No company info available\n' +
        '- Source: General contact form, no message\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [0, 39],
      expectedTier: 'skip',
      tags: ['skip', 'poor-fit', 'personal-email'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Edge case: competitor ───────────────────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Tom Anderson\n' +
        'Email: tom@competitorco.com\n' +
        'Company: CompetitorCo\n' +
        'Title: Product Manager\n\n' +
        'Research findings:\n' +
        '- Industry: B2B SaaS (direct competitor — similar product)\n' +
        '- Employees: ~300\n' +
        '- They sell a competing lead qualification tool\n' +
        '- Source: Pricing page visit\n' +
        '- Likely competitive research, not a buyer\n\n' +
        'Apply the scoring rubric and classify. Consider that this appears to be a competitor.',
      expectedScoreRange: [0, 30],
      expectedTier: 'skip',
      tags: ['skip', 'competitor', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Edge case: multiple submissions bonus ──────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Priya Sharma\n' +
        'Email: priya@techwave.io\n' +
        'Company: TechWave\n' +
        'Title: CTO\n\n' +
        'Research findings:\n' +
        '- Industry: B2B SaaS (developer tools)\n' +
        '- Employees: ~100\n' +
        '- Tech stack: TypeScript, React, Kubernetes, AWS\n' +
        '- Recent news: Hiring 10 engineers\n' +
        '- Source: Demo request form (inbound)\n' +
        '- Department: Engineering\n' +
        '- NOTE: This is her 2nd form submission (previous was 2 weeks ago)\n\n' +
        'Apply the scoring rubric. Multiple submissions indicate high intent (+5 bonus).',
      expectedScoreRange: [85, 100],
      expectedTier: 'hot',
      tags: ['hot', 'multiple-submissions', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Adjacent industry, strong intent ───────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Carlos Mendez\n' +
        'Email: carlos@fintechpay.com\n' +
        'Company: FintechPay\n' +
        'Title: VP of Product\n\n' +
        'Research findings:\n' +
        '- Industry: Fintech (adjacent to SaaS, not pure SaaS)\n' +
        '- Employees: ~400\n' +
        '- Tech stack: Java, React, AWS, Terraform\n' +
        '- Recent news: Series C ($80M), expanding engineering team\n' +
        '- Source: Demo request + pricing page (strong intent)\n' +
        '- Department: Product (adjacent to engineering)\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [65, 85],
      expectedTier: 'warm',
      tags: ['warm', 'adjacent-industry', 'strong-intent'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Too small company ──────────────────────────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Nina Kowalski\n' +
        'Email: nina@tinystartup.com\n' +
        'Company: TinyStartup\n' +
        'Title: Founder & CEO\n\n' +
        'Research findings:\n' +
        '- Industry: B2B SaaS (email marketing)\n' +
        '- Employees: 5 (way below ICP range)\n' +
        '- Tech stack: No-code tools, Zapier\n' +
        '- Recent news: Pre-seed, just launched\n' +
        '- Source: Contact form\n' +
        '- Solo founder, wears all hats\n\n' +
        'Apply the scoring rubric and classify.',
      expectedScoreRange: [25, 50],
      expectedTier: 'cool',
      tags: ['cool', 'too-small', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },

    // ── Enterprise (too large, but high value) ─────────────────────
    {
      input:
        'Score this lead against the ICP (B2B SaaS, 50-500 employees, engineering teams):\n\n' +
        'Name: Robert Chang\n' +
        'Email: robert.chang@megacorp.com\n' +
        'Company: MegaCorp International\n' +
        'Title: Senior Director, Platform Engineering\n\n' +
        'Research findings:\n' +
        '- Industry: Enterprise Software (B2B, SaaS-adjacent)\n' +
        '- Employees: ~15,000 (above ICP range)\n' +
        '- Tech stack: Java, Kubernetes, internal tools\n' +
        '- Recent news: Digital transformation initiative\n' +
        '- Source: Referral from existing customer\n' +
        '- Department: Engineering\n\n' +
        'Apply the scoring rubric. Company size exceeds ICP but referral is strong intent.',
      expectedScoreRange: [55, 75],
      expectedTier: 'warm',
      tags: ['warm', 'enterprise', 'referral', 'edge-case'],
      workflowId: 'lead-qualification',
      agentKey: 'lead-scorer',
    },
  ] as WorkflowEvalCase[],
}
